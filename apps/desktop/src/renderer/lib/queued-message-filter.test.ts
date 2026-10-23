import { describe, expect, it } from "vitest";
import type { PalotMessage } from "../../shared";
import { filterQueuedMessages, isQueuedMessage } from "./queued-message-filter";

function makeMessage(overrides: Partial<PalotMessage> = {}): PalotMessage {
  return {
    id: "msg-1",
    type: "user",
    createdAt: Date.now(),
    completedAt: null,
    text: "测试消息",
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [],
    data: {},
    ...overrides,
  };
}

describe("isQueuedMessage", () => {
  it("delivery 为 queue 且无 runStartedAt/promotedAt 时返回 true", () => {
    const message = makeMessage({ delivery: "queue" });
    expect(isQueuedMessage(message)).toBe(true);
  });

  it("delivery 为 steer 时返回 false", () => {
    const message = makeMessage({ delivery: "steer" });
    expect(isQueuedMessage(message)).toBe(false);
  });

  it("delivery 为 queue 但有 runStartedAt 时返回 false（已消费）", () => {
    const message = makeMessage({ delivery: "queue", runStartedAt: Date.now() });
    expect(isQueuedMessage(message)).toBe(false);
  });

  it("delivery 为 queue 但有 promotedAt 时返回 false（已提升）", () => {
    const message = makeMessage({ delivery: "queue", promotedAt: Date.now() });
    expect(isQueuedMessage(message)).toBe(false);
  });

  it("无 delivery 字段时返回 false", () => {
    const message = makeMessage();
    expect(isQueuedMessage(message)).toBe(false);
  });
});

describe("filterQueuedMessages", () => {
  it("过滤掉仍在排队的消息", () => {
    const messages = [
      makeMessage({ id: "1", delivery: "steer" }),
      makeMessage({ id: "2", delivery: "queue" }),
      makeMessage({ id: "3", delivery: "queue", runStartedAt: Date.now() }),
      makeMessage({ id: "4" }),
    ];
    const filtered = filterQueuedMessages(messages);
    expect(filtered).toHaveLength(3);
    expect(filtered.map((m) => m.id)).toEqual(["1", "3", "4"]);
  });

  it("无排队消息时返回原数组引用", () => {
    const messages = [
      makeMessage({ id: "1", delivery: "steer" }),
      makeMessage({ id: "2", delivery: "queue", runStartedAt: Date.now() }),
    ];
    const filtered = filterQueuedMessages(messages);
    expect(filtered).toBe(messages);
  });

  it("保留已提升的排队消息", () => {
    const messages = [
      makeMessage({ id: "1", delivery: "queue" }),
      makeMessage({ id: "2", delivery: "queue", promotedAt: Date.now() }),
    ];
    const filtered = filterQueuedMessages(messages);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe("2");
  });

  it("空数组返回空数组", () => {
    expect(filterQueuedMessages([])).toEqual([]);
  });
});
