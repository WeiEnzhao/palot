import { createStore } from "jotai";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { PalotMessage } from "../../shared";
import { composerActionRequestAtom } from "../atoms/command-requests";
import { renderWithRouter } from "../test-utils/render-with-router";
import { MessageRow, TimelineBoundary } from "./thread";
import type { TurnActivityGroup } from "../lib/turn-projection";

afterEach(() => {
  cleanup();
});

const userMessage: PalotMessage = {
  id: "user-1",
  type: "user",
  createdAt: 1,
  completedAt: 1,
  text: "改一下这个提示词",
  agent: null,
  model: null,
  tokens: null,
  finish: null,
  content: [],
  data: null,
};

describe("message hover actions", () => {
  it("asks the composer to revert the hovered user message", async () => {
    const store = createStore();
    renderWithRouter(<MessageRow message={userMessage} sessionID="session-1" />, store);

    await userEvent.click(screen.getByRole("button", { name: "撤回重编" }));

    const request = store.get(composerActionRequestAtom);
    expect(request?.action).toBe("reedit");
    expect(request?.messageID).toBe("user-1");
    expect(request?.sessionID).toBe("session-1");
  });

  it("offers no revert action on assistant messages", () => {
    const store = createStore();
    renderWithRouter(
      <MessageRow
        message={{ ...userMessage, id: "assistant-1", type: "assistant" }}
        sessionID="session-1"
      />,
      store,
    );
    expect(screen.queryByRole("button", { name: "撤回重编" })).toBeNull();
  });
});

describe("failed turn card", () => {
  it("offers a retry that targets the turn's user message", async () => {
    const store = createStore();
    const group: TurnActivityGroup = {
      id: "boundary-1",
      kind: "boundary",
      title: "Response failed",
      status: "failed",
      entries: [
        {
          message: { ...userMessage, id: "assistant-1", type: "assistant" },
          part: { type: "timeline-boundary", id: "part-1", name: "Response failed" },
          index: 0,
        },
      ],
    };
    renderWithRouter(
      <TimelineBoundary group={group} sessionID="session-1" userMessageID="user-1" />,
      store,
    );

    await userEvent.click(screen.getByRole("button", { name: "重试" }));

    const request = store.get(composerActionRequestAtom);
    expect(request?.action).toBe("retry");
    expect(request?.messageID).toBe("user-1");
  });
});
