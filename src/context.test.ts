import { describe, test, expect } from "bun:test";
import { ContextManager } from "./context.js";

describe("ContextManager", () => {
  describe("recordMessage / getRecentMessages", () => {
    test("returns empty for unknown channel", () => {
      const ctx = new ContextManager();
      expect(ctx.getRecentMessages("#unknown")).toEqual([]);
    });

    test("records and retrieves messages", () => {
      const ctx = new ContextManager();
      ctx.recordMessage("alice", "#test", "hello");
      ctx.recordMessage("bob", "#test", "hi there");

      const msgs = ctx.getRecentMessages("#test");
      expect(msgs).toHaveLength(2);
      expect(msgs[0].nick).toBe("alice");
      expect(msgs[1].message).toBe("hi there");
    });

    test("is case-insensitive on channel name", () => {
      const ctx = new ContextManager();
      ctx.recordMessage("alice", "#Test", "one");
      ctx.recordMessage("bob", "#test", "two");
      ctx.recordMessage("carol", "#TEST", "three");

      const msgs = ctx.getRecentMessages("#test");
      expect(msgs).toHaveLength(3);
    });

    test("returns only the last N messages", () => {
      const ctx = new ContextManager();
      for (let i = 0; i < 30; i++) {
        ctx.recordMessage("user", "#test", `msg ${i}`);
      }

      const msgs = ctx.getRecentMessages("#test", 5);
      expect(msgs).toHaveLength(5);
      expect(msgs[0].message).toBe("msg 25");
      expect(msgs[4].message).toBe("msg 29");
    });
  });

  describe("buffer size limit", () => {
    test("evicts old messages when buffer is full", () => {
      const ctx = new ContextManager(10);
      for (let i = 0; i < 20; i++) {
        ctx.recordMessage("user", "#test", `msg ${i}`);
      }

      const msgs = ctx.getRecentMessages("#test", 100);
      expect(msgs).toHaveLength(10);
      expect(msgs[0].message).toBe("msg 10");
      expect(msgs[9].message).toBe("msg 19");
    });
  });

  describe("getScrollback", () => {
    test("returns older messages with offset", () => {
      const ctx = new ContextManager();
      for (let i = 0; i < 50; i++) {
        ctx.recordMessage("user", "#test", `msg ${i}`);
      }

      // Skip the most recent 20, get the 10 before that
      const msgs = ctx.getScrollback("#test", 20, 10);
      expect(msgs).toHaveLength(10);
      expect(msgs[0].message).toBe("msg 20");
      expect(msgs[9].message).toBe("msg 29");
    });

    test("returns empty for out-of-range offset", () => {
      const ctx = new ContextManager();
      ctx.recordMessage("user", "#test", "only one");

      const msgs = ctx.getScrollback("#test", 100, 10);
      expect(msgs).toHaveLength(0);
    });

    test("returns partial results at the edge", () => {
      const ctx = new ContextManager();
      for (let i = 0; i < 5; i++) {
        ctx.recordMessage("user", "#test", `msg ${i}`);
      }

      // offset 3, count 10 -> should get msgs 0,1 (only 2 available before offset)
      const msgs = ctx.getScrollback("#test", 3, 10);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].message).toBe("msg 0");
      expect(msgs[1].message).toBe("msg 1");
    });
  });

  describe("activeChannels", () => {
    test("channel is not active by default", () => {
      const ctx = new ContextManager();
      expect(ctx.isActiveChannel("#test")).toBe(false);
    });

    test("channel becomes active after markActive", () => {
      const ctx = new ContextManager();
      ctx.markActive("#test");
      expect(ctx.isActiveChannel("#test")).toBe(true);
    });

    test("is case-insensitive", () => {
      const ctx = new ContextManager();
      ctx.markActive("#Test");
      expect(ctx.isActiveChannel("#test")).toBe(true);
      expect(ctx.isActiveChannel("#TEST")).toBe(true);
    });
  });

  describe("getBufferSizes", () => {
    test("returns sizes for all channels", () => {
      const ctx = new ContextManager();
      ctx.recordMessage("a", "#one", "hi");
      ctx.recordMessage("b", "#one", "hey");
      ctx.recordMessage("c", "#two", "yo");

      const sizes = ctx.getBufferSizes();
      expect(sizes["#one"]).toBe(2);
      expect(sizes["#two"]).toBe(1);
    });
  });

  describe("formatMessages", () => {
    test("formats empty array", () => {
      const ctx = new ContextManager();
      expect(ctx.formatMessages([])).toBe("(no recent messages)");
    });

    test("formats messages as IRC-style lines", () => {
      const ctx = new ContextManager();
      const msgs = [
        { nick: "alice", target: "#test", message: "hello", timestamp: 0 },
        { nick: "bob", target: "#test", message: "hi", timestamp: 1 },
      ];
      expect(ctx.formatMessages(msgs)).toBe("<alice> hello\n<bob> hi");
    });
  });
});
