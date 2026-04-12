import { describe, test, expect } from "bun:test";
import { convertFormatCodes, markdownToIrc, formatForIrc } from "./format.js";

describe("convertFormatCodes", () => {
  test("converts bold codes", () => {
    expect(convertFormatCodes("this is \\x02bold\\x02 text")).toBe("this is \x02bold\x02 text");
  });

  test("converts italic codes", () => {
    expect(convertFormatCodes("\\x1Ditalic\\x1D")).toBe("\x1Ditalic\x1D");
  });

  test("converts underline codes", () => {
    expect(convertFormatCodes("\\x1Funderline\\x1F")).toBe("\x1Funderline\x1F");
  });

  test("converts color codes", () => {
    expect(convertFormatCodes("\\x034red text\\x03")).toBe("\x034red text\x03");
  });

  test("converts reset codes", () => {
    expect(convertFormatCodes("styled\\x0F plain")).toBe("styled\x0F plain");
  });

  test("handles multiple format codes", () => {
    expect(convertFormatCodes("\\x02bold\\x02 and \\x1Ditalic\\x1D"))
      .toBe("\x02bold\x02 and \x1Ditalic\x1D");
  });

  test("leaves plain text unchanged", () => {
    expect(convertFormatCodes("just normal text")).toBe("just normal text");
  });

  test("handles case variations", () => {
    expect(convertFormatCodes("\\x1ditalic\\x1d")).toBe("\x1Ditalic\x1D");
    expect(convertFormatCodes("\\x1funder\\x1f")).toBe("\x1Funder\x1F");
    expect(convertFormatCodes("\\x0freset\\x0f")).toBe("\x0Freset\x0F");
  });
});

describe("markdownToIrc", () => {
  test("converts **bold** to IRC bold", () => {
    expect(markdownToIrc("this is **bold** text")).toBe("this is \x02bold\x02 text");
  });

  test("converts __bold__ to IRC bold", () => {
    expect(markdownToIrc("this is __bold__ text")).toBe("this is \x02bold\x02 text");
  });

  test("converts *italic* to IRC italic", () => {
    expect(markdownToIrc("this is *italic* text")).toBe("this is \x1Ditalic\x1D text");
  });

  test("converts _italic_ to IRC italic", () => {
    expect(markdownToIrc("this is _italic_ text")).toBe("this is \x1Ditalic\x1D text");
  });

  test("does not convert mid-word underscores", () => {
    expect(markdownToIrc("foo_bar_baz")).toBe("foo_bar_baz");
  });

  test("converts ***bold italic*** to IRC bold+italic", () => {
    expect(markdownToIrc("***wow***")).toBe("\x02\x1Dwow\x1D\x02");
  });

  test("converts `code` to IRC italic", () => {
    expect(markdownToIrc("run `npm install` now")).toBe("run \x1Dnpm install\x1D now");
  });

  test("strips code block fences", () => {
    const input = "here:\n```js\nconsole.log('hi');\n```\ndone";
    expect(markdownToIrc(input)).toBe("here:\nconsole.log('hi');\ndone");
  });

  test("strips code block fences without language", () => {
    const input = "```\nsome code\n```";
    expect(markdownToIrc(input)).toBe("some code");
  });

  test("converts [text](url) to text (url)", () => {
    expect(markdownToIrc("see [the docs](https://example.com) here"))
      .toBe("see the docs (https://example.com) here");
  });

  test("converts npm-style links", () => {
    expect(markdownToIrc("[thelounge on npm](https://www.npmjs.com/package/thelounge)"))
      .toBe("thelounge on npm (https://www.npmjs.com/package/thelounge)");
  });

  test("deduplicates when link text equals url", () => {
    expect(markdownToIrc("[https://example.com](https://example.com)"))
      .toBe("https://example.com");
  });

  test("converts multiple links", () => {
    expect(markdownToIrc("[a](http://a.com) and [b](http://b.com)"))
      .toBe("a (http://a.com) and b (http://b.com)");
  });

  test("converts headers to bold", () => {
    expect(markdownToIrc("# Title")).toBe("\x02Title\x02");
    expect(markdownToIrc("## Subtitle")).toBe("\x02Subtitle\x02");
    expect(markdownToIrc("### Deep")).toBe("\x02Deep\x02");
  });

  test("converts bullet lists to plain bullets", () => {
    expect(markdownToIrc("- item one\n- item two")).toBe("• item one\n• item two");
    expect(markdownToIrc("* item one\n* item two")).toBe("• item one\n• item two");
  });

  test("strips strikethrough", () => {
    expect(markdownToIrc("this is ~~deleted~~ text")).toBe("this is deleted text");
  });

  test("leaves plain text unchanged", () => {
    expect(markdownToIrc("just normal text")).toBe("just normal text");
  });

  test("handles mixed formatting", () => {
    const input = "**bold** and *italic* and `code` and [link](http://x.com)";
    const expected = "\x02bold\x02 and \x1Ditalic\x1D and \x1Dcode\x1D and link (http://x.com)";
    expect(markdownToIrc(input)).toBe(expected);
  });
});

describe("formatForIrc (full pipeline)", () => {
  test("converts markdown then escape sequences", () => {
    // Markdown bold + explicit IRC color code
    const input = "**hello** \\x034world\\x03";
    const result = formatForIrc(input);
    expect(result).toBe("\x02hello\x02 \x034world\x03");
  });

  test("handles text with no formatting", () => {
    expect(formatForIrc("plain text")).toBe("plain text");
  });
});
