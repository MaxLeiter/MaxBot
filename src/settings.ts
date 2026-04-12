import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as log from "./log.js";

const DATA_DIR = join(import.meta.dir, "..", "data");
const SETTINGS_FILE = join(DATA_DIR, "settings.json");

export interface Settings {
  model: string;
  channels: string[];
  authorizedUsers: string[];
}

const DEFAULTS: Settings = {
  model: "claude-sonnet-4-6",
  channels: ["#bot-testing"],
  authorizedUsers: ["maxleiter"],
};

let current: Settings = { ...DEFAULTS };

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await readFile(SETTINGS_FILE, "utf-8");
    const saved = JSON.parse(raw);
    current = { ...DEFAULTS, ...saved };
    log.logInfo(`Settings loaded: model=${current.model}, channels=${current.channels.join(",")}, users=${current.authorizedUsers.join(",")}`);
  } catch {
    log.logInfo("No settings file, using defaults");
  }
  return current;
}

export async function saveSettings(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(current, null, 2));
}

export function getSettings(): Settings {
  return current;
}

export async function updateSettings(partial: Partial<Settings>): Promise<Settings> {
  Object.assign(current, partial);
  await saveSettings();
  return current;
}
