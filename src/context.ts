import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as log from "./log.js";

export interface StoredMessage {
  nick: string;
  target: string; // channel or bot nick for DMs
  message: string;
  timestamp: number;
}

const DEFAULT_BUFFER_SIZE = 200;
const DEFAULT_RECENT_COUNT = 20;
const ACTIVE_CHANNEL_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SAVE_INTERVAL_MS = 60 * 1000; // save every minute
const DATA_DIR = join(import.meta.dir, "..", "data");
const HISTORY_FILE = join(DATA_DIR, "history.json");

export class ContextManager {
  private buffers = new Map<string, StoredMessage[]>();
  private bufferSize: number;
  private activeChannels = new Map<string, number>();
  private dirty = false;

  constructor(bufferSize = DEFAULT_BUFFER_SIZE) {
    this.bufferSize = bufferSize;
  }

  async load() {
    try {
      const raw = await readFile(HISTORY_FILE, "utf-8");
      const data: Record<string, StoredMessage[]> = JSON.parse(raw);
      for (const [key, messages] of Object.entries(data)) {
        this.buffers.set(key, messages.slice(-this.bufferSize));
      }
      const total = [...this.buffers.values()].reduce(
        (n, b) => n + b.length,
        0,
      );
      log.logInfo(`Loaded ${total} messages from history`);
    } catch {
      // no history file yet, that's fine
    }
  }

  startAutoSave() {
    setInterval(() => {
      if (this.dirty) this.save();
    }, SAVE_INTERVAL_MS);
  }

  async save() {
    const data: Record<string, StoredMessage[]> = {};
    for (const [key, messages] of this.buffers) {
      data[key] = messages;
    }
    try {
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(HISTORY_FILE, JSON.stringify(data));
      this.dirty = false;
    } catch (err) {
      log.logError("Failed to save history", err);
    }
  }

  recordMessage(nick: string, target: string, message: string) {
    const key = target.toLowerCase();
    if (!this.buffers.has(key)) {
      this.buffers.set(key, []);
    }
    const buf = this.buffers.get(key)!;
    buf.push({ nick, target, message, timestamp: Date.now() });
    if (buf.length > this.bufferSize) {
      buf.splice(0, buf.length - this.bufferSize);
    }
    this.dirty = true;
  }

  markActive(target: string) {
    this.activeChannels.set(target.toLowerCase(), Date.now());
  }

  isActiveChannel(target: string): boolean {
    const lastActive = this.activeChannels.get(target.toLowerCase());
    if (!lastActive) return false;
    return Date.now() - lastActive < ACTIVE_CHANNEL_TTL_MS;
  }

  getRecentMessages(
    target: string,
    count = DEFAULT_RECENT_COUNT,
  ): StoredMessage[] {
    const buf = this.buffers.get(target.toLowerCase());
    if (!buf) return [];
    return buf.slice(-count);
  }

  getScrollback(
    target: string,
    offset: number,
    count: number,
  ): StoredMessage[] {
    const buf = this.buffers.get(target.toLowerCase());
    if (!buf) return [];
    const end = Math.max(0, buf.length - offset);
    const start = Math.max(0, end - count);
    return buf.slice(start, end);
  }

  getBufferSizes(): Record<string, number> {
    const sizes: Record<string, number> = {};
    for (const [key, buf] of this.buffers) {
      sizes[key] = buf.length;
    }
    return sizes;
  }

  formatMessages(messages: StoredMessage[]): string {
    if (messages.length === 0) return "(no recent messages)";
    return messages.map((m) => `<${m.nick}> ${m.message}`).join("\n");
  }
}
