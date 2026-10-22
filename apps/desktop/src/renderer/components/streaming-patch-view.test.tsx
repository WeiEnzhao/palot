import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClipboardText } from "../lib/clipboard";
import { createStreamingPatchDocument as document } from "../lib/streaming-patch-input";
import { StreamingPatchView } from "./streaming-patch-view";

vi.mock("../lib/clipboard", () => ({ writeClipboardText: vi.fn(async () => {}) }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("StreamingPatchView", () => {
  it("samples rendering but copies every received line, including text not yet displayed", async () => {
    vi.useFakeTimers();
    const first = "*** Begin Patch\n*** Add File: example.ts\n+first\n";
    const full = `${first}${Array.from({ length: 500 }, (_, index) => `+line ${index}\n`).join("")}+${"x".repeat(4000)}\n+last received`;
    const result = render(<StreamingPatchView document={document(first)} streaming />);
    result.rerender(<StreamingPatchView document={document(full)} streaming />);

    expect(screen.getByText("+1")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "复制完整补丁" })));
    expect(writeClipboardText).toHaveBeenCalledWith(full);
    expect(screen.getByRole("button", { name: "已复制完整补丁" })).toBeTruthy();

    act(() => vi.advanceTimersByTime(120));
    expect(screen.getByText("+503")).toBeTruthy();
    result.unmount();
  });

  it("flushes the last chunk immediately when argument streaming ends", () => {
    vi.useFakeTimers();
    const first = document("*** Begin Patch\n");
    const final = document("*** Begin Patch\n*** Add File: example.ts\n+last\n*** End Patch");
    const result = render(<StreamingPatchView document={first} streaming />);
    result.rerender(<StreamingPatchView document={final} streaming />);
    expect(screen.getByText("正在准备更改…")).toBeTruthy();

    result.rerender(<StreamingPatchView document={final} streaming={false} />);
    expect(screen.getByText("example.ts")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
  });

  it("keeps a live reader in the patch when completed review arrives", () => {
    const patch = document("*** Begin Patch\n*** Add File: example.ts\n+new\n*** End Patch");
    const result = render(<StreamingPatchView document={patch} streaming />);
    fireEvent.wheel(screen.getByRole("region", { name: "example.ts 的建议更改" }), {
      deltaY: -100,
    });
    expect(screen.getByRole("button", { name: "跟随更改" })).toBeTruthy();

    result.rerender(
      <StreamingPatchView document={patch} streaming={false} review={<div>Completed diff</div>} />,
    );
    expect(screen.getByRole("region", { name: "example.ts 的建议更改" })).toBeTruthy();
    expect(screen.queryByText("Completed diff")).toBeNull();
    expect(screen.getByRole("button", { name: "跟随更改" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "显示已应用的 diff" }));
    expect(screen.getByText("Completed diff")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "显示建议的更改" }));
    expect(screen.getByRole("region", { name: "example.ts 的建议更改" })).toBeTruthy();
  });

  it("opens historical patches on the completed diff with a structured deletion proposal available", () => {
    render(
      <StreamingPatchView
        document={document("*** Begin Patch\n*** Delete File: example.ts\n*** End Patch")}
        streaming={false}
        review={<div>Completed diff</div>}
      />,
    );
    expect(screen.getByText("Completed diff")).toBeTruthy();
    expect(screen.queryByText("文件已删除")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "显示建议的更改" }));
    expect(screen.getByText("example.ts")).toBeTruthy();
    expect(screen.getByText("文件已删除")).toBeTruthy();
  });

  it("gives each file its own section and independent follow state", () => {
    render(
      <StreamingPatchView
        document={document(
          [
            "*** Begin Patch",
            "*** Add File: alpha.ts",
            "+const value = 1;",
            "*** Add File: beta.py",
            "+value = 2",
            "*** End Patch",
          ].join("\n"),
        )}
        streaming
      />,
    );
    expect(screen.getByText("2 个文件")).toBeTruthy();
    expect(screen.getByText("alpha.ts")).toBeTruthy();
    expect(screen.getByText("beta.py")).toBeTruthy();
    const alpha = screen.getByRole("region", { name: "alpha.ts 的建议更改" });
    const beta = screen.getByRole("region", { name: "beta.py 的建议更改" });
    fireEvent.wheel(alpha, { deltaY: -100 });
    expect(
      within(alpha.parentElement!).getByRole("button", { name: "跟随更改" }),
    ).toBeTruthy();
    expect(
      within(beta.parentElement!).queryByRole("button", { name: "跟随更改" }),
    ).toBeNull();
  });
});
