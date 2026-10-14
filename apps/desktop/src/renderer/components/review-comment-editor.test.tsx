import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ReviewCommentEditor } from "./review-comment-editor";

it("requires a nonempty line comment and saves the selected range", () => {
  const save = vi.fn();
  render(
    <ReviewCommentEditor
      path="src/a.ts"
      range={{ start: 4, end: 2, side: "additions" }}
      onSave={save}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText("src/a.ts · 第 2–4 行")).toBeTruthy();
  const submit = screen.getByRole<HTMLButtonElement>("button", { name: "添加评论" });
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "行评论" }), {
    target: { value: "Handle null" },
  });
  fireEvent.click(submit);
  expect(save).toHaveBeenCalledWith("Handle null");
});
