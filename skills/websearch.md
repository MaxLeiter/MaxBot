# websearch

use this skill when the user wants current information from the web, or asks you to search online.

## when to use
- current events, recent docs, pricing, availability, flight info, product details, live status, breaking news
- anything likely newer than your training data
- questions where a source matters

## required behavior
- use the websearch tool for the search
- after answering, include citations inline as [1], [2], etc when referencing sourced claims
- end with a single line starting with `sources:` followed by the cited links only, in citation order
- do not repeat site names in the sources line, just the raw links
- keep the sources on one line
- if there is only one source, still use the same `sources:` format
- if search results conflict, say so plainly and note which source says what
- if the answer is uncertain, say that instead of pretending otherwise

## irc formatting
- keep answers short and readable for irc
- no markdown bullets unless the surrounding response really needs a list
- citations should stay plain, like [1] or [2]

## example
answer: united's 737-900s generally have in-seat power in economy and first, but configurations can vary by aircraft and retrofit status [1][2]
sources: https://www.united.com/en/us/fly/company/aircraft/boeing-737-900.html https://www.seatguru.com/airlines/United_Airlines/United_Airlines_Boeing_737-900.php
