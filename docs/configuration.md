# Configuration

MaxBot uses environment variables for connection setup and a JSON file for runtime settings.

## Environment variables

Set these before starting the bot. They configure the IRC connection and Claude integration.

| Variable | Default | Description |
|---|---|---|
| `IRC_HOST` | `irc.libera.chat` | IRC server hostname |
| `IRC_PORT` | `6697` | IRC server port |
| `IRC_TLS` | `true` | Use TLS |
| `IRC_NICK` | `MaxBot` | Bot's nickname |
| `IRC_USERNAME` | `maxbot` | IRC username |
| `IRC_NICKSERV_PASSWORD` | - | NickServ password (used for SASL auth) |
| `CLAUDE_MAX_TURNS` | `25` | Max tool-use turns per query |
| `ANTHROPIC_API_KEY` | - | API key for Claude |
| `ANTHROPIC_BASE_URL` | - | Custom API gateway URL |
| `ANTHROPIC_AUTH_TOKEN` | - | Auth token (used instead of API key when set) |

## Runtime settings

Stored in `data/settings.json`. These can be changed while the bot is running, either through IRC commands or by the bot itself.

```json
{
  "model": "claude-sonnet-4-6",
  "channels": ["#bot-testing"],
  "authorizedUsers": ["maxleiter"],
  "debug": false
}
```

- **model** - Which AI model to use. Can be changed via IRC by asking the bot to switch.
- **channels** - Auto-join list. Updated when the bot joins or leaves channels.
- **authorizedUsers** - Who the bot listens to. Everyone else is ignored.
- **debug** - When on, the bot sends `/me` actions showing its thinking and tool calls in real time. Useful for watching what it's doing, noisy otherwise.

If the settings file doesn't exist, defaults are used and the file gets created on the first change.

## Bang commands

These are handled directly, no AI involved:

- `!restart` - Restart the systemd service
- `!pull` - Pull latest code from main
- `!status` - Quick stats (uptime, queries, cost, model)
- `!model` - Show current model
- `!debug` - Toggle debug mode
- `!help` - List commands
