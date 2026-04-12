# MaxBot

> **Warning**
> This bot is largely written by AI and has real filesystem, shell, and network access on the machine it runs on. It can read and modify its own source code, execute shell commands, and push to GitHub. Run it on an isolated machine with a dedicated user and review all PRs it opens. Do not give it access to secrets beyond what it needs.

A self-programmable IRC bot powered by Claude. It connects to IRC, responds to authorized users, and can modify its own source code, create new skills, and commit changes to persist improvements.

## Stack

- **Runtime:** Bun + TypeScript
- **IRC:** irc-framework
- **AI:** Claude Agent SDK, routed through Vercel AI Gateway
- **Hosting:** VPS (DigitalOcean) with systemd

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
- **Skills** — markdown files in `skills/` indexed by name in the prompt, full content loaded on demand via Read tool
- **Self-programming** — Claude can read/write its own source, create skills, and open PRs via GitHub CLI
- **Debug mode** — `!debug` toggles live /me actions showing thinking and tool calls in IRC
- **Bot commands** — `!restart`, `!pull`, `!status`, `!model`, `!debug`, `!help` bypass AI entirely
- **Markdown to IRC** — auto-converts markdown bold, italic, links, code, headers to IRC formatting
- **Cron jobs** — persistent scheduled tasks stored in `data/crons.json`
- **Model switching** — change models on the fly via IRC, validated against the AI Gateway
- **IRC formatting** — converts `\x02` bold, `\x03` color codes, etc. for native IRC rendering
- **Guardrails** — only responds to authorized users, only sends to recently-addressed channels

## Deploy to a VPS

### Quick setup (Ubuntu)

```sh
ssh root@your-server 'bash -s' < deploy/setup.sh
```

This installs bun, Node.js 22, Claude Code CLI, creates a `maxbot` user, and sets up the systemd service.

Then:

```sh
# Set your API keys
ssh root@your-server 'nano /etc/maxbot/.env'

# Start the bot
ssh root@your-server 'systemctl start maxbot'

# Watch logs
ssh root@your-server 'journalctl -u maxbot -f'
```

### Prerequisites

The setup script handles all of these, but for reference:

- **Bun** — runtime
- **Node.js 22+** — required by Claude Code CLI (the Agent SDK spawns it as a subprocess)
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`
- **Claude Code permissions** — WebSearch/WebFetch must be allowed in `~maxbot/.claude/settings.json` (setup script creates this)
- **GitHub CLI** — `gh` authenticated for the maxbot user, used for opening PRs

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
  format.ts     — markdown-to-IRC formatting conversion
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
