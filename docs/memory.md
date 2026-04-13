# Memory

MaxBot has two kinds of memory: channel memory and message history. Both persist across restarts.

## Channel memory

Each channel can have a memory file at `data/channels/<channel>.md`. This gets loaded into the prompt whenever the bot responds in that channel, giving it persistent context about the people, topics, and norms of that space.

The bot can create and update these files on its own. If it learns something worth remembering long-term (who the regulars are, what projects come up often, channel preferences), it can write it down. You can also ask it to remember or forget things explicitly.

Channel memory files should stay concise. They're included in every single prompt for that channel, so bloat has a real cost. Ephemeral stuff doesn't belong here. If it won't matter in a week, skip it.

The channel name gets sanitized for the filesystem: `#bot-testing` becomes `bot-testing.md`.

## Message history

The bot keeps a sliding window of recent messages per channel, stored in `data/history.json`. By default it buffers the last 200 messages per channel and includes the 20 most recent in each prompt as context.

History auto-saves every 60 seconds when there are changes, and saves on shutdown. It also loads from disk on startup so the bot doesn't lose context across restarts.

If the bot needs more context than the 20 most recent messages, it can use the `get_scrollback` tool to pull older messages from the buffer.

## What memory is not

The bot doesn't have cross-session conversational memory in the traditional sense. It doesn't remember what you talked about yesterday unless it wrote something to channel memory or the messages are still in the history buffer. It's more like a person who keeps good notes than one with perfect recall.
