# MaxBot

Self-programmable IRC bot. TypeScript, bun, irc-framework, Claude Agent SDK.

## Project Structure
- `src/index.ts` — entry point, wires IRC client + agent
- `src/irc.ts` — IRC client wrapper
- `src/agent.ts` — Claude Agent SDK query orchestration
- `src/tools.ts` — IRC action tools (send_message, action, join, part, scrollback)
- `src/context.ts` — sliding window message buffer + active channel tracking
- `src/prompt.ts` — system prompt builder (reads skills/*/SKILL.md)
- `src/config.ts` — env var config loading
- `skills/` — Agent Skills (agentskills.io format) with guidance/knowledge for the bot
- `types/irc-framework.d.ts` — type declarations for irc-framework

## Conventions
- Commit messages: short, lowercase, descriptive
- Never modify .env or credentials
- IRC responses: concise, plain text, no code fences or markdown
- Always git commit after making changes

## Adding a Skill
Create a directory in `skills/` with a `SKILL.md` file (Agent Skills format). It will be automatically discovered on the next message. No code changes needed. See `docs/skills.md` for details.

## Modifying Core Code
Changes to `src/*.ts` require a process restart (`sudo systemctl restart maxbot`). Be conservative with core changes — test carefully.

## Running
- `bun run src/index.ts` — start the bot
- `bun install` — install dependencies
