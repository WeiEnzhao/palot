export function SessionRoutePending() {
  return (
    <main
      className="palot-main-surface relative flex h-full min-h-0 flex-col bg-background"
      aria-label="加载任务对话记录"
      aria-busy="true"
    >
      <div className="window-drag h-(--shell-header-height) min-h-(--shell-header-height) border-b bg-background/90" />
      <div className="min-h-0 flex-1" />
    </main>
  );
}
