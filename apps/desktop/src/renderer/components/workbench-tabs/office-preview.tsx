import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { loadOfficePreview } from "./office-preview-loader";
import {
  type OfficeBlock,
  type OfficeDocument,
  type OfficeFormat,
  type OfficeSheet,
} from "./office-preview-model";

type LoadState =
  | { data: Uint8Array; document: OfficeDocument }
  | { data: Uint8Array; error: string };

export default function OfficePreview({
  data,
  path,
  format,
}: {
  data: Uint8Array;
  path: string;
  format: OfficeFormat;
}) {
  const [loaded, setLoaded] = useState<LoadState | null>(null);
  const [index, setIndex] = useState(0);
  const current = loaded?.data === data ? loaded : null;

  useEffect(() => {
    const controller = new AbortController();
    void loadOfficePreview(data, format, controller.signal).then(
      (document) => {
        if (!controller.signal.aborted) {
          setIndex(0);
          setLoaded({ data, document });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({
            data,
            error: error instanceof Error ? error.message : "无法读取此 Office 文件。",
          });
      },
    );
    return () => controller.abort();
  }, [data, format]);

  if (current && "error" in current) {
    return (
      <Empty className="rounded-none p-5">
        <EmptyHeader>
          <EmptyTitle>预览不可用</EmptyTitle>
          <EmptyDescription>{current.error}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (!current || !("document" in current)) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-meta text-muted-foreground">
        <Spinner /> 正在加载 Office 预览
      </div>
    );
  }
  const doc = current.document;
  const count = format === "xlsx" ? doc.sheets.length : doc.sections.length;
  const selected = Math.min(index, Math.max(0, count - 1));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1 text-meta">
        <span className="min-w-0 flex-1 text-muted-foreground">
          {format === "xlsx"
            ? "已保存的单元格值"
            : format === "pptx"
              ? "幻灯片内容"
              : "文档内容"}{" "}
          · 只读
        </span>
        {format === "xlsx" && count ? (
          <label className="flex min-w-0 items-center gap-2">
            工作表
            <select
              aria-label="工作表"
              value={selected}
              onChange={(event) => setIndex(Number(event.target.value))}
              className="max-w-48 rounded-md border border-input bg-background px-2 py-1 text-meta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {doc.sheets.map((sheet, i) => (
                <option key={i} value={i}>
                  {sheet.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {format === "pptx" && count ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="上一张幻灯片"
              disabled={selected === 0}
              onClick={() => setIndex(selected - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span>
              第 {selected + 1} 张，共 {count} 张
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="下一张幻灯片"
              disabled={selected + 1 >= count}
              onClick={() => setIndex(selected + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>
      <div className="shrink-0 border-b border-border px-3 py-2 text-meta text-muted-foreground">
        {format === "xlsx"
          ? "仅包含值，不重新计算。日期和数字格式可能显示为存储的数值。不包含图像、图表和布局。"
          : "仅包含文本、基本强调和表格。不包含图像、图表、页面布局和动画。链接不可用。"}
        {doc.truncated ? (
          <p role="status" className="mt-1 text-foreground">
            预览已截断：最多 30 个工作表、100 张幻灯片、200 行 × 50 列、10,000 个内容项和 500,000 个字符。
          </p>
        ) : null}
      </div>
      <div className="palot-native-scrollbar min-h-0 flex-1 overflow-auto p-5">
        {format === "xlsx" && doc.sheets[selected] ? (
          <SheetContent sheet={doc.sheets[selected]} />
        ) : (
          <article
            aria-label={`Office 预览：${path}`}
            className="mx-auto max-w-4xl space-y-3 text-sm"
          >
            {doc.sections[selected]?.blocks.map((block, i) => (
              <ContentBlock key={i} block={block} />
            ))}
          </article>
        )}
        {!count ||
        (format !== "xlsx" && !doc.sections[selected]?.blocks.length) ||
        (format === "xlsx" && !doc.sheets[selected]?.rows.length) ? (
          <p className="text-sm text-muted-foreground">
            此{format === "xlsx" ? "工作表" : format === "pptx" ? "幻灯片" : "文档"}中没有可读内容。
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ContentBlock({ block }: { block: OfficeBlock }) {
  if (block.kind === "table")
    return (
      <div className="overflow-auto">
        <table aria-label="文档表格" className="w-full border-collapse text-sm">
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) =>
                  cell === null ? null : (
                    <td
                      key={c}
                      rowSpan={cell.rowSpan}
                      colSpan={cell.colSpan}
                      className="border border-border px-3 py-2 align-top whitespace-pre-wrap"
                    >
                      {cell.text}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  const content = block.runs.map((run, i) => (
    <span key={i}>
      {run.bold ? (
        <strong>{run.italic ? <em>{run.text}</em> : run.text}</strong>
      ) : run.italic ? (
        <em>{run.text}</em>
      ) : (
        run.text
      )}
    </span>
  ));
  if (block.kind === "heading")
    return (
      <div
        role="heading"
        aria-level={block.level}
        className="pt-2 text-sm font-semibold whitespace-pre-wrap"
      >
        {content}
      </div>
    );
  if (block.kind === "list")
    return (
      <ul className="list-disc pl-5">
        <li className="whitespace-pre-wrap">{content}</li>
      </ul>
    );
  return <p className="break-words whitespace-pre-wrap">{content}</p>;
}

function SheetContent({ sheet }: { sheet: OfficeSheet }) {
  return (
    <table
      aria-label={`工作表：${sheet.name}`}
      className="w-full border-collapse font-mono text-code-compact"
    >
      <thead>
        <tr>
          <th scope="col" className="border border-border bg-muted px-2 py-1">
            Row
          </th>
          {Array.from({ length: sheet.columns }, (_, i) => (
            <th key={i} scope="col" className="border border-border bg-muted px-3 py-1">
              {columnName(i + 1)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sheet.rows.map((row, i) => (
          <tr key={i}>
            <th scope="row" className="border border-border bg-muted px-2 py-1 font-normal">
              {row.number}
            </th>
            {Array.from({ length: sheet.columns }, (_, c) => (
              <td
                key={c}
                className="max-w-64 border border-border px-3 py-1 align-top break-words whitespace-pre-wrap"
              >
                {row.cells[c] ?? ""}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function columnName(number: number): string {
  let label = "";
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26))
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  return label;
}
