import { useId, useState } from "react";
import {
  useSessionLocationMissing,
  type SessionLocationMissingOptions,
} from "../hooks/use-session-location-missing";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/** Mount beside the composer; all recovery operations stay on the supplied owner. */
export function SessionLocationMissing(options: SessionLocationMissingOptions) {
  const recovery = useSessionLocationMissing(options);
  return <SessionLocationMissingView options={options} recovery={recovery} />;
}

export function SessionLocationMissingView({
  options,
  recovery,
}: {
  options: SessionLocationMissingOptions;
  recovery: ReturnType<typeof useSessionLocationMissing>;
}) {
  const identity = JSON.stringify([
    options.owner?.connectionID,
    options.session.id,
    options.session.location.directory,
  ]);
  const [directoryState, setDirectory] = useState<{ identity: string; value: string } | null>(null);
  const directory = directoryState?.identity === identity ? directoryState.value : "";
  const listID = useId();
  if (!recovery.missing) return null;
  return (
    <section
      aria-label="丢失的工作区"
      className="space-y-3 rounded-lg border bg-card p-3 text-sm"
    >
      <div>
        <h2 className="font-medium">此工作区丢失</h2>
        <p className="break-all text-meta text-muted-foreground">
          {options.session.location.directory}
        </p>
        <p className="text-meta text-muted-foreground">
          选择此服务器上的另一个现有目录，或从项目的已保存检出创建新工作树。
        </p>
      </div>
      <form
        className="flex min-w-0 flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void recovery.recover({ type: "existing", directory });
        }}
      >
        <Input
          className="min-w-0 flex-1"
          aria-label="现有目录"
          placeholder="现有检出或目录"
          list={listID}
          value={directory}
          disabled={recovery.pending}
          onChange={(event) => setDirectory({ identity, value: event.target.value })}
        />
        <datalist id={listID}>
          {recovery.directories.map((entry) => (
            <option key={entry.directory} value={entry.directory} />
          ))}
        </datalist>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={recovery.pending || !directory.trim()}
        >
          使用目录
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={recovery.pending || !recovery.canCreate}
          onClick={() => void recovery.recover({ type: "create" })}
        >
          创建新工作树
        </Button>
        {recovery.pending ? (
          <Button type="button" variant="ghost" size="sm" onClick={recovery.cancel}>
            取消
          </Button>
        ) : null}
      </form>
      {recovery.pending ? (
        <p role="status" className="text-meta text-muted-foreground">
          正在恢复工作区… 取消将停止等待；服务器上已开始的工作可能会完成。
        </p>
      ) : null}
      {recovery.loadingDirectories ? (
        <p role="status" className="text-meta text-muted-foreground">
          正在加载现有检出…
        </p>
      ) : null}
      {recovery.directoriesError ? (
        <p className="text-meta text-muted-foreground">
          无法列出检出。你仍可输入现有目录。
        </p>
      ) : null}
      {recovery.error ? (
        <p role="alert" className="text-meta text-destructive">
          {recovery.error}
        </p>
      ) : null}
    </section>
  );
}
