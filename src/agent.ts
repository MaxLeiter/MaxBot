import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Config } from "./config.js";
import type { IrcClient } from "./irc.js";
import type { ContextManager } from "./context.js";
import type { CronManager } from "./cron.js";
import { getSettings, updateSettings } from "./settings.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import { createIrcTools } from "./tools.js";
import * as log from "./log.js";

export class Agent {
  private config: Config;
  private irc: IrcClient;
  private context: ContextManager;
  private crons: CronManager;
  private systemPrompt: string | null = null;
  private ircToolsServer: ReturnType<typeof createIrcTools>["server"];
  private allowTarget: (target: string) => void;
  private projectRoot: string;
  private totalCostUsd = 0;
  private totalTokens = 0;
  private queryCount = 0;

  constructor(config: Config, irc: IrcClient, context: ContextManager, crons: CronManager) {
    this.config = config;
    this.irc = irc;
    this.context = context;
    this.crons = crons;
    const tools = createIrcTools(
      irc,
      context,
      crons,
      () => this.getStats(),
      (model: string) => this.setModel(model),
      () => getSettings().model
    );
    this.ircToolsServer = tools.server;
    this.allowTarget = tools.allowTarget;
    this.projectRoot = new URL("..", import.meta.url).pathname;

    crons.onFire(async (job) => {
      log.logCron(job.id, job.prompt, job.target);
      this.allowTarget(job.target);
      await this.handleMessage("cron", job.target, job.prompt);
    });
  }

  private async setModel(model: string) {
    await updateSettings({ model });
    log.logInfo(`Model changed to: ${model}`);
  }

  getStats() {
    return {
      queries: this.queryCount,
      totalTokens: this.totalTokens,
      totalCostUsd: this.totalCostUsd,
    };
  }

  // Per-target message queues — if a query is already running, buffer new
  // messages and concat them into one prompt when the current one finishes
  private pending = new Map<string, Array<{ nick: string; message: string }>>();
  private processing = new Set<string>();

  async handleMessage(nick: string, target: string, message: string) {
    const key = target.toLowerCase();

    if (this.processing.has(key)) {
      // Query already running for this target — buffer it
      if (!this.pending.has(key)) this.pending.set(key, []);
      this.pending.get(key)!.push({ nick, message });
      log.logInfo(`Queued message from ${nick} in ${target} (query in progress)`);
      return;
    }

    this.processing.add(key);
    await this.processMessage(nick, target, message);

    // Drain any messages that arrived while we were processing
    while (this.pending.has(key) && this.pending.get(key)!.length > 0) {
      const queued = this.pending.get(key)!.splice(0);
      // Concat all queued messages into one prompt
      const combined = queued.map((m) => `<${m.nick}> ${m.message}`).join("\n");
      const lastNick = queued[queued.length - 1].nick;
      log.logInfo(`Processing ${queued.length} batched messages in ${target}`);
      await this.processMessage(lastNick, target, combined);
    }

    this.pending.delete(key);
    this.processing.delete(key);
  }

  private async processMessage(nick: string, target: string, message: string) {
    const settings = getSettings();
    this.systemPrompt = await buildSystemPrompt(
      this.config.irc.nick,
      settings.authorizedUsers
    );

    const recentMessages = this.context.getRecentMessages(target);
    const history = this.context.formatMessages(recentMessages);
    const userPrompt = await buildUserPrompt(nick, target, message, history);

    log.logMessage(target, nick, message);

    try {
      const result = await this.runQuery(userPrompt);
      if (result && !result.includes("__SKIP__")) {
        log.logReply(target, result);
        this.irc.say(target, result);
      }
    } catch (err: any) {
      const errStr = String(err?.message ?? err);
      log.logError("Agent query failed", errStr);

      if (errStr.includes("400") || errStr.includes("API Error")) {
        this.irc.say(
          target,
          `model error with ${getSettings().model}. it might not support tool use through the gateway. try switching models.`
        );
      } else {
        this.irc.say(target, `something went wrong, sorry.`);
      }
    }
  }

  private async runQuery(prompt: string): Promise<string | null> {
    let resultText: string | null = null;
    const startTime = Date.now();
    const model = getSettings().model;

    // Build env for the Claude subprocess, stripping sensitive vars
    const SENSITIVE_KEYS = new Set([
      "IRC_NICKSERV_PASSWORD",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
    ]);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !SENSITIVE_KEYS.has(k)) {
        env[k] = v;
      }
    }
    // Re-add only the gateway vars Claude needs to make API calls
    if (this.config.claude.baseUrl) {
      env.ANTHROPIC_BASE_URL = this.config.claude.baseUrl;
    }
    if (this.config.claude.authToken) {
      env.ANTHROPIC_AUTH_TOKEN = this.config.claude.authToken;
      env.ANTHROPIC_API_KEY = "";
    }

    let turns = 0;

    for await (const message of query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        systemPrompt: this.systemPrompt!,
        model,
        cwd: this.projectRoot,
        maxTurns: this.config.claude.maxTurns,
        permissionMode: "bypassPermissions",
        env,
        allowedTools: [
          "Read",
          "Write",
          "Edit",
          "Bash",
          "Glob",
          "Grep",
          "mcp__irc__send_irc_message",
          "mcp__irc__irc_action",
          "mcp__irc__join_channel",
          "mcp__irc__part_channel",
          "mcp__irc__get_scrollback",
          "mcp__irc__bot_status",
          "mcp__irc__change_model",
          "mcp__irc__create_cron",
          "mcp__irc__delete_cron",
          "mcp__irc__list_crons",
          "mcp__irc__skip_reply",
        ],
        disallowedTools: [
          "CronCreate",
          "CronDelete",
          "CronList",
        ],
        mcpServers: {
          irc: this.ircToolsServer,
        },
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        turns++;
        for (const block of message.message.content as any[]) {
          if (block.type === "text" && block.text) {
            log.logThinking(block.text);
          } else if (block.type === "tool_use") {
            log.logToolCall(block.name, block.input);
          }
        }
      }

      if (message.type === "result") {
        const elapsed = Date.now() - startTime;
        this.queryCount++;

        if (message.subtype === "success") {
          resultText = message.result;
          const tokens = (message as any).tokens_used_in_run ?? 0;
          const cost = (message as any).total_cost_usd ?? 0;
          this.totalTokens += tokens;
          this.totalCostUsd = cost || this.totalCostUsd;

          log.logQueryResult(this.queryCount, model, turns, tokens, cost, elapsed);
          log.logSessionTotal(this.totalTokens, this.totalCostUsd);
        } else {
          const errorStr = String((message as any).error ?? message.subtype);
          log.logQueryError(this.queryCount, elapsed, errorStr);
          if (errorStr.includes("400") || errorStr.includes("API") || errorStr.includes("thought_signature")) {
            resultText = `model error with ${model}. it might not support tool use through the gateway. try switching models.`;
          }
        }
      }
    }

    return resultText;
  }
}
