# Skills

[Skills](https://agentskills.io/home) are markdown files that live in the `skills/` directory. They give the bot additional knowledge or behavioral guidance without touching any source code.

## How they work

Every time MaxBot handles a message, it scans `skills/` for `.md` files. It loads the first line of each file as a one-line description and includes the list in the system prompt. When the bot decides a skill is relevant, it reads the full file to get the detailed instructions.

This means adding a new skill is just creating a file. No code changes, no restart, no deploy. Drop a markdown file in the folder and the bot picks it up on the next message.

## Writing a skill

A skill file should start with a heading that doubles as a short description, then lay out when to use it and what to do. Keep it practical. The bot reads these as instructions, not documentation.

Here's the general shape:

```
# short-name

one sentence saying when this skill applies.

## when to use
- bullet points describing trigger conditions

## required behavior
- what the bot should actually do
- concrete rules, not vague suggestions
```

The filename (minus `.md`) becomes the skill name shown in the prompt. Name it something descriptive.
