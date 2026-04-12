import { loadConfig } from "./config.js";
import { loadSettings, getSettings } from "./settings.js";
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
  context.recordMessage(event.nick, event.target, event.message);
});

irc.onMessage((event) => {
  const { nick, target, message } = event;

  if (!getSettings().authorizedUsers.includes(nick.toLowerCase())) return;

  const isDM = target.toLowerCase() === botNickLower;

  if (isDM) {
    context.markActive(nick);
    agent.handleMessage(nick, nick, message);
    return;
  }

  if (!nickMentionRegex.test(message)) return;

  const stripped = message.replace(nickStripRegex, "").trim();
  if (!stripped) return;

  context.markActive(target);
  agent.handleMessage(nick, target, stripped);
});

// Graceful shutdown
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
