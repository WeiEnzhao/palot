import { useEffect, useRef, useState } from "react";

interface TranscriptInfiniteScrollInput {
  scopeID: string;
  resetKey: number;
  firstVisibleIndex: number | null;
  ready: boolean;
  blocked: boolean;
  hasMore: boolean;
  failed: boolean;
  canLoad(): boolean;
  loadOlder(): Promise<boolean>;
}

// 「快到头」的判据。以前是 1（几乎贴顶才发请求）：数据到达时人已经停在顶上，
// 用户看到的就是「滑到顶 → 停一下 → 内容才出来」。放宽到 4 行 = 还有一两屏时数据
// 就在路上，滑到顶时基本已经就位（插入带来的高度变化由翻页锚点负责校正）。
const NEAR_TOP_TURN_INDEX = 4;

/** Range-driven pagination with one page per explicit upward reading intent. */
export function useTranscriptInfiniteScroll(input: TranscriptInfiniteScrollInput) {
  const intent = useRef({ scopeID: input.scopeID, resetKey: input.resetKey, upward: false });
  const [wake, setWake] = useState(0);

  function onUpwardIntent() {
    if (!input.ready || input.blocked || !input.hasMore || input.failed || !input.canLoad()) return;
    if (intent.current.scopeID !== input.scopeID || intent.current.resetKey !== input.resetKey) {
      intent.current = { scopeID: input.scopeID, resetKey: input.resetKey, upward: false };
    }
    intent.current.upward = true;
    // Usually the existing virtual-range update wakes the effect. At the very top
    // (or with short content), a gesture may not move the viewport at all. Wake
    // even for pending intent: a synchronous load guard may have deferred it.
    if (input.firstVisibleIndex !== null && input.firstVisibleIndex <= NEAR_TOP_TURN_INDEX) {
      setWake((current) => current + 1);
    }
  }

  useEffect(() => {
    if (
      intent.current.scopeID !== input.scopeID ||
      intent.current.resetKey !== input.resetKey ||
      input.blocked ||
      !input.ready
    ) {
      intent.current = { scopeID: input.scopeID, resetKey: input.resetKey, upward: false };
      return;
    }
    if (
      !intent.current.upward ||
      input.firstVisibleIndex === null ||
      input.firstVisibleIndex > NEAR_TOP_TURN_INDEX ||
      !input.hasMore ||
      input.failed ||
      !input.canLoad()
    )
      return;

    // Consume before fetching, not after the query's later loading-state commit.
    // Prepend/layout/programmatic scrolls cannot manufacture another user intent.
    intent.current.upward = false;
    void input.loadOlder(); // The transcript owns errors, retry UI, and anchor restoration.
  }, [
    input.scopeID,
    input.resetKey,
    input.firstVisibleIndex,
    input.ready,
    input.blocked,
    input.hasMore,
    input.failed,
    input.canLoad,
    input.loadOlder,
    wake,
  ]);

  return {
    onUpwardIntent,
    clearIntent: () => {
      intent.current.upward = false;
    },
  };
}
