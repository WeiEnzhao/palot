import { Map as MapIcon, Sparkles } from "lucide-react";
import { useMemo } from "react";
import type { PullRequestDetail, PullRequestRef } from "../../../../shared/source-control-contract";
import { usePullRequestFiles } from "../../../hooks/use-source-control";
import type { ReviewGuideStop } from "../../../lib/review-guide";
import { Banner } from "../../ui/banner";
import { Button } from "../../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../../ui/empty";
import { Spinner } from "../../ui/spinner";
import { useStartPullRequestTask } from "../pull-request-actions";
import { askAboutStopPrompt } from "./guide-model";
import { GuideTour } from "./guide-tour";
import type { ReviewGuideController } from "./use-review-guide";

const WRITING = "正在编写指南……这可能需要一分钟。";

/**
 * The Guide tab: a maintainer's tour of the pull request, written on request and kept on this
 * device. Opening the tab never runs a model; Write guide does.
 */
export function PullRequestGuideTab({
  pullRequest,
  controller,
}: {
  pullRequest: PullRequestDetail;
  controller: ReviewGuideController;
}) {
  const { host, repository, number } = pullRequest;
  const ref = useMemo<PullRequestRef>(
    () => ({ host, repository, number }),
    [host, repository, number],
  );
  const files = usePullRequestFiles(ref);
  const startTask = useStartPullRequestTask();
  const { guide, running, failure, stale, write, cancel, dismissFailure, disabledReason } =
    controller;

  const failureBanner = (
    <Banner
      open={failure !== null}
      status="error"
      title="无法编写导览"
      dismissible
      onDismiss={dismissFailure}
    >
      {failure}
    </Banner>
  );

  if (!guide) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col gap-3 p-4">
        {failureBanner}
        <Empty className="min-h-0 flex-1 rounded-none p-5">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {running ? <Spinner /> : <MapIcon aria-hidden="true" />}
            </EmptyMedia>
            <EmptyTitle>{running ? "正在编写评审指南" : "暂无评审指南"}</EmptyTitle>
            <EmptyDescription>
              {running
                ? WRITING
                : "指南是对变更的简短导览，帮助你判断是否应该合入：按阅读顺序排列的站点、承载每个想法的代码，以及只有你能做出的少数判断。机械性的更改会归到末尾。"}
            </EmptyDescription>
          </EmptyHeader>
          {running ? (
            <Button type="button" variant="outline" size="sm" onClick={cancel}>
              取消
            </Button>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <Button type="button" size="sm" disabled={disabledReason !== null} onClick={write}>
                <Sparkles data-icon="inline-start" aria-hidden="true" />
                {failure ? "重试" : "编写指南"}
              </Button>
              {disabledReason ? (
                <p className="text-meta text-muted-foreground">{disabledReason}</p>
              ) : null}
            </div>
          )}
        </Empty>
      </div>
    );
  }

  const banner = running ? (
    <Banner
      status="info"
      icon={Spinner}
      title={WRITING}
      actions={
        <Button type="button" variant="outline" size="sm" onClick={cancel}>
          Cancel
        </Button>
      }
    />
  ) : failure ? (
    failureBanner
  ) : stale ? (
    <Banner
      status="warning"
      title="写于最近一次推送之前"
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabledReason !== null}
          onClick={write}
        >
          Rewrite
        </Button>
      }
    >
      Excerpts may point at lines that have since moved.
    </Banner>
  ) : null;

  const ask = (stop: ReviewGuideStop, index: number, question?: string) =>
    void startTask(
      "detail",
      pullRequest,
      askAboutStopPrompt({
        url: pullRequest.url,
        stop,
        index,
        stopCount: guide.stops.length,
        ...(question ? { question } : {}),
      }),
    );

  return (
    <GuideTour
      pullRequest={pullRequest}
      guide={guide}
      files={files.data}
      banner={banner}
      onAsk={ask}
    />
  );
}
