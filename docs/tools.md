# Tools

MaxBot has access to two categories of tools: IRC-specific toolcalls and general-purpose tools from the Claude Agent SDK.

## IRC tools

These are defined in `src/tools.ts` and served to the agent as an MCP server.

- **send_irc_message** - Send a message to a channel or user. Only works for channels where the bot has been recently addressed (within 30 minutes). This prevents the bot from randomly messaging channels it hasn't been active in.
- **irc_action** - Send a `/me` style action. Same channel restrictions apply.
- **join_channel** - Join a new channel. Also persists the channel to settings so it auto-joins on restart.
- **part_channel** - Leave a channel. Removes it from the auto-join list.
- **get_scrollback** - Pull older messages from the history buffer beyond what's already in the prompt context.
- **bot_status** - Returns uptime, query count, token usage, cost, buffer sizes, and active cron jobs.
- **change_model** - Switch the AI model. Validates against the gateway's model list before accepting.
- **create_cron / delete_cron / list_crons** - Manage recurring scheduled tasks. The prompt is natural language, not code.
- **create_reminder** - Set a one-time delayed task (like a cron that fires once and deletes itself). Used for "remind me in X" requests.
- **skip_reply** - Opt out of replying when the bot's name was mentioned but a response isn't warranted.

## General-purpose tools

These come from the Agent SDK and give the bot access to the local system:

- **Read / Write / Edit** - File operations on the bot's own source code and data files.
- **Bash** - Run shell commands.
- **Glob / Grep** - Search for files and content.
- **WebSearch / WebFetch** - Look things up on the web.
- **AskUserQuestion** - Ask the user a clarifying question over IRC and wait for their reply (with a 2-minute timeout).

## Security constraints

The bot runs with `bypassPermissions` mode, so it doesn't need approval for tool calls. But it has guardrails in the system prompt:

- It can never read `.env` files or print environment variables containing keys.
- Sensitive env vars (API keys, passwords) are stripped from the environment passed to the agent.
- Secret values are scrubbed from any debug output sent to IRC.
- It can only message channels where it's been recently active.
