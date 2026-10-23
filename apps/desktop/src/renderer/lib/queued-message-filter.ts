/**
 * 过滤掉仍在排队、尚未被消费的消息，避免它们同时出现在对话流和「排队中」清单里。
 *
 * 判据：delivery === "queue" 且既没有 runStartedAt（开始执行）也没有 promotedAt（从队列提升），
 * 说明消息还在排队等轮次。一旦轮到它（converge 回执/引导）就会带上这两个时间戳之一，
 * 届时正常显示在对话流中。
 */

import type { PalotMessage } from "../../shared";

/** 消息是否仍在排队（delivery 为 queue 且未被消费）。 */
export function isQueuedMessage(message: PalotMessage): boolean {
  return (
    message.delivery === "queue" &&
    message.runStartedAt === undefined &&
    message.promotedAt === undefined
  );
}

/**
 * 过滤掉仍在排队的消息，保留已引导/已消费/steer 类消息。
 * 返回新数组（有过滤时）或原数组引用（无过滤时），保持引用稳定性。
 */
export function filterQueuedMessages(messages: PalotMessage[]): PalotMessage[] {
  let hasQueued = false;
  for (const message of messages) {
    if (isQueuedMessage(message)) {
      hasQueued = true;
      break;
    }
  }
  if (!hasQueued) return messages;
  return messages.filter((message) => !isQueuedMessage(message));
}
