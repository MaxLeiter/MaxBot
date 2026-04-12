import { Client, type MessageEvent } from "irc-framework";
import type { Config } from "./config.js";
import * as log from "./log.js";

const SEND_DELAY_MS = 500;
const MAX_LINES = 50;

export class IrcClient {
  public client: Client;
  private config: Config["irc"];
  private sendQueue: Array<{ target: string; message: string }> = [];
  private sending = false;
  private joinedChannels = new Set<string>();

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

  get nick(): string {
    return this.config.nick;
  }

  connect(channels: string[]) {
    this.client.connect({
      host: this.config.host,
      port: this.config.port,
      tls: this.config.tls,
      nick: this.config.nick,
    });

    this.client.on("registered", () => {
      log.logConnected(this.config.nick);

      if (this.config.nickservPassword) {
        this.client.say(
          "NickServ",
          `IDENTIFY ${this.config.nickservPassword}`
        );
      }

      for (const channel of channels) {
        this.client.join(channel);
        log.logJoin(channel);
      }
    });

    this.client.on("reconnecting", () => {
      log.logInfo("Reconnecting...");
    });

    this.client.on("close", () => {
      log.logInfo("Connection closed");
    });
  }

  say(target: string, message: string) {
    const lines = message.split("\n").filter((l) => l.length > 0);
    const truncated = lines.length > MAX_LINES;
    const toSend = lines.slice(0, MAX_LINES);

    for (const line of toSend) {
      this.enqueue(target, line);
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

  /** Convert literal \x02 etc. from Claude's output into actual IRC control bytes */
  private convertFormatCodes(text: string): string {
    return text
      .replace(/\\x02/g, "\x02")  // bold
      .replace(/\\x1[Dd]/g, "\x1D")  // italic
      .replace(/\\x1[Ff]/g, "\x1F")  // underline
      .replace(/\\x0[Ff]/g, "\x0F")  // reset
      .replace(/\\x03/g, "\x03");    // color
  }

  private enqueue(target: string, message: string) {
    this.sendQueue.push({ target, message: this.convertFormatCodes(message) });
    if (!this.sending) this.drain();
  }

  private async drain() {
    this.sending = true;
    while (this.sendQueue.length > 0) {
      const { target, message } = this.sendQueue.shift()!;
      this.client.say(target, message);
      if (this.sendQueue.length > 0) {
        await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
      }
    }
    this.sending = false;
  }
}
