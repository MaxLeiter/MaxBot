import { describe, test, expect } from "bun:test";

// Test the format code conversion logic directly
// (extracted from IrcClient.convertFormatCodes)
function convertFormatCodes(text: string): string {
  return text
    .replace(/\\x02/g, "\x02")
    .replace(/\\x1[Dd]/g, "\x1D")
    .replace(/\\x1[Ff]/g, "\x1F")
    .replace(/\\x0[Ff]/g, "\x0F")
    .replace(/\\x03/g, "\x03");
}

describe("convertFormatCodes", () => {
  test("converts bold codes", () => {
    const result = convertFormatCodes("this is \\x02bold\\x02 text");
    expect(result).toBe("this is \x02bold\x02 text");
  });

  test("converts italic codes", () => {
    const result = convertFormatCodes("\\x1Ditalic\\x1D");
    expect(result).toBe("\x1Ditalic\x1D");
  });

  test("converts underline codes", () => {
    const result = convertFormatCodes("\\x1Funderline\\x1F");
    expect(result).toBe("\x1Funderline\x1F");
  });

  test("converts color codes", () => {
    const result = convertFormatCodes("\\x034red text\\x03");
    expect(result).toBe("\x034red text\x03");
  });

  test("converts reset codes", () => {
    const result = convertFormatCodes("styled\\x0F plain");
    expect(result).toBe("styled\x0F plain");
  });

  test("handles multiple format codes", () => {
    const result = convertFormatCodes("\\x02bold\\x02 and \\x1Ditalic\\x1D");
    expect(result).toBe("\x02bold\x02 and \x1Ditalic\x1D");
  });

  test("leaves plain text unchanged", () => {
    const result = convertFormatCodes("just normal text");
    expect(result).toBe("just normal text");
  });

  test("handles case variations", () => {
    expect(convertFormatCodes("\\x1ditalic\\x1d")).toBe("\x1Ditalic\x1D");
    expect(convertFormatCodes("\\x1funder\\x1f")).toBe("\x1Funder\x1F");
    expect(convertFormatCodes("\\x0freset\\x0f")).toBe("\x0Freset\x0F");
  });
});
