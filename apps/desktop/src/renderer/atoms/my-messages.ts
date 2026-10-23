/** 「我的消息」面板状态管理。 */

import { atom } from "jotai";

/** 右侧「我的消息」面板是否打开。 */
export const myMessagesPanelOpenAtom = atom(false);

/** 当前高亮的消息 ID（用于短暂高亮效果）。 */
export const highlightedMessageIDAtom = atom<string | null>(null);
