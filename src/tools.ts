import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IrcClient } from "./irc.js";
import type { ContextManager } from "./context.js";
import type { CronManager } from "./cron.js";

export interface BotStats {
  queries: number;
  totalTokens: number;
  totalCostUsd: number;
}

const startedAt = Date.now();

export function createIrcTools(
  irc: IrcClient,
  context: ContextManager,
  crons: CronManager,
  getStats: () => BotStats,
  setModel: (model: string) => Promise<void>,
  getModel: () => string
) {
  // Channels that bypass the active-channel check (cron targets)
  const allowedTargets = new Set<string>();

  /** Call this before running a cron-triggered query to whitelist its target */
  function allowTarget(target: string) {
    allowedTargets.add(target.toLowerCase());
  }

  function checkTarget(target: string): string | null {
    if (!target.startsWith("#")) return null;
    if (allowedTargets.has(target.toLowerCase())) return null;
    if (!context.isActiveChannel(target)) {
      return `Refused: ${target} is not a recently active channel. You can only send messages to channels where you were recently addressed.`;
    }
    return null;
  }

  const sendMessage = tool(
    "send_irc_message",
    "Send a message to an IRC channel or user. Only works for channels where the bot was recently addressed.",
    {
      target: z.string().describe("Channel name (e.g. #general) or nickname"),
      message: z.string().describe("The message to send"),
    },
    async (args) => {
      const err = checkTarget(args.target);
      if (err) return { content: [{ type: "text" as const, text: err }], isError: true };
      irc.say(args.target, args.message);
      return { content: [{ type: "text" as const, text: `Sent to ${args.target}` }] };
    }
  );

  const ircAction = tool(
    "irc_action",
    "Send a /me action to a channel or user. Only works for channels where the bot was recently addressed.",
    {
      target: z.string().describe("Channel name or nickname"),
      message: z.string().describe("The action text (without /me prefix)"),
    },
    async (args) => {
      const err = checkTarget(args.target);
      if (err) return { content: [{ type: "text" as const, text: err }], isError: true };
      irc.action(args.target, args.message);
      return { content: [{ type: "text" as const, text: `Action in ${args.target}` }] };
    }
  );

  const joinChannel = tool(
    "join_channel",
    "Join an IRC channel",
    {
      channel: z.string().describe("Channel name to join (e.g. #general)"),
    },
    async (args) => {
      try {
        await irc.join(args.channel);
        return { content: [{ type: "text" as const, text: `Joined ${args.channel}` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Failed to join ${args.channel}: ${err.message}` }], isError: true };
      }
    }
  );

  const partChannel = tool(
    "part_channel",
    "Leave an IRC channel",
    {
      channel: z.string().describe("Channel name to leave"),
      reason: z.string().optional().describe("Optional part message"),
    },
    async (args) => {
      irc.part(args.channel, args.reason);
      return { content: [{ type: "text" as const, text: `Left ${args.channel}` }] };
    }
  );

  const getScrollback = tool(
    "get_scrollback",
    "Retrieve earlier messages from a channel's history buffer. Use this to see more context beyond what was provided in the prompt.",
    {
      channel: z.string().describe("Channel name to get history from"),
      offset: z.number().default(20).describe("How many messages back to skip (the most recent N are already in your context)"),
      count: z.number().default(30).describe("How many messages to retrieve"),
    },
    async (args) => {
      const messages = context.getScrollback(args.channel, args.offset, args.count);
      if (messages.length === 0) {
        return { content: [{ type: "text" as const, text: "No messages found at that range." }] };
      }
      const formatted = context.formatMessages(messages);
      return { content: [{ type: "text" as const, text: formatted }] };
    }
  );

  const botStatus = tool(
    "bot_status",
    "Get the bot's current stats: uptime, queries handled, tokens used, cost, message buffer sizes, and active cron jobs.",
    {},
    async () => {
      const stats = getStats();
      const uptimeMs = Date.now() - startedAt;
      const uptimeMin = Math.floor(uptimeMs / 60000);
      const uptimeHrs = Math.floor(uptimeMin / 60);
      const uptimeStr = uptimeHrs > 0
        ? `${uptimeHrs}h ${uptimeMin % 60}m`
        : `${uptimeMin}m`;

      const bufferInfo = context.getBufferSizes();
      const bufferLines = Object.entries(bufferInfo)
        .map(([ch, count]) => `  ${ch}: ${count} messages`)
        .join("\n");

      const cronJobs = crons.list();
      const cronLines = cronJobs.length > 0
        ? cronJobs.map((j) => `  ${j.id}: every ${j.schedule} -> ${j.target} ("${j.prompt.slice(0, 50)}")`).join("\n")
        : "  (none)";

      const channels = irc.getChannels();

      const text = [
        `model: ${getModel()}`,
        `uptime: ${uptimeStr}`,
        `channels: ${channels.length > 0 ? channels.join(", ") : "(none)"}`,
        `queries: ${stats.queries}`,
        `tokens used: ${stats.totalTokens}`,
        `cost: $${stats.totalCostUsd.toFixed(4)}`,
        `message buffers:`,
        bufferLines || "  (none)",
        `cron jobs:`,
        cronLines,
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    }
  );

  const changeModel = tool(
    "change_model",
    "Change the AI model the bot uses. Only do this when the user explicitly asks to switch models. Fetches valid models from the AI gateway to validate the choice.",
    {
      model: z.string().describe("The model ID to switch to (e.g. anthropic/claude-sonnet-4.5, google/gemini-2.5-pro)"),
    },
    async (args) => {
      try {
        const res = await fetch("https://ai-gateway.vercel.sh/v1/models");
        if (!res.ok) {
          return { content: [{ type: "text" as const, text: `failed to fetch models list: ${res.status}` }], isError: true };
        }
        const data = await res.json() as { data?: Array<{ id: string }> };
        const validIds = (data.data ?? []).map((m: { id: string }) => m.id);

        if (!validIds.includes(args.model)) {
          const matches = validIds.filter((id: string) => id.includes(args.model) || args.model.includes(id));
          const suggestion = matches.length > 0
            ? `\ndid you mean: ${matches.slice(0, 5).join(", ")}?`
            : "";
          return { content: [{ type: "text" as const, text: `"${args.model}" is not a valid model.${suggestion}` }], isError: true };
        }

        const prev = getModel();
        await setModel(args.model);
        return { content: [{ type: "text" as const, text: `model changed from ${prev} to ${args.model}` }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `error changing model: ${err}` }], isError: true };
      }
    }
  );

  const createCron = tool(
    "create_cron",
    "Create a recurring scheduled task. The prompt will be run through the bot's AI on the given interval and the result sent to the target channel. Persists across restarts.",
    {
      schedule: z.string().describe("Interval like '5m', '1h', '30s', '1d'"),
      prompt: z.string().describe("The prompt to run each time the cron fires"),
      target: z.string().describe("Channel or nick to send the result to"),
    },
    async (args) => {
      const job = await crons.create(args.schedule, args.prompt, args.target, "irc");
      return { content: [{ type: "text" as const, text: `cron ${job.id} created: every ${job.schedule} -> ${job.target}` }] };
    }
  );

  const deleteCron = tool(
    "delete_cron",
    "Delete a scheduled cron job by its ID.",
    {
      id: z.string().describe("The cron job ID to delete"),
    },
    async (args) => {
      const ok = await crons.remove(args.id);
      if (!ok) return { content: [{ type: "text" as const, text: `cron ${args.id} not found` }], isError: true };
      return { content: [{ type: "text" as const, text: `cron ${args.id} deleted` }] };
    }
  );

  const listCrons = tool(
    "list_crons",
    "List all active cron jobs.",
    {},
    async () => {
      const jobs = crons.list();
      if (jobs.length === 0) {
        return { content: [{ type: "text" as const, text: "no cron jobs" }] };
      }
      const text = jobs
        .map((j) => `${j.id}: every ${j.schedule} -> ${j.target} ("${j.prompt}")`)
        .join("\n");
      return { content: [{ type: "text" as const, text }] };
    }
  );

  const skipReply = tool(
    "skip_reply",
    "Choose not to reply to the current message. Use this when being mentioned doesn't warrant a response, e.g. someone is just talking about you, not to you.",
    {
      reason: z.string().optional().describe("Why you're skipping (logged, not sent to IRC)"),
    },
    async (args) => {
      if (args.reason) console.log(`  skipped: ${args.reason}`);
      return { content: [{ type: "text" as const, text: "__SKIP__" }] };
    }
  );

  const server = createSdkMcpServer({
    name: "irc",
    version: "1.0.0",
    tools: [sendMessage, ircAction, joinChannel, partChannel, getScrollback, botStatus, changeModel, createCron, deleteCron, listCrons, skipReply],
  });

  return { server, allowTarget };
}
