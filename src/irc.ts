import { Client, type MessageEvent } from "irc-framework";
import type { Config } from "./config.js";
import { formatForIrc } from "./format.js";
import * as log from "./log.js";

const SEND_DELAY_MS = 500;
const MAX_LINES = 50;
const TYPING_INTERVAL_MS = 3000; // IRCv3 spec: no more than one per 3 seconds

export class IrcClient {
  public client: Client;
  private config: Config["irc"];
  private sendQueue: Array<{ target: string; message: string; tags?: Record<string, string> }> = [];
  private sending = false;
  private joinedChannels = new Set<string>();
  private typingTimers = new Map<string, ReturnType<typeof setInterval>>();
  private lastMsgIds = new Map<string, string>(); // target -> last msgid from a user message

  constructor(config: Config["irc"]) {
    this.config = config;
    this.client = new Client({
      nick: config.nick,
      username: config.username,
      gecos: "MaxBot - self-programmable IRC bot",
      auto_reconnect: true,
      auto_reconnect_max_wait: 30000,
      auto_reconnect_max_retries: 10,
      ping_interval: 30,
      ping_timeout: 120,
    });

    // Request IRCv3 capabilities
    this.client.requestCap("message-tags");
    this.client.requestCap("echo-message");

    // Track channel membership
    this.client.on("join", (event: any) => {
      if (event.nick.toLowerCase() === config.nick.toLowerCase()) {
        this.joinedChannels.add(event.channel.toLowerCase());
      }
    });
    this.client.on("part", (event: any) => {
      if (event.nick.toLowerCase() === config.nick.toLowerCase()) {
        this.joinedChannels.delete(event.channel.toLowerCase());
      }
    });
    this.client.on("kick", (event: any) => {
      if (event.kicked.toLowerCase() === config.nick.toLowerCase()) {
        this.joinedChannels.delete(event.channel.toLowerCase());
      }
    });
  }

  getChannels(): string[] {
    return [...this.joinedChannels];
  }

  /** Store the msgid of a user's message so we can reply to it */
  trackMsgId(target: string, tags: Record<string, string>) {
    const msgid = tags?.msgid;
    if (msgid) {
      this.lastMsgIds.set(target.toLowerCase(), msgid);
    }
  }

  /** Get the last tracked msgid for a target, and clear it (one-shot reply) */
  consumeMsgId(target: string): string | undefined {
    const key = target.toLowerCase();
    const id = this.lastMsgIds.get(key);
    this.lastMsgIds.delete(key);
    return id;
  }

  /** Start sending typing indicators to a target */
  startTyping(target: string) {
    const key = target.toLowerCase();
    if (this.typingTimers.has(key)) return;

    // Send immediately, then every 3 seconds (per spec)
    this.sendTyping(target, "active");
    const timer = setInterval(() => {
      this.sendTyping(target, "active");
    }, TYPING_INTERVAL_MS);
    this.typingTimers.set(key, timer);
  }

  /** Stop sending typing indicators to a target */
  stopTyping(target: string) {
    const key = target.toLowerCase();
    const timer = this.typingTimers.get(key);
    if (timer) {
      clearInterval(timer);
      this.typingTimers.delete(key);
    }
    this.sendTyping(target, "done");
  }

  private sendTyping(target: string, state: "active" | "paused" | "done") {
      this.client.tagmsg(target, { "+typing": state });
  }

  get nick(): string {
    return this.config.nick;
  }

  connect(channels: string[]) {
    const connectOpts: any = {
      host: this.config.host,
      port: this.config.port,
      tls: this.config.tls,
      nick: this.config.nick,
    };

    // Use SASL auth if NickServ password is set (required by some networks before registration)
    if (this.config.nickservPassword) {
      connectOpts.account = {
        account: this.config.nick,
        password: this.config.nickservPassword,
      };
    }

    this.client.connect(connectOpts);

    this.client.on("registered", () => {
      log.logConnected(this.config.nick);

      for (const channel of channels) {
        this.client.join(channel);
        log.logJoin(channel);
      }
    });

    this.client.on("socket connected", () => {
      log.logInfo("Socket connected, registering...");
    });

    this.client.on("reconnecting", () => {
      log.logInfo("Reconnecting...");
    });

    this.client.on("close", () => {
      log.logInfo("Connection closed");
    });

    this.client.on("socket close", () => {
      log.logInfo("Socket closed");
    });

    this.client.on("debug", (msg: string) => {
      log.logInfo(`[debug] ${msg}`);
    });
  }

  say(target: string, message: string, replyToMsgId?: string) {
    const lines = message.split("\n").filter((l) => l.length > 0);
    const truncated = lines.length > MAX_LINES;
    const toSend = lines.slice(0, MAX_LINES);

    // Only attach +reply tag to the first line
    const tags = replyToMsgId ? { "+reply": replyToMsgId } : undefined;
    for (let i = 0; i < toSend.length; i++) {
      this.enqueue(target, toSend[i], i === 0 ? tags : undefined);
    }

    if (truncated) {
      this.enqueue(target, `(truncated ${lines.length - MAX_LINES} more lines)`);
    }
  }

  action(target: string, message: string) {
    this.client.action(target, message);
  }

  join(channel: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`timed out joining ${channel}`));
      }, 10000);

      const onJoin = (event: any) => {
        if (event.channel.toLowerCase() === channel.toLowerCase() &&
            event.nick.toLowerCase() === this.config.nick.toLowerCase()) {
          cleanup();
          log.logJoin(channel);
          resolve();
        }
      };

      const onError = (event: any) => {
        // ERR_BANNEDFROMCHAN, ERR_INVITEONLYCHAN, ERR_BADCHANNELKEY, etc.
        if (event.channel?.toLowerCase() === channel.toLowerCase()) {
          cleanup();
          reject(new Error(event.reason || event.error || "failed to join"));
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.client.removeListener("join", onJoin);
        this.client.removeListener("channel_error", onError);
      };

      this.client.on("join", onJoin);
      this.client.on("channel_error", onError);
      this.client.join(channel);
    });
  }

  part(channel: string, reason?: string) {
    this.client.part(channel, reason);
  }

  quit(message?: string) {
    this.client.quit(message || "MaxBot shutting down");
  }

  onMessage(handler: (event: MessageEvent) => void) {
    this.client.on("privmsg", handler);
  }

  /** Wait for the next message from a specific nick in a specific target. Times out after 2 min. */
  waitForReply(nick: string, target: string, timeoutMs = 120000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("timed out waiting for reply"));
      }, timeoutMs);

      const onMessage = (event: any) => {
        if (event.nick.toLowerCase() === nick.toLowerCase() &&
            event.target.toLowerCase() === target.toLowerCase()) {
          cleanup();
          resolve(event.message);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.client.removeListener("privmsg", onMessage);
      };

      this.client.on("privmsg", onMessage);
    });
  }

  private enqueue(target: string, message: string, tags?: Record<string, string>) {
    this.sendQueue.push({ target, message: formatForIrc(message), tags });
    if (!this.sending) this.drain();
  }

  private async drain() {
    this.sending = true;
    while (this.sendQueue.length > 0) {
      const { target, message, tags } = this.sendQueue.shift()!;
      this.client.say(target, message, tags);
      if (this.sendQueue.length > 0) {
        await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
      }
    }
    this.sending = false;
  }
}
