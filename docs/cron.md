# Cron Jobs and Reminders

MaxBot can run recurring tasks on a schedule and set one-time reminders. Both are created through IRC and persist across restarts.

## Cron jobs

A cron job has three parts: a schedule (how often), a prompt (what to do), and a target (where to send the result). When a cron fires, the prompt gets sent through the full AI pipeline, just like a regular message, and the response goes to the target channel or user.

The prompt should be natural language. Something like "check the weather in NYC and report it" or "say something interesting about a random programming language". Not code.

### Managing crons

From IRC, just ask the bot in natural language:

- "set up a cron that checks the weather every hour and posts in #general"
- "list my cron jobs"
- "delete cron abc123"

The bot uses the `create_cron`, `list_crons`, and `delete_cron` tools under the hood. Each job gets a random 6-character ID for reference.

## Reminders

Reminders are one-shot. You say "remind me in 4 hours to check the deploy" and the bot sets a timer, fires once when it's up, and deletes itself.

Under the hood, reminders are stored the same way as cron jobs (in `data/crons.json`) with a `once` flag and an absolute `fireAt` timestamp. This means they survive restarts. If the bot was down when a reminder was supposed to fire, it fires immediately on startup.

### Examples

- "remind me in 30 minutes to check the build"
- "in 2 hours, tell me to take a break"
- "set a reminder for 1 day from now to follow up on the PR"

The bot figures out who asked and includes that in the reminder prompt so the message is directed at the right person.

## Schedule format

Both crons and reminders use the same interval format:

- `30s`, `30sec` - 30 seconds
- `5m`, `5min` - 5 minutes
- `2h`, `2hr` - 2 hours
- `1d`, `1day` - 1 day

No cron expressions, just intervals. For crons, the timer starts from when the bot boots, not from any particular clock time. For reminders, the delay is relative to when you asked.

## Things to keep in mind

- Each firing runs a full AI query, which costs tokens. A cron running every 5 minutes adds up. Reminders are just one query each.
- The bot temporarily allows the target channel for the duration of the query, then revokes access. This means scheduled jobs can post to channels the bot hasn't been recently active in.
- Both crons and reminders are stored in `data/crons.json` and survive restarts.
