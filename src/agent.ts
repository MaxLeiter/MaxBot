import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Config } from "./config.js";
import type { IrcClient } from "./irc.js";
import type { ContextManager } from "./context.js";
import type { CronManager } from "./cron.js";
import { getSettings, updateSettings } from "./settings.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import { createIrcTools } from "./tools.js";
import * as log from "./log.js";

const MODEL_ERROR_MSG = (model: string) =>
  `model error with ${model}. it might not support tool use through the gateway. try switching models.`;

function isModelError(s: string): boolean {
  return s.includes("400") || s.includes("API") || s.includes("thought_signature");
}

export class Agent {
  private config: Config;
  private irc: IrcClient;
  private context: ContextManager;
  private ircToolsServer: ReturnType<typeof createIrcTools>["server"];
  private allowTarget: ReturnType<typeof createIrcTools>["allowTarget"];
  private projectRoot: string;
  private totalCostUsd = 0;
  private totalTokens = 0;
  private queryCount = 0;
  private env: Record<string, string>;
  private sensitiveValues: string[];

  constructor(config: Config, irc: IrcClient, context: ContextManager, crons: CronManager) {
    this.config = config;
    this.irc = irc;
    this.context = context;
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

    // Build env once, stripping sensitive vars
    const SENSITIVE_KEYS = new Set([
      "IRC_NICKSERV_PASSWORD",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
    ]);
    this.env = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !SENSITIVE_KEYS.has(k)) {
        this.env[k] = v;
      }
    }
    if (config.claude.baseUrl) {
      this.env.ANTHROPIC_BASE_URL = config.claude.baseUrl;
    }
    if (config.claude.authToken) {
      this.env.ANTHROPIC_AUTH_TOKEN = config.claude.authToken;
      this.env.ANTHROPIC_API_KEY = "";
    } else if (process.env.ANTHROPIC_API_KEY) {
      this.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    }

    // Collect actual secret values for scrubbing debug output
    this.sensitiveValues = [...SENSITIVE_KEYS]
      .map((k) => process.env[k])
      .filter((v): v is string => !!v && v.length > 3);

    crons.onFire(async (job) => {
      log.logCron(job.id, job.prompt, job.target);
      this.allowTarget(job.target);
      try {
        await this.handleMessage("cron", job.target, job.prompt);
      } finally {
        tools.revokeTarget(job.target);
      }
    });
  }

  private async setModel(model: string) {
    await updateSettings({ model });
    log.logInfo(`Model changed to: ${model}`);
  }

  private scrub(text: string): string {
    let result = text;
    for (const secret of this.sensitiveValues) {
      result = result.replaceAll(secret, "[REDACTED]");
    }
    return result;
  }

  private async handleAskUser(input: any, nick: string, target: string) {
    const answers: Record<string, string> = {};

    for (const q of input.questions ?? []) {
      // Send the question to IRC
      const options = (q.options ?? []) as Array<{ label: string; description?: string }>;
      this.irc.say(target, q.question);
      if (options.length > 0) {
        const optStr = options.map((o, i) => `${i + 1}) ${o.label}`).join("  ");
        this.irc.say(target, optStr);
      }

      log.logInfo(`AskUserQuestion: waiting for reply from ${nick} in ${target}`);

      // For DMs, the target is the nick. For channels, need to listen for nick-mentioned reply.
      // We listen on the raw target for the user's next message.
      const listenTarget = target.startsWith("#") ? target : nick;

      try {
        const reply = await this.irc.waitForReply(nick, listenTarget);
        // Check if reply is a number (option selection) or free text
        const num = parseInt(reply.trim());
        if (!isNaN(num) && num >= 1 && num <= options.length) {
          answers[q.question] = options[num - 1].label;
        } else {
          answers[q.question] = reply.trim();
        }
      } catch {
        answers[q.question] = "(no response)";
      }
    }

    return {
      behavior: "allow" as const,
      updatedInput: { questions: input.questions, answers },
    };
  }

  getStats() {
    return {
      queries: this.queryCount,
      totalTokens: this.totalTokens,
      totalCostUsd: this.totalCostUsd,
    };
  }

  private pending = new Map<string, Array<{ nick: string; message: string; modelOverride?: string }>>();
  private processing = new Set<string>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private static DEBOUNCE_MS = 600;

  async handleMessage(nick: string, target: string, message: string, modelOverride?: string) {
    const key = target.toLowerCase();

    if (!this.pending.has(key)) this.pending.set(key, []);
    this.pending.get(key)!.push({ nick, message, modelOverride });

    // If already processing a query for this target, messages just accumulate in pending
    if (this.processing.has(key)) {
      log.logInfo(`Queued message from ${nick} in ${target} (query in progress)`);
      return;
    }

    // Debounce: wait for rapid-fire messages to settle before starting the query
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(key, setTimeout(() => {
      this.debounceTimers.delete(key);
      this.drainPending(key);
    }, Agent.DEBOUNCE_MS));
  }

  private async drainPending(key: string) {
    this.processing.add(key);

    while (this.pending.has(key) && this.pending.get(key)!.length > 0) {
      const queued = this.pending.get(key)!.splice(0);
      let combinedNick: string;
      let combinedMessage: string;

      // Use the last message's model override (most recent wins)
      const modelOverride = [...queued].reverse().find((m) => m.modelOverride)?.modelOverride;

      if (queued.length === 1) {
        combinedNick = queued[0].nick;
        combinedMessage = queued[0].message;
      } else {
        combinedMessage = queued.map((m) => `<${m.nick}> ${m.message}`).join("\n");
        combinedNick = queued[queued.length - 1].nick;
        log.logInfo(`Processing ${queued.length} batched messages in ${key}`);
      }

      // Recover original target casing from the first message
      const target = queued[0].message ? key : key;
      await this.processMessage(combinedNick, target, combinedMessage, modelOverride);
    }

    this.pending.delete(key);
    this.processing.delete(key);
  }

  private async processMessage(nick: string, target: string, message: string, modelOverride?: string) {
    const settings = getSettings();
    const systemPrompt = await buildSystemPrompt(
      this.config.irc.nick,
      settings.authorizedUsers
    );

    const recentMessages = this.context.getRecentMessages(target);
    const history = this.context.formatMessages(recentMessages);
    const userPrompt = await buildUserPrompt(nick, target, message, history);

    log.logMessage(target, nick, message);

    // Consume the msgid before the query starts (for reply tagging)
    const replyMsgId = this.irc.consumeMsgId(target);

    this.irc.startTyping(target);
    try {
      const result = await this.runQuery(systemPrompt, userPrompt, nick, target, modelOverride);
      this.irc.stopTyping(target);
      if (result && !result.includes("__SKIP__")) {
        log.logReply(target, result);
        this.irc.say(target, result, replyMsgId);
        this.context.recordMessage(this.config.irc.nick, target, result);
      }
    } catch (err: any) {
      this.irc.stopTyping(target);
      const errStr = String(err?.message ?? err);
      log.logError("Agent query failed", errStr);
      const model = settings.model;
      this.irc.say(target, isModelError(errStr) ? MODEL_ERROR_MSG(model) : `something went wrong, sorry.`);
    }
  }

  private async runQuery(systemPrompt: string, prompt: string, nick?: string, target?: string, modelOverride?: string): Promise<string | null> {
    let resultText: string | null = null;
    const startTime = Date.now();
    const model = modelOverride ?? getSettings().model;

    let turns = 0;

    for await (const message of query({
      prompt,
      options: {
        pathToClaudeCodeExecutable: "/usr/local/bin/claude",
        systemPrompt,
        model,
        cwd: this.projectRoot,
        maxTurns: this.config.claude.maxTurns,
        permissionMode: "bypassPermissions",
        env: this.env,
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
          "mcp__irc__create_reminder",
          "mcp__irc__skip_reply",
          "WebSearch",
          "WebFetch",
          "AskUserQuestion",
        ],
        disallowedTools: [
          "CronCreate",
          "CronDelete",
          "CronList",
          "Skill(update-config)",
          "Skill(keybindings-help)",
          "Skill(loop)",
        ],
        mcpServers: {
          irc: this.ircToolsServer,
        },
        canUseTool: async (toolName: string, input: any) => {
          if (toolName === "AskUserQuestion" && nick && target) {
            return this.handleAskUser(input, nick, target);
          }
          // Auto-approve everything else (permissionMode handles this, but just in case)
          return { behavior: "allow" as const, updatedInput: input };
        },
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        turns++;
        for (const block of message.message.content as any[]) {
          if (block.type === "text" && block.text) {
            log.logThinking(block.text);
            if (getSettings().debug && target) {
              const raw = block.text.length > 120 ? block.text.slice(0, 120) + "..." : block.text;
              const preview = this.scrub(raw).replace(/[\r\n]+/g, " ").trim();
              if (preview) this.irc.action(target, `thinks: ${preview}`);
            }
          } else if (block.type === "tool_use") {
            log.logToolCall(block.name, block.input);
            if (getSettings().debug && target) {
              const name = block.name.replace("mcp__irc__", "").replace("mcp__", "");
              const args = block.input ? " " + Object.entries(block.input)
                .map(([k, v]) => {
                  const s = this.scrub(String(v));
                  return `${k}=${s.length > 40 ? s.slice(0, 40) + "..." : s}`;
                }).join(" ") : "";
              this.irc.action(target, `uses ${name}${args}`);
            }
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
          this.totalCostUsd += cost;

          log.logQueryResult(this.queryCount, model, turns, tokens, cost, elapsed);
          log.logSessionTotal(this.totalTokens, this.totalCostUsd);
        } else {
          const errorStr = String((message as any).error ?? message.subtype);
          log.logQueryError(this.queryCount, elapsed, errorStr);
          if (isModelError(errorStr)) {
            resultText = MODEL_ERROR_MSG(model);
          }
        }
      }
    }

    return resultText;
  }
}
