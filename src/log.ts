// ANSI color helpers for terminal output

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",

  // foreground
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

function timestamp(): string {
  const d = new Date();
  return `${c.gray}${d.toLocaleTimeString()}${c.reset}`;
}

export function logMessage(target: string, nick: string, message: string) {
  console.log(`${timestamp()} ${c.cyan}[${target}]${c.reset} ${c.bold}<${nick}>${c.reset} ${message}`);
}

export function logReply(target: string, message: string) {
  const preview = message.length > 120 ? message.slice(0, 120) + "..." : message;
  console.log(`${timestamp()} ${c.cyan}[${target}]${c.reset} ${c.green}→ ${preview}${c.reset}`);
}

export function logSkip(reason?: string) {
  console.log(`${timestamp()} ${c.gray}  ⊘ skipped${reason ? `: ${reason}` : ""}${c.reset}`);
}

export function logToolCall(name: string, args?: Record<string, any>) {
  const shortName = name.replace("mcp__irc__", "").replace("mcp__", "");
  const argStr = args
    ? " " + Object.entries(args)
        .map(([k, v]) => {
          const val = typeof v === "string" && v.length > 60 ? v.slice(0, 60) + "..." : v;
          return `${c.gray}${k}=${c.reset}${val}`;
        })
        .join(" ")
    : "";
  console.log(`${timestamp()} ${c.yellow}  ⚡ ${shortName}${c.reset}${argStr}`);
}

export function logThinking(text: string) {
  const preview = text.length > 100 ? text.slice(0, 100) + "..." : text;
  console.log(`${timestamp()} ${c.magenta}  💭 ${preview}${c.reset}`);
}

export function logQueryResult(
  queryNum: number,
  model: string,
  turns: number,
  tokens: number,
  cost: number,
  elapsedMs: number
) {
  console.log(
    `${timestamp()} ${c.blue}  ✓ query #${queryNum}${c.reset} ${c.dim}[${model}]${c.reset} ` +
    `${turns} turns, ${c.bold}${tokens}${c.reset} tokens, ` +
    `${c.green}$${cost.toFixed(4)}${c.reset}, ${elapsedMs}ms`
  );
}

export function logQueryError(queryNum: number, elapsedMs: number, error: string) {
  console.log(
    `${timestamp()} ${c.red}  ✗ query #${queryNum}${c.reset} (${elapsedMs}ms): ${error}`
  );
}

export function logSessionTotal(tokens: number, cost: number) {
  console.log(
    `${timestamp()} ${c.dim}  session: ${tokens} tokens, $${cost.toFixed(4)}${c.reset}`
  );
}

export function logCron(id: string, prompt: string, target: string) {
  console.log(
    `${timestamp()} ${c.yellow}[cron ${id}]${c.reset} "${prompt.slice(0, 60)}" → ${c.cyan}${target}${c.reset}`
  );
}

export function logStartup(host: string, port: number) {
  console.log(`${c.bold}${c.green}MaxBot starting${c.reset} — ${host}:${port}`);
}

export function logConnected(nick: string) {
  console.log(`${timestamp()} ${c.green}Connected as ${c.bold}${nick}${c.reset}`);
}

export function logJoin(channel: string) {
  console.log(`${timestamp()} ${c.green}Joining ${c.bold}${channel}${c.reset}`);
}

export function logInfo(msg: string) {
  console.log(`${timestamp()} ${c.dim}${msg}${c.reset}`);
}

export function logError(msg: string, err?: any) {
  console.error(`${timestamp()} ${c.red}${msg}${c.reset}`, err ?? "");
}
