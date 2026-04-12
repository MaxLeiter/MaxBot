import { execSync } from "node:child_process";
import { loadConfig } from "./config.js";
import { loadSettings, getSettings, updateSettings } from "./settings.js";
import { IrcClient } from "./irc.js";
import { ContextManager } from "./context.js";
import { CronManager } from "./cron.js";
import { Agent } from "./agent.js";
import * as log from "./log.js";

const config = loadConfig();
const context = new ContextManager();
const crons = new CronManager();
const irc = new IrcClient(config.irc);
const agent = new Agent(config, irc, context, crons);

const botNickLower = config.irc.nick.toLowerCase();
const nickMentionRegex = new RegExp(`\\b${config.irc.nick}\\b`, "i");
const nickStripRegex = new RegExp(`\\b${config.irc.nick}[,:;]?\\s*`, "gi");

irc.client.on("message", (event: any) => {
  if (event.nick.toLowerCase() === botNickLower) return;
  // For DMs, store under the sender's nick (not the bot's nick) so lookups are consistent
  const isDM = event.target.toLowerCase() === botNickLower;
  const storeTarget = isDM ? event.nick : event.target;
  context.recordMessage(event.nick, storeTarget, event.message);
});

irc.onMessage((event) => {
  const { nick, target, message } = event;

  if (!getSettings().authorizedUsers.some(u => u.toLowerCase() === nick.toLowerCase())) return;

  const isDM = target.toLowerCase() === botNickLower;
  const replyTarget = isDM ? nick : target;

  // Extract message after nick mention
  let stripped: string;
  if (isDM) {
    stripped = message;
  } else {
    if (!nickMentionRegex.test(message)) return;
    stripped = message.replace(nickStripRegex, "").trim();
    if (!stripped) return;
  }

  // Handle ! commands deterministically (no AI)
  const cmd = stripped.match(/^!(\w+)\s*(.*)?$/);
  if (cmd) {
    const [, command, args] = cmd;
    handleCommand(command, args?.trim() ?? "", replyTarget);
    return;
  }

  context.markActive(replyTarget);
  agent.handleMessage(nick, replyTarget, stripped);
});

function handleCommand(command: string, args: string, target: string) {
  log.logInfo(`Command: !${command} ${args}`);
  switch (command) {
    case "restart":
      irc.say(target, "restarting...");
      setTimeout(() => {
        try {
          execSync("sudo systemctl restart maxbot", { stdio: "ignore" });
        } catch (err: any) {
          log.logError("Restart failed", err.message);
        }
      }, 500);
      break;
    case "pull":
      try {
        execSync("git -C /opt/maxbot checkout -- . && git -C /opt/maxbot checkout main 2>&1", { encoding: "utf-8" });
        const out = execSync("git -C /opt/maxbot pull --ff-only origin main 2>&1", { encoding: "utf-8" }).trim();
        irc.say(target, out.split("\n").slice(0, 3).join(" | "));
      } catch (err: any) {
        irc.say(target, `pull failed: ${err.message?.split("\n")[0]}`);
      }
      break;
    case "status": {
      const stats = agent.getStats();
      const uptime = process.uptime();
      const mins = Math.floor(uptime / 60);
      const hrs = Math.floor(mins / 60);
      const uptimeStr = hrs > 0 ? `${hrs}h${mins % 60}m` : `${mins}m`;
      irc.say(target, `up ${uptimeStr}, ${stats.queries} queries, $${stats.totalCostUsd.toFixed(4)}, model: ${getSettings().model}`);
      break;
    }
    case "model":
      if (args) {
        irc.say(target, `use "switch to <model>" instead of !model`);
      } else {
        irc.say(target, `model: ${getSettings().model}`);
      }
      break;
    case "debug": {
      const newDebug = !getSettings().debug;
      updateSettings({ debug: newDebug });
      irc.say(target, `debug mode ${newDebug ? "on" : "off"}`);
      break;
    }
    case "help":
      irc.say(target, "commands: !restart, !pull, !status, !model, !debug, !help");
      break;
    default:
      irc.say(target, `unknown command: !${command}. try !help`);
  }
}

async function shutdown() {
  log.logInfo("Shutting down...");
  crons.stopAll();
  await context.save();
  irc.quit("MaxBot shutting down");
  setTimeout(() => process.exit(0), 1500);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Go
log.logStartup(config.irc.host, config.irc.port);

Promise.all([loadSettings(), context.load(), crons.load()]).then(() => {
  const settings = getSettings();
  log.logInfo(`Model: ${settings.model}`);
  log.logInfo(`Channels: ${settings.channels.join(", ")}`);
  log.logInfo(`Authorized users: ${settings.authorizedUsers.join(", ")}`);

  context.startAutoSave();
  crons.startAll();
  irc.connect(settings.channels);
});
