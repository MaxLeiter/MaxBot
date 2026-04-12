import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { IrcClient } from "./irc.js";
import type { ContextManager } from "./context.js";
import type { CronManager } from "./cron.js";
import { getSettings, updateSettings } from "./settings.js";
import * as log from "./log.js";

export interface BotStats {
  queries: number;
  totalTokens: number;
  totalCostUsd: number;
}

const startedAt = Date.now();

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

export function createIrcTools(
  irc: IrcClient,
  context: ContextManager,
  crons: CronManager,
  getStats: () => BotStats,
  setModel: (model: string) => Promise<void>,
  getModel: () => string
) {
  const allowedTargets = new Set<string>();

  function allowTarget(target: string) {
    allowedTargets.add(target.toLowerCase());
  }

  function revokeTarget(target: string) {
    allowedTargets.delete(target.toLowerCase());
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
      if (err) return fail(err);
      irc.say(args.target, args.message);
      context.recordMessage(irc.nick, args.target, args.message);
      return ok(`Sent to ${args.target}`);
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
      if (err) return fail(err);
      irc.action(args.target, args.message);
      context.recordMessage(irc.nick, args.target, `\x01ACTION ${args.message}\x01`);
      return ok(`Action in ${args.target}`);
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
        const settings = getSettings();
        if (!settings.channels.includes(args.channel.toLowerCase())) {
          await updateSettings({ channels: [...settings.channels, args.channel] });
        }
        return ok(`Joined ${args.channel}`);
      } catch (err: any) {
        return fail(`Failed to join ${args.channel}: ${err.message}`);
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
      const settings = getSettings();
      await updateSettings({
        channels: settings.channels.filter((c) => c.toLowerCase() !== args.channel.toLowerCase()),
      });
      return ok(`Left ${args.channel}`);
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
      if (messages.length === 0) return ok("No messages found at that range.");
      return ok(context.formatMessages(messages));
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
        ? cronJobs.map((j) => formatCronJob(j, 50)).join("\n")
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

      return ok(text);
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
        if (!res.ok) return fail(`failed to fetch models list: ${res.status}`);

        const data = await res.json() as { data?: Array<{ id: string }> };
        const validIds = (data.data ?? []).map((m: { id: string }) => m.id);

        if (!validIds.includes(args.model)) {
          const matches = validIds.filter((id: string) => id.includes(args.model) || args.model.includes(id));
          const suggestion = matches.length > 0
            ? `\ndid you mean: ${matches.slice(0, 5).join(", ")}?`
            : "";
          return fail(`"${args.model}" is not a valid model.${suggestion}`);
        }

        const prev = getModel();
        await setModel(args.model);
        return ok(`model changed from ${prev} to ${args.model}`);
      } catch (err) {
        return fail(`error changing model: ${err}`);
      }
    }
  );

  const createCron = tool(
    "create_cron",
    "Create a recurring scheduled task. The prompt will be run through the bot's AI on the given interval and the result sent to the target channel. Persists across restarts. IMPORTANT: the prompt must be a natural language instruction, NOT code. Example: 'say hi and the current time' not 'send_irc_message(\"hi\")'.",
    {
      schedule: z.string().describe("Interval like '5m', '1h', '30s', '1d'"),
      prompt: z.string().describe("Natural language instruction for what to do when the cron fires. e.g. 'say hi and the current time', 'check the weather in NYC and report it'"),
      target: z.string().describe("Channel or nick to send the result to"),
    },
    async (args) => {
      const job = await crons.create(args.schedule, args.prompt, args.target, "irc");
      return ok(`cron ${job.id} created: every ${job.schedule} -> ${job.target}`);
    }
  );

  const deleteCron = tool(
    "delete_cron",
    "Delete a scheduled cron job by its ID.",
    {
      id: z.string().describe("The cron job ID to delete"),
    },
    async (args) => {
      const removed = await crons.remove(args.id);
      if (!removed) return fail(`cron ${args.id} not found`);
      return ok(`cron ${args.id} deleted`);
    }
  );

  const listCrons = tool(
    "list_crons",
    "List all active cron jobs.",
    {},
    async () => {
      const jobs = crons.list();
      if (jobs.length === 0) return ok("no cron jobs");
      return ok(jobs.map((j) => formatCronJob(j)).join("\n"));
    }
  );

  const skipReply = tool(
    "skip_reply",
    "Choose not to reply to the current message. Use this when being mentioned doesn't warrant a response, e.g. someone is just talking about you, not to you.",
    {
      reason: z.string().optional().describe("Why you're skipping (logged, not sent to IRC)"),
    },
    async (args) => {
      log.logSkip(args.reason);
      return ok("__SKIP__");
    }
  );

  const server = createSdkMcpServer({
    name: "irc",
    version: "1.0.0",
    tools: [sendMessage, ircAction, joinChannel, partChannel, getScrollback, botStatus, changeModel, createCron, deleteCron, listCrons, skipReply],
  });

  return { server, allowTarget, revokeTarget };
}

function formatCronJob(j: { id: string; schedule: string; target: string; prompt: string }, truncate?: number): string {
  const prompt = truncate ? j.prompt.slice(0, truncate) : j.prompt;
  return `  ${j.id}: every ${j.schedule} -> ${j.target} ("${prompt}")`;
}
