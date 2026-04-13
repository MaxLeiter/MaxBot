# Skills

Skills follow the [Agent Skills](https://agentskills.io) open format. They live in the `skills/` directory and give the bot additional knowledge or behavioral guidance without touching any source code.

## How they work

Every time MaxBot handles a message, it scans `skills/` for subdirectories containing a `SKILL.md` file. It reads the YAML frontmatter (`name` and `description`) from each one and includes a summary in the system prompt. When the bot decides a skill is relevant, it reads the full `SKILL.md` to get the detailed instructions.

This means adding a new skill is just creating a directory with a `SKILL.md`. No code changes, no restart, no deploy. The bot picks it up on the next message.

## Writing a skill

A skill is a directory under `skills/` with at least a `SKILL.md` file:

```
skills/
  my-skill/
    SKILL.md          # required
    scripts/          # optional
    references/       # optional
    assets/           # optional
```

The `SKILL.md` starts with YAML frontmatter, then markdown instructions:

```
---
name: my-skill
description: What this skill does and when to use it. Be specific so the bot can match tasks to skills.
---

# my-skill

detailed instructions go here.

## when to use
- bullet points describing trigger conditions

## required behavior
- what the bot should actually do
- concrete rules, not vague suggestions
```

The `name` must match the directory name. Lowercase, hyphens only, no leading/trailing hyphens. The `description` is what the bot sees in its prompt to decide whether to activate the skill, so make it count.

## Current skills

- **websearch** - How to handle requests for current information. Covers citation format, source linking, and how to deal with conflicting results.
- **git-gh-pr-workflow** - The required workflow for self-modification. Branch naming, commit conventions, PR creation, and safety rules to avoid messing up the repo.

## Tips

- Keep skills focused. One skill per topic works better than a giant catch-all.
- Be specific about formatting expectations, especially for IRC where markdown doesn't render.
- The `description` in frontmatter is loaded into the system prompt on every query, so write a good one. The full body is only loaded when activated.
- If a skill needs reference material, put it in `references/` so it's only loaded on demand rather than bloating the main instructions.
- If a skill isn't working well, iterate on the wording. Small phrasing changes can make a big difference in how reliably the bot follows the instructions.
