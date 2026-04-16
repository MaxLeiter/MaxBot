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

  abort(target: string) {
    const key = target.toLowerCase();
    const gen = this.activeQueries.get(key);
    if (gen) {
      gen.return(undefined);
      this.activeQueries.delete(key);
    }
    // Clear pending messages and debounce
    this.pending.delete(key);
    this.processing.delete(key);
    const timer = this.debounceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(key);
    }
    this.irc.stopTyping(target);
    log.logInfo(`Aborted query for ${target}`);
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
  private activeQueries = new Map<string, AsyncGenerator>();

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
    const toolNames = new Map<string, string>();
    const webSearchQueries = new Map<string, string>();
    let lastServerToolUse = { web_search_requests: 0, web_fetch_requests: 0 };

    let turns = 0;

    const gen = query({
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
        stderr: (data: string) => {
          const trimmed = data.trim();
          if (trimmed) log.logInfo(`claude-stderr: ${trimmed}`);
        },
      },
    });

    if (target) this.activeQueries.set(target.toLowerCase(), gen);

    try {
      for await (const message of gen) {
        if (message.type === "assistant" && message.message?.content) {
          turns++;
          const serverToolUse = (message.message as any)?.usage?.server_tool_use;
          if (serverToolUse) {
            lastServerToolUse = {
              web_search_requests: serverToolUse.web_search_requests ?? 0,
              web_fetch_requests: serverToolUse.web_fetch_requests ?? 0,
            };
          }
          for (const block of message.message.content as any[]) {
            if (block.type === "text" && block.text) {
              log.logThinking(block.text);
              if (getSettings().debug && target) {
                const raw = block.text.length > 120 ? block.text.slice(0, 120) + "..." : block.text;
                const preview = this.scrub(raw).replace(/[\r\n]+/g, " ").trim();
                if (preview) this.irc.action(target, `thinks: ${preview}`);
              }
            } else if (block.type === "tool_use") {
              if (block.id && block.name) toolNames.set(block.id, block.name);
              if (block.id && block.name === "WebSearch" && typeof block.input?.query === "string") {
                webSearchQueries.set(block.id, this.scrub(block.input.query));
              }
              log.logToolCall(block.name, block.input);
              if (getSettings().debug && target) {
                const name = block.name.replace("mcp__irc__", "").replace("mcp__", "");
                const args = block.input ? " " + Object.entries(block.input)
                  .map(([k, v]) => {
                    const s = this.scrub(String(v));
                    return `${k}=${s.length > 40 ? s.slice(0, 40) + "..." : s}`;
                  }).join(" ") : "";
                this.irc.action(target, `used ${name}${args}`);
              }
            }
          }
        } else if (message.type === "user" && message.message?.content) {
          for (const block of message.message.content as any[]) {
            if (block.type === "tool_result") {
              const content = typeof block.content === "string"
                ? block.content
                : Array.isArray(block.content)
                  ? block.content
                      .map((item: any) => item?.text ?? (typeof item === "string" ? item : ""))
                      .filter(Boolean)
                      .join(" ")
                  : "";
              const scrubbedContent = this.scrub(content || "(empty result)");
              const toolUseId = block.tool_use_id ?? "unknown";
              const toolName = toolNames.get(block.tool_use_id) ?? "unknown";
              if (toolName === "WebSearch") {
                log.logWebSearchResult(
                  toolUseId,
                  webSearchQueries.get(toolUseId) ?? "unknown",
                  lastServerToolUse.web_search_requests,
                  Boolean(block.is_error),
                  scrubbedContent.slice(0, 2000),
                );
              } else {
                log.logToolResult(
                  toolUseId,
                  toolName,
                  Boolean(block.is_error),
                  scrubbedContent.slice(0, 120),
                );
              }
            } else if (block.type === "web_search_tool_result") {
              const content = block.content;
              const isError = content?.type === "web_search_tool_result_error";
              const rawContent = this.scrub(JSON.stringify(content ?? "(empty result)"));
              log.logWebSearchResult(
                block.tool_use_id ?? "unknown",
                webSearchQueries.get(block.tool_use_id ?? "unknown") ?? "unknown",
                lastServerToolUse.web_search_requests,
                isError,
                rawContent.slice(0, 2000),
              );
            } else if (block.type === "web_fetch_tool_result") {
              const content = block.content;
              const isError = content?.type === "web_fetch_tool_result_error";
              const summary = isError
                ? `error: ${content.error_code ?? "unknown"}`
                : `${Array.isArray(content) ? content.length : 0} blocks`;
              log.logToolResult(block.tool_use_id ?? "unknown", "WebFetch", isError, summary);
            }
          }
        } else if (message.type === "system" && (message as any).subtype === "api_retry") {
          log.logApiRetry(
            (message as any).attempt ?? 0,
            (message as any).max_retries ?? 0,
            (message as any).error_status ?? null,
            String((message as any).error ?? "unknown"),
            (message as any).retry_delay_ms ?? 0,
          );
        } else if (message.type === "result") {
          const elapsed = Date.now() - startTime;
          this.queryCount++;

          if (message.subtype === "success") {
            resultText = message.result;
            const usage = (message as any).usage ?? {};
            const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
            const cost = (message as any).total_cost_usd ?? 0;
            this.totalTokens += tokens;
            this.totalCostUsd += cost;

            log.logQueryResult(this.queryCount, model, turns, tokens, cost, elapsed);
            log.logSessionTotal(this.totalTokens, this.totalCostUsd);
          } else {
            const errors = Array.isArray((message as any).errors) ? (message as any).errors : [];
            const errorStr = errors.length > 0 ? errors.join("; ") : message.subtype;
            log.logQueryError(this.queryCount, elapsed, errorStr);
            const denials = Array.isArray((message as any).permission_denials) ? (message as any).permission_denials : [];
            for (const denial of denials) {
              log.logInfo(`permission denied: ${denial.tool_name ?? "unknown"}`);
            }
            if (isModelError(errorStr)) {
              resultText = MODEL_ERROR_MSG(model);
            }
          }
        }
      }
    } finally {
      if (target) this.activeQueries.delete(target.toLowerCase());
    }

    return resultText;
  }
}
