import type { PalotMessage } from "../../shared";

function messageTypeOrder(message: PalotMessage): number {
  if (message.type === "user") return 0;
  if (message.type === "assistant") return 1;
  return 2;
}

export function compareMessages(left: PalotMessage, right: PalotMessage): number {
  // Admission order is provisional. Once hydrated, OpenCode's message timestamp
  // reflects delivery order, which can place compaction ahead of pending steers.
  const leftTime = (left.optimistic === true ? left.timelineAt : undefined) ?? left.createdAt;
  const rightTime = (right.optimistic === true ? right.timelineAt : undefined) ?? right.createdAt;
  const chronological = leftTime - rightTime || messageTypeOrder(left) - messageTypeOrder(right);
  if (chronological !== 0) return chronological;
  return left.type === "user" && right.type === "user" ? left.id.localeCompare(right.id) : 0;
}

export function convergeMessageReceipt(
  messages: PalotMessage[],
  optimisticID: string,
  receiptID: string,
  receiptCreatedAt: number | null = null,
): PalotMessage[] {
  const optimistic = messages.find((message) => message.id === optimisticID);
  const receipt = messages.find((message) => message.id === receiptID);
  if (receipt) {
    const reconciled = reconcileMessage(receipt, optimistic, false) ?? receipt;
    const converged =
      receiptCreatedAt === null
        ? reconciled
        : { ...reconciled, createdAt: receiptCreatedAt, timelineAt: receiptCreatedAt };
    return messages.flatMap((message) => {
      if (message.id === optimisticID) return [converged];
      return message.id === receiptID ? [] : [message];
    });
  }
  return messages.map((message) =>
    message.id === optimisticID
      ? {
          ...message,
          id: receiptID,
          ...(receiptCreatedAt === null
            ? {}
            : { createdAt: receiptCreatedAt, timelineAt: receiptCreatedAt }),
        }
      : message,
  );
}

export function reconcileMessage(
  server: PalotMessage | undefined,
  current: PalotMessage | undefined,
  preferCurrent: boolean,
): PalotMessage | undefined {
  const preferred = preferCurrent ? (current ?? server) : (server ?? current);
  if (!preferred || !current) return preferred;
  const delivery = preferred.delivery ?? current.delivery;
  const timelineAt = current.timelineAt ?? preferred.timelineAt;
  const promotedAt = preferred.promotedAt ?? current.promotedAt;
  const runStartedAt = preferred.runStartedAt ?? current.runStartedAt;
  const runCompletedAt = preferred.runCompletedAt ?? current.runCompletedAt;
  const firstTokenAt = preferred.firstTokenAt ?? current.firstTokenAt;
  // 压缩消息的完成时刻只存在于事件流（session.compaction.ended 的 createdAt），
  // 服务器快照里没有 —— mapMessage 只能把 completedAt 填回 created（退化值）。
  // 回填快照时若把 live 侧观测到的真实完成时刻丢掉，分隔条上的「耗时 X」就没了。
  let compactionCompletedAt: number | null | undefined;
  if (
    preferred.type === "compaction" &&
    current.type === "compaction" &&
    current.completedAt !== null &&
    current.completedAt > current.createdAt &&
    (preferred.completedAt === null || preferred.completedAt <= preferred.createdAt)
  ) {
    compactionCompletedAt = current.completedAt;
  }
  if (
    delivery === preferred.delivery &&
    timelineAt === preferred.timelineAt &&
    promotedAt === preferred.promotedAt &&
    runStartedAt === preferred.runStartedAt &&
    runCompletedAt === preferred.runCompletedAt &&
    firstTokenAt === preferred.firstTokenAt &&
    compactionCompletedAt === undefined
  ) {
    return preferred;
  }
  return {
    ...preferred,
    ...(delivery === undefined ? {} : { delivery }),
    ...(timelineAt === undefined ? {} : { timelineAt }),
    ...(promotedAt === undefined ? {} : { promotedAt }),
    ...(runStartedAt === undefined ? {} : { runStartedAt }),
    ...(runCompletedAt === undefined ? {} : { runCompletedAt }),
    ...(firstTokenAt === undefined ? {} : { firstTokenAt }),
    ...(compactionCompletedAt === undefined ? {} : { completedAt: compactionCompletedAt }),
  };
}

export function mergeMessages(
  server: PalotMessage[],
  current: PalotMessage[],
  preferCurrent: boolean,
): PalotMessage[] {
  const serverByID = new Map(server.map((message) => [message.id, message]));
  const currentByID = new Map(current.map((message) => [message.id, message]));
  const ids = new Set([...currentByID.keys(), ...serverByID.keys()]);
  return [...ids]
    .map((id) => reconcileMessage(serverByID.get(id), currentByID.get(id), preferCurrent))
    .filter((message): message is PalotMessage => Boolean(message))
    .toSorted(compareMessages);
}

export function mergeOptimisticMessages(
  authoritative: PalotMessage[],
  current: PalotMessage[],
): PalotMessage[] {
  const optimistic = current.filter((message) => message.optimistic === true);
  return optimistic.length > 0 ? mergeMessages(authoritative, optimistic, false) : authoritative;
}
