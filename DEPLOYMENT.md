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
