# MaxBot

> ⚠️ This bot is largely written by AI and has real filesystem, shell, and network access on the machine it runs on. It can read and modify its own source code, execute shell commands, and push to GitHub. Run it on an isolated machine with a dedicated user and review all PRs it opens. Do not give it access to secrets beyond what it needs. ⚠️

A self-programmable IRC bot powered by Claude. It connects to IRC, responds to authorized users, and can modify its own source code, create new skills, and commit changes to persist improvements.

<!--
## Stack

- **Runtime:** Bun + TypeScript
- **IRC:** irc-framework
- **AI:** Claude Agent SDK, routed through Vercel AI Gateway
- **Hosting:** VPS (DigitalOcean) with systemd -->

It uses [`irc-framework`](https://github.com/kiwiirc/irc-framework) and the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview). Models can be accessed through
Anthropic or the [Vercel AI Gateway](https://vercel.com/gateway)

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

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md)
