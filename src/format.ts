/**
 * Convert IRC escape sequences (\x02 etc.) from Claude's text output
 * into actual control bytes.
 */
export function convertFormatCodes(text: string): string {
  return text
    .replace(/\\x02/g, "\x02")  // bold
    .replace(/\\x1[Dd]/g, "\x1D")  // italic
    .replace(/\\x1[Ff]/g, "\x1F")  // underline
    .replace(/\\x0[Ff]/g, "\x0F")  // reset
    .replace(/\\x03/g, "\x03");    // color
}

/**
 * Convert markdown formatting to IRC formatting codes.
 * Applied before convertFormatCodes so they don't conflict.
 */
export function markdownToIrc(text: string): string {
  // Code blocks (``` ... ```) — strip the fences, keep content
  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, code) => {
    return code.trimEnd();
  });

  // Inline code `text` → monospace (IRC has no monospace, use reverse video as convention)
  text = text.replace(/`([^`]+)`/g, "\x1D$1\x1D");

  // Headers # text → bold text (before inline formatting)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "\x02$1\x02");

  // Bullet lists - item or * item (before italic * matching eats them)
  text = text.replace(/^(\s*)[-*]\s+/gm, "$1• ");

  // Links [text](url) → text (url) (before bold/italic eat the brackets)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
    // If the text IS the url, just show the url once
    if (linkText === url) return url;
    return `${linkText} (${url})`;
  });

  // Strikethrough ~~text~~ → just keep the text
  text = text.replace(/~~(.+?)~~/g, "$1");

  // Bold+italic ***text*** or ___text___
  text = text.replace(/\*{3}(.+?)\*{3}/g, "\x02\x1D$1\x1D\x02");
  text = text.replace(/_{3}(.+?)_{3}/g, "\x02\x1D$1\x1D\x02");

  // Bold **text** or __text__
  text = text.replace(/\*{2}(.+?)\*{2}/g, "\x02$1\x02");
  text = text.replace(/_{2}(.+?)_{2}/g, "\x02$1\x02");

  // Italic *text* or _text_ (but not mid-word underscores like foo_bar_baz)
  text = text.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "\x1D$1\x1D");
  text = text.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "\x1D$1\x1D");

  // Numbered lists 1. item → keep as-is (already plain enough)

  return text;
}

/**
 * Full pipeline: markdown → IRC codes → control bytes
 */
export function formatForIrc(text: string): string {
  return convertFormatCodes(markdownToIrc(text));
}
