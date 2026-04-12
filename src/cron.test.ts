import { describe, test, expect } from "bun:test";
import { parseInterval } from "./cron.js";

describe("parseInterval", () => {
  test("parses seconds", () => {
    expect(parseInterval("30s")).toBe(30_000);
    expect(parseInterval("1sec")).toBe(1_000);
    expect(parseInterval("5secs")).toBe(5_000);
  });

  test("parses minutes", () => {
    expect(parseInterval("5m")).toBe(300_000);
    expect(parseInterval("1min")).toBe(60_000);
    expect(parseInterval("10mins")).toBe(600_000);
  });

  test("parses hours", () => {
    expect(parseInterval("1h")).toBe(3_600_000);
    expect(parseInterval("2hr")).toBe(7_200_000);
    expect(parseInterval("3hrs")).toBe(10_800_000);
  });

  test("parses days", () => {
    expect(parseInterval("1d")).toBe(86_400_000);
    expect(parseInterval("2day")).toBe(172_800_000);
    expect(parseInterval("7days")).toBe(604_800_000);
  });

  test("returns null for invalid input", () => {
    expect(parseInterval("")).toBeNull();
    expect(parseInterval("abc")).toBeNull();
    expect(parseInterval("5")).toBeNull();
    expect(parseInterval("5x")).toBeNull();
    expect(parseInterval("* * * * *")).toBeNull();
  });

  test("is case insensitive", () => {
    expect(parseInterval("5M")).toBe(300_000);
    expect(parseInterval("1H")).toBe(3_600_000);
    expect(parseInterval("2D")).toBe(172_800_000);
  });
});
