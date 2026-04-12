import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as log from "./log.js";

const DATA_DIR = join(import.meta.dir, "..", "data");
const CRONS_FILE = join(DATA_DIR, "crons.json");

export interface CronJob {
  id: string;
  schedule: string; // cron expression or simple interval like "5m", "1h"
  prompt: string; // what to send to claude when it fires
  target: string; // channel or nick to respond in
  createdBy: string; // who created it
  createdAt: number;
}

type CronHandler = (job: CronJob) => Promise<void>;

export class CronManager {
  private jobs: CronJob[] = [];
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private handler: CronHandler | null = null;

  onFire(handler: CronHandler) {
    this.handler = handler;
  }

  async load() {
    try {
      const raw = await readFile(CRONS_FILE, "utf-8");
      this.jobs = JSON.parse(raw);
      log.logInfo(`Loaded ${this.jobs.length} cron jobs`);
    } catch {
      // no crons yet
    }
  }

  async save() {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(CRONS_FILE, JSON.stringify(this.jobs, null, 2));
  }

  startAll() {
    for (const job of this.jobs) {
      this.schedule(job);
    }
  }

  async create(schedule: string, prompt: string, target: string, createdBy: string): Promise<CronJob> {
    const id = Math.random().toString(36).slice(2, 8);
    const job: CronJob = {
      id,
      schedule,
      prompt,
      target,
      createdBy,
      createdAt: Date.now(),
    };
    this.jobs.push(job);
    this.schedule(job);
    await this.save();
    return job;
  }

  async remove(id: string): Promise<boolean> {
    const idx = this.jobs.findIndex((j) => j.id === id);
    if (idx === -1) return false;
    this.jobs.splice(idx, 1);
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
    await this.save();
    return true;
  }

  list(): CronJob[] {
    return [...this.jobs];
  }

  private schedule(job: CronJob) {
    const ms = parseInterval(job.schedule);
    if (!ms) {
      log.logError(`Invalid cron schedule: ${job.schedule} (job ${job.id})`);
      return;
    }
    log.logInfo(`Scheduling cron ${job.id}: every ${job.schedule} -> ${job.target}`);
    const timer = setInterval(() => {
      if (this.handler) {
        this.handler(job).catch((err) =>
          log.logError(`Cron ${job.id} failed:`, err)
        );
      }
    }, ms);
    this.timers.set(job.id, timer);
  }

  stopAll() {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }
}

/** Parse simple interval strings like "30s", "5m", "2h", "1d" */
export function parseInterval(schedule: string): number | null {
  const match = schedule.match(/^(\d+)\s*(s|sec|m|min|h|hr|d|day)s?$/i);
  if (!match) return null;
  const n = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case "s":
    case "sec":
      return n * 1000;
    case "m":
    case "min":
      return n * 60 * 1000;
    case "h":
    case "hr":
      return n * 60 * 60 * 1000;
    case "d":
    case "day":
      return n * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}
