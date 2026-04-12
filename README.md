# MaxBot

A self-programmable IRC bot powered by Claude. It connects to IRC, responds to authorized users, and can modify its own source code, create new skills, and commit changes to persist improvements.

## Stack

- **Runtime:** Bun + TypeScript
- **IRC:** irc-framework
- **AI:** Claude Agent SDK, routed through Vercel AI Gateway
- **Hosting:** Fly.io with persistent volume

## Quick Start

```sh
cp .env.example .env
# fill in ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN (or ANTHROPIC_API_KEY)
bun install
bun run src/index.ts
```

## Configuration

**Secrets** go in `.env` (API keys, NickServ password). See `.env.example`.

**Runtime settings** live in `data/settings.json` and can be changed via IRC or by editing the file:

```json
{
  "model": "anthropic/claude-sonnet-4.5",
  "channels": ["#bot-testing"],
  "authorizedUsers": ["maxleiter"]
}
```

## Features

- **Sliding context window** — buffers 200 messages per channel, includes the last 20 in each prompt, with a scrollback tool for more
- **Channel memory** — persistent per-channel knowledge at `data/channels/<name>.md`, auto-loaded into context
- **Skills** — markdown files in `skills/` included in the system prompt. No restart needed
- **Self-programming** — Claude can read/write its own source, create skills, and commit via git
- **Cron jobs** — persistent scheduled tasks stored in `data/crons.json`
- **Model switching** — change models on the fly via IRC, validated against the AI Gateway
- **IRC formatting** — converts `\x02` bold, `\x03` color codes, etc. for native IRC rendering
- **Guardrails** — only responds to authorized users, only sends to recently-addressed channels

## Deploy to Fly.io

```sh
fly launch          # first time
fly vol create maxbot_data --size 1 --region iad
fly secrets set ANTHROPIC_BASE_URL=https://ai-gateway.vercel.sh ANTHROPIC_AUTH_TOKEN=...
fly deploy
```

## Project Structure

```
src/
  index.ts      — entry point, wires IRC + agent
  agent.ts      — Claude Agent SDK query orchestration
  irc.ts        — IRC client wrapper
  tools.ts      — IRC tools (say, action, join, cron, status, etc.)
  context.ts    — sliding window message buffer
  cron.ts       — persistent cron job manager
  prompt.ts     — system + user prompt builder
  settings.ts   — persistent runtime settings
  config.ts     — env var loading
  log.ts        — colored terminal logging
skills/         — markdown skill files (loaded into prompt)
data/           — persistent state (gitignored)
  settings.json
  history.json
  crons.json
  channels/     — per-channel memory files
```

## Tests

```sh
bun test
```
