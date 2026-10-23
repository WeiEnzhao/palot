/** Composer model, reasoning, and agent pickers on the shared ComposerPicker. */

import type { ModelRef } from "@opencode/client";
import { useAtom } from "jotai";
import { Bot, Brain, Settings2, Star } from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import type { PalotAgent, PalotModel, PalotProvider, PalotSession } from "../../shared";
import {
  activeReasoningVariant,
  baseModelCost,
  formatModalities,
  formatModelPrice,
  formatTokenLimit,
  groupPickerModels,
  newModelKeys,
  modelSearchValues,
  sentenceCase,
} from "../lib/model-picker";
import {
  modelPickerUsage,
  modelPickerUsageAtom,
  modelPreferenceKey,
  rememberRecentModel,
  toggleFavoriteModel,
} from "../lib/model-preferences";
import { modelMatchesRef, resolveModelSelection } from "../lib/model-selection";
import { primaryAgents } from "../lib/selection-memory";
import { Button } from "./ui/button";
import {
  ComposerPicker,
  type ComposerPickerBadge,
  type ComposerPickerOption,
  type ComposerPickerSection,
} from "./ui/composer-picker";

const STATUS_BADGES: Partial<Record<PalotModel["status"], ComposerPickerBadge>> = {
  alpha: { label: "Alpha", tone: "warning" },
  beta: { label: "Beta", tone: "neutral" },
  deprecated: { label: "已弃用", tone: "danger" },
};

interface PickerMenuProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelectionComplete(): void;
  disabled: boolean;
}

export const ModelPicker = memo(function ModelPicker({
  session,
  models,
  catalogModels,
  defaultModel,
  providers,
  preferenceScope,
  open,
  onOpenChange,
  onSelectionComplete,
  onSelectModel,
  onManageModels,
  disabled,
  draft = false,
}: PickerMenuProps & {
  session: PalotSession;
  /** A new task shows its remembered model; an existing task shows its own. */
  draft?: boolean;
  /** Visible models in the person's order. */
  models: PalotModel[];
  catalogModels: PalotModel[];
  defaultModel: PalotModel | null;
  providers: PalotProvider[];
  preferenceScope: string;
  onSelectModel(model: ModelRef): Promise<void>;
  onManageModels(): void;
}) {
  const [usages, setUsages] = useAtom(modelPickerUsageAtom);
  const usage = modelPickerUsage(usages, preferenceScope);
  const selection = resolveModelSelection(catalogModels, session.model, defaultModel);
  const selectedRef = selection.ref;
  const selected = selection.model;
  const unavailable = session.model !== null && selected === null;
  const label = selected?.name ?? selectedRef?.id ?? "选择模型";
  const providerNames = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.name])),
    [providers],
  );

  const sections = useMemo(() => {
    const groups = groupPickerModels(models, usage, providers);
    const favorites = new Set(usage.favorites);
    const fresh = newModelKeys(models);
    const option = (model: PalotModel, showProvider: boolean) => {
      const key = modelPreferenceKey(model);
      const providerName = providerNames.get(model.providerID) ?? model.providerID;
      const badges: ComposerPickerBadge[] = [];
      const status = STATUS_BADGES[model.status];
      if (status) badges.push(status);
      if (fresh.has(key)) badges.push({ label: "新", tone: "new" });
      if (modelMatchesRef(model, defaultModel)) badges.push({ label: "默认" });
      return {
        key,
        value: model,
        label: model.name,
        description: showProvider ? providerName : undefined,
        keywords: modelSearchValues(model, providerName),
        badges,
        meta: formatTokenLimit(model.contextLimit),
        favorite: favorites.has(key),
        attributes: { "data-palot-model-option": true },
      } satisfies ComposerPickerOption<PalotModel | null>;
    };
    const result: ComposerPickerSection<PalotModel | null>[] = [];
    if (unavailable && selectedRef) {
      result.push({
        key: "current",
        heading: draft ? "最近使用" : "当前任务",
        options: [
          {
            key: `unavailable:${selectedRef.providerID}/${selectedRef.id}`,
            value: null,
            label: selectedRef.id,
            keywords: [selectedRef.providerID],
            disabled: true,
            disabledReason: "已不可用",
          },
        ],
      });
    }
    if (groups.favorites.length > 0) {
      result.push({
        key: "favorites",
        heading: "收藏",
        hideWhenSearching: true,
        options: groups.favorites.map((model) => option(model, true)),
      });
    }
    if (groups.recent.length > 0) {
      result.push({
        key: "recent",
        heading: "最近",
        hideWhenSearching: true,
        options: groups.recent.map((model) => option(model, true)),
      });
    }
    for (const provider of groups.providers) {
      result.push({
        key: `provider:${provider.id}`,
        heading: provider.name,
        collapsible: groups.providers.length > 1,
        options: provider.models.map((model) => option(model, false)),
      });
    }
    return result;
  }, [defaultModel, draft, models, providerNames, providers, selectedRef, unavailable, usage]);

  const toggleFavorite = useCallback(
    (option: ComposerPickerOption<PalotModel | null>) => {
      if (!option.value) return;
      setUsages((current) => toggleFavoriteModel(current, preferenceScope, option.key));
    },
    [preferenceScope, setUsages],
  );

  const renderDetail = useCallback(
    (option: ComposerPickerOption<PalotModel | null> | null) =>
      option?.value ? (
        <ModelDetails
          model={option.value}
          providerName={providerNames.get(option.value.providerID) ?? option.value.providerID}
          favorite={option.favorite === true}
          onToggleFavorite={() => toggleFavorite(option)}
        />
      ) : null,
    [providerNames, toggleFavorite],
  );

  const actions = useMemo(
    () => [
      {
        key: "manage",
        label: "管理模型",
        icon: <Settings2 aria-hidden="true" />,
        onSelect: onManageModels,
      },
    ],
    [onManageModels],
  );

  return (
    <ComposerPicker<PalotModel | null>
      label={label}
      ariaLabel={`模型：${label}${unavailable ? "，不可用" : ""}`}
      secondary={unavailable ? "已不可用" : selection.usesDefault ? "默认" : null}
      tone={unavailable ? "warning" : "default"}
      triggerClassName="palot-model-trigger max-w-64 shrink"
      labelAttributes={{ "data-palot-model-name": true }}
      secondaryAttributes={{ "data-palot-model-detail-label": true }}
      tooltip="选择模型"
      shortcuts={["composer.model"]}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      align="end"
      popupClassName="w-[min(36rem,calc(100vw-24px))]"
      title="模型"
      description={
        unavailable
          ? draft
            ? "你上次使用的模型当前不可用，请选择其他模型再发送。"
            : "此任务选择的模型已不可用。请选择其他模型以继续。"
          : undefined
      }
      actionsPlacement="header"
      listLabel="模型列表"
      search={{ label: "选择模型", placeholder: "搜索模型…" }}
      sections={sections}
      selectedKey={selected ? modelPreferenceKey(selected) : null}
      emptyLabel={models.length === 0 ? "暂无可用模型。" : "未找到匹配的模型。"}
      renderDetail={renderDetail}
      actions={actions}
      errorTitle="无法切换模型"
      onSelect={async (option) => {
        const model = option.value;
        if (!model) return;
        await onSelectModel({ id: model.id, providerID: model.providerID });
        setUsages((current) => rememberRecentModel(current, preferenceScope, option.key));
      }}
      onSelectionComplete={onSelectionComplete}
      onToggleFavorite={toggleFavorite}
    />
  );
});

function ModelDetails({
  model,
  providerName,
  favorite,
  onToggleFavorite,
}: {
  model: PalotModel;
  providerName: string;
  favorite: boolean;
  onToggleFavorite(): void;
}) {
  const cost = baseModelCost(model);
  const tiered = (model.cost?.length ?? 0) > 1;
  return (
    <div className="grid gap-3" data-palot-model-details>
      <div className="grid gap-0.5">
        <p className="text-compact font-medium break-words">{model.name}</p>
        <p className="text-meta text-muted-foreground">{providerName}</p>
        <p className="truncate font-mono text-micro text-muted-foreground" title={model.id}>
          {model.id}
        </p>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-meta">
        <dt className="text-muted-foreground">上下文</dt>
        <dd className="tabular-nums">{formatTokenLimit(model.contextLimit)} tokens</dd>
        <dt className="text-muted-foreground">最大输出</dt>
        <dd className="tabular-nums">{formatTokenLimit(model.outputLimit)} tokens</dd>
        <dt className="text-muted-foreground">输入</dt>
        <dd>{formatModalities(model.capabilities.input)}</dd>
        <dt className="text-muted-foreground">工具</dt>
        <dd>{model.capabilities.tools ? "支持" : "不支持"}</dd>
        {cost ? (
          <>
            <dt className="text-muted-foreground">费用</dt>
            <dd className="tabular-nums">
              输入 {formatModelPrice(cost.input)} · 输出 {formatModelPrice(cost.output)}
              <span className="block text-muted-foreground">
                每百万 token{tiered ? "，基础档" : ""}
              </span>
            </dd>
          </>
        ) : null}
        {model.variants.length > 0 ? (
          <>
            <dt className="text-muted-foreground">推理</dt>
            <dd>{model.variants.map(sentenceCase).join(", ")}</dd>
          </>
        ) : null}
      </dl>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        aria-pressed={favorite}
        onClick={onToggleFavorite}
      >
        <Star className={favorite ? "fill-current text-warning" : undefined} aria-hidden="true" />
        {favorite ? "取消收藏" : "加入收藏"}
      </Button>
    </div>
  );
}

/** 推理力度档位的中文标签；未知档位回退到 sentenceCase。 */
const EFFORT_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  max: "最大",
};

export const ReasoningPicker = memo(function ReasoningPicker({
  session,
  catalogModels,
  defaultModel,
  open,
  onOpenChange,
  onSelectionComplete,
  onSelectVariant,
  disabled,
}: PickerMenuProps & {
  session: PalotSession;
  catalogModels: PalotModel[];
  defaultModel: PalotModel | null;
  onSelectVariant(model: ModelRef): Promise<void>;
}) {
  const selected = resolveModelSelection(catalogModels, session.model, defaultModel).model;
  const variants = selected?.variants;
  const sections = useMemo<ComposerPickerSection<string | undefined>[]>(
    () => [
      {
        key: "effort",
        options: [
          {
            key: "default",
            value: undefined,
            label: "自动",
            description: "使用模型默认的推理力度",
          },
          ...(variants ?? []).map((variant) => ({
            key: variant,
            value: variant,
            label: EFFORT_LABELS[variant] ?? sentenceCase(variant),
            attributes: { "data-palot-model-variant": true },
          })),
        ],
      },
    ],
    [variants],
  );
  if (!selected || selected.variants.length === 0) return null;
  const active = activeReasoningVariant(selected.variants, session.model?.variant);
  const effort = active ? (EFFORT_LABELS[active] ?? sentenceCase(active)) : "自动";

  return (
    <ComposerPicker<string | undefined>
      label={effort}
      ariaLabel={`推理力度：${effort}`}
      icon={<Brain className="shrink-0" aria-hidden="true" />}
      triggerClassName="max-w-36 shrink-0"
      labelAttributes={{ "data-palot-model-effort": true }}
      tooltip="推理力度"
      shortcuts={["composer.reasoning.cycle"]}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      align="end"
      popupClassName="w-60"
      title="推理力度"
      description={selected.name}
      listLabel="推理力度"
      sections={sections}
      selectedKey={active ?? "default"}
      errorTitle="无法更改推理力度"
      onSelect={(option) =>
        onSelectVariant({
          id: selected.id,
          providerID: selected.providerID,
          ...(option.value ? { variant: option.value } : {}),
        })
      }
      onSelectionComplete={onSelectionComplete}
    />
  );
});

export const AgentPicker = memo(function AgentPicker({
  session,
  agents,
  defaultAgent,
  loading,
  open,
  onOpenChange,
  onSelectionComplete,
  onSelectAgent,
  disabled,
}: PickerMenuProps & {
  session: PalotSession;
  agents: PalotAgent[];
  defaultAgent: PalotAgent | null;
  loading: boolean;
  onSelectAgent(agent: PalotAgent): Promise<void>;
}) {
  const available = useMemo(() => primaryAgents(agents), [agents]);
  const selected = available.find((agent) => agent.id === session.agent) ?? null;
  // Without an explicit agent, OpenCode runs its default agent; show that agent by name.
  const label = selected?.name ?? session.agent ?? defaultAgent?.name ?? "默认";
  const implicitDefault = !session.agent && defaultAgent !== null;
  const sections = useMemo<ComposerPickerSection<PalotAgent>[]>(
    () => [
      {
        key: "agents",
        options: available.map((agent) => ({
          key: agent.id,
          value: agent,
          label: agent.name,
          description: agent.description ?? undefined,
          keywords: [agent.id],
        })),
      },
    ],
    [available],
  );

  return (
    <ComposerPicker<PalotAgent>
      label={label}
      ariaLabel={`智能体：${label}${implicitDefault ? "（默认）" : ""}`}
      icon={<Bot className="shrink-0" aria-hidden="true" />}
      triggerClassName="max-w-40 gap-1"
      tooltip="切换智能体"
      shortcuts={["composer.agent.next", "composer.agent.previous"]}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
      popupClassName="w-[min(360px,calc(100vw-24px))]"
      title="智能体"
      description="选择此任务使用的主智能体。"
      listLabel="智能体"
      search={{ label: "选择智能体", placeholder: "搜索智能体…" }}
      sections={sections}
      selectedKey={session.agent}
      loading={loading}
      loadingLabel="正在加载智能体…"
      emptyLabel="未找到主智能体。"
      errorTitle="无法切换智能体"
      onSelect={(option) => onSelectAgent(option.value)}
      onSelectionComplete={onSelectionComplete}
    />
  );
});
