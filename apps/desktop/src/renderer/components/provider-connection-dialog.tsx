import type { FormValue, LocationRef } from "@opencode/client";
import {
  CircleAlert,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LogIn,
  Terminal,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ComponentType } from "react";
import type {
  OpenCodeRuntimeStatus,
  PalotFormField,
  PalotIntegration,
  PalotIntegrationMethod,
} from "../../shared";
import { useSettingsOwner } from "../hooks/use-settings-owner";
import {
  defaultFormAnswers,
  formFieldVisible,
  integrationFormValid,
  visibleAnswers,
} from "../lib/integration-form";
import {
  IntegrationConnectionWorkflow,
  type IntegrationConnectionAttempt,
} from "../lib/integration-connection-workflow";
import { cn } from "../lib/cn";
import { showErrorToast } from "../lib/toast-error";
import { palot } from "../services/palot";
import { Banner } from "./ui/banner";
import { Button } from "./ui/button";
import { CheckList } from "./ui/check-list";
import { Checkbox } from "./ui/checkbox";
import { ChoiceGroup } from "./ui/choice-group";
import { CopyField } from "./ui/copy-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { ProviderIcon } from "./ui/provider-icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { toast } from "./ui/toast";

export function ProviderConnectionDialog({
  integration,
  projectID,
  location,
  onOpenChange,
  onComplete,
  owner,
}: {
  integration: PalotIntegration | null;
  projectID: string;
  location: LocationRef;
  onOpenChange(open: boolean): void;
  onComplete(): Promise<void>;
  owner?: OpenCodeRuntimeStatus | null;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [methodID, setMethodID] = useState<string>(() => {
    const method = integration?.methods.find((item) => item.type !== "env");
    return method ? methodKey(method) : "";
  });
  const [attempt, setAttempt] = useState<IntegrationConnectionAttempt | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const methodLabelID = useId();
  const workflow = useMemo(() => new IntegrationConnectionWorkflow(palot), []);
  const selectedRuntime = useSettingsOwner();
  const runtime = owner === undefined ? selectedRuntime : owner;
  const runtimeConnectionID = runtime?.connectionID ?? null;
  const previousConnectionID = useRef(runtimeConnectionID);
  const availableMethods = integration?.methods.filter((item) => item.type !== "env") ?? [];
  const method =
    availableMethods.find((item) => methodKey(item) === methodID) ??
    availableMethods.find((item) => item.type !== "unsupported") ??
    availableMethods[0];

  useEffect(() => () => workflow.dispose(), [workflow]);
  useEffect(() => {
    workflow.dispose();
    setAttempt(null);
    setBusy(false);
    setCode("");
    setMethodID("");
  }, [integration?.id, workflow]);
  useEffect(() => {
    if (integration && document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement;
    }
  }, [integration]);
  useEffect(() => {
    const connectionChanged = previousConnectionID.current !== runtimeConnectionID;
    previousConnectionID.current = runtimeConnectionID;
    if (runtime?.connected && !connectionChanged) return;
    workflow.dispose();
    setAttempt(null);
    setBusy(false);
  }, [runtime?.connected, runtimeConnectionID, workflow]);

  const callbacks = {
    setAttempt,
    setBusy,
    showError: showErrorToast,
    showSuccess(title: string) {
      toast.add({ type: "success", title });
    },
    close() {
      onOpenChange(false);
    },
    invalidate: onComplete,
  };

  async function submit(input: { key: string; label: string; answer: Record<string, FormValue> }) {
    if (!integration || !method || !runtime?.connected) return;
    await workflow.start(
      {
        integration,
        method,
        ...input,
        connectionID: runtime.connectionID,
        projectID,
        directory: location.directory,
        ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
      },
      callbacks,
    );
  }

  async function completeOAuth() {
    if (!integration || !attempt || attempt.type !== "oauth") return;
    await workflow.completeOAuth(code, callbacks);
  }

  async function close() {
    await workflow.close(callbacks);
  }

  return (
    <Dialog open={Boolean(integration)} onOpenChange={(open) => !open && void close()}>
      <DialogContent
        className="sm:max-w-md"
        finalFocus={() => (returnFocusRef.current?.isConnected ? returnFocusRef.current : false)}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {integration ? <ProviderIcon id={integration.id} className="size-5" /> : null}
            添加 {integration?.name} 凭据
          </DialogTitle>
          <DialogDescription>
            OpenCode 为此服务存储此凭据。添加它会使其在所有已连接的项目中生效。
          </DialogDescription>
        </DialogHeader>
        {integration && availableMethods.length > 1 && !attempt ? (
          <div className="grid gap-2">
            <p id={methodLabelID} className="text-xs font-medium">
              选择连接方式
            </p>
            <ChoiceGroup
              aria-labelledby={methodLabelID}
              variant="card"
              disabled={busy}
              value={method ? methodKey(method) : null}
              onValueChange={setMethodID}
              options={availableMethods.map((item) => ({
                value: methodKey(item),
                label: item.label,
                description: connectionMethodDescription(item),
                icon: connectionMethodIcon(item),
              }))}
            />
          </div>
        ) : null}
        {!attempt ? (
          method ? (
            <ConnectionMethodForm
              key={`${runtimeConnectionID}:${integration?.id}:${methodKey(method)}`}
              method={method}
              busy={busy || !runtime?.connected}
              onCancel={() => void close()}
              onSubmit={submit}
            />
          ) : (
            <div className="grid gap-3">
              <Banner status="neutral">
                此处没有可用的连接方式。请在 OpenCode 中配置此集成。
              </Banner>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => void close()}>
                  取消
                </Button>
              </DialogFooter>
            </div>
          )
        ) : (
          <div className="grid gap-3">
            <Banner
              status={
                attempt.status === "pending"
                  ? "info"
                  : attempt.status === "complete"
                    ? "success"
                    : "error"
              }
              icon={attempt.status === "pending" ? PendingIcon : undefined}
              title={
                attempt.status === "pending"
                  ? "等待授权"
                  : attempt.status === "complete"
                    ? "已授权"
                    : attempt.status === "expired"
                      ? "授权已过期"
                      : "授权失败"
              }
              aria-busy={attempt.status === "pending"}
            >
              {attempt.instructions || attempt.message ? (
                <>
                  {attempt.instructions ? (
                    <p className="whitespace-pre-wrap">{attempt.instructions}</p>
                  ) : null}
                  {attempt.message ? <p>{attempt.message}</p> : null}
                </>
              ) : undefined}
            </Banner>
            {attempt.url && validHttpUrl(attempt.url) ? (
              <a
                href={attempt.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-4 text-xs font-medium hover:bg-accent"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                打开授权页面
              </a>
            ) : null}
            {attempt.url ? (
              <CopyField label="授权 URL" value={attempt.url} monospace />
            ) : null}
            {attempt.status === "pending" && deviceCode(attempt) ? (
              <CopyField label="设备码" value={deviceCode(attempt)!} />
            ) : null}
            {attempt.type === "oauth" && attempt.mode === "code" ? (
              <label className="grid gap-1.5 text-xs font-medium">
                授权码
                <Input value={code} onChange={(event) => setCode(event.target.value)} />
              </label>
            ) : null}
          </div>
        )}
        {attempt ? (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void close()}>
              取消
            </Button>
            {attempt.type === "oauth" && attempt.mode === "code" ? (
              <Button
                type="button"
                disabled={busy || !code.trim()}
                onClick={() => void completeOAuth()}
              >
                {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
                完成
              </Button>
            ) : null}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ConnectionMethodForm({
  method,
  busy,
  onCancel,
  onSubmit,
}: {
  method: Exclude<PalotIntegrationMethod, { type: "env" }>;
  busy: boolean;
  onCancel(): void;
  onSubmit(input: { key: string; label: string; answer: Record<string, FormValue> }): Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [answers, setAnswers] = useState<Record<string, FormValue>>(() =>
    defaultFormAnswers(method.form),
  );

  if (method.type === "unsupported") {
    return (
      <>
        <Banner status="neutral">
          Palot 不支持 {method.label} 连接方式 ({method.methodType})。请改为在 OpenCode 中连接它。
        </Banner>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <div className="grid gap-3">
        {method.form.map((field) => (
          <IntegrationFormField
            key={field.key}
            field={field}
            answers={answers}
            onChange={(value) =>
              setAnswers((current) => {
                const next = { ...current };
                if (value === undefined) delete next[field.key];
                else next[field.key] = value;
                return next;
              })
            }
          />
        ))}
        {method.type === "key" ? (
          <label className="grid gap-1.5 text-xs font-medium">
            API 密钥
            <Input
              type="password"
              value={key}
              autoComplete="off"
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
        ) : null}
        <label className="grid gap-1.5 text-xs font-medium">
          凭据标签 <span className="font-normal text-muted-foreground">可选</span>
          <Input
            value={label}
            placeholder="工作或私人"
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        {method.type === "command" ? (
          <CopyField label="OpenCode 运行的命令" value={method.command.join(" ")} />
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button
          type="button"
          disabled={
            busy ||
            (method.type === "key" && !key.trim()) ||
            !integrationFormValid(method.form, answers)
          }
          onClick={() =>
            void onSubmit({ key, label, answer: visibleAnswers(method.form, answers) })
          }
        >
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
          添加并使用
        </Button>
      </DialogFooter>
    </>
  );
}

function IntegrationFormField({
  field,
  answers,
  onChange,
}: {
  field: PalotFormField;
  answers: Record<string, FormValue>;
  onChange(value: FormValue | undefined): void;
}) {
  const [customValue, setCustomValue] = useState("");
  const labelID = useId();
  if (!formFieldVisible(field, answers)) return null;
  if (field.type === "external") {
    return (
      <div className="grid gap-2">
        {validHttpUrl(field.url) ? (
          <a
            href={field.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs hover:bg-muted/30"
          >
            <ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              <span className="block font-medium">{field.title ?? "打开说明"}</span>
              {field.description ? (
                <span className="mt-0.5 block text-muted-foreground">{field.description}</span>
              ) : null}
            </span>
          </a>
        ) : (
          <div className="rounded-lg border px-3 py-2 text-xs">
            <span className="block font-medium">{field.title ?? "外部步骤"}</span>
            {field.description ? (
              <span className="mt-0.5 block text-muted-foreground">{field.description}</span>
            ) : null}
            <code className="mt-1 block break-all text-micro text-muted-foreground">
              {field.url}
            </code>
          </div>
        )}
        <label className="flex items-start gap-2 text-xs">
          <Checkbox
            checked={answers[field.key] === true}
            onCheckedChange={(checked) => onChange(checked)}
          />
          <span>我已完成此步骤：{field.title ?? field.key}</span>
        </label>
      </div>
    );
  }
  const title = field.title ?? field.key;
  const description = field.description ? (
    <span className="text-micro font-normal text-muted-foreground">{field.description}</span>
  ) : null;
  if (field.type === "boolean") {
    return (
      <label className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
        <Checkbox
          checked={Boolean(answers[field.key])}
          onCheckedChange={(checked) => onChange(Boolean(checked))}
        />
        <span>
          <span className="block font-medium">{title}</span>
          {description}
        </span>
      </label>
    );
  }
  if (field.type === "multiselect") {
    const selected = Array.isArray(answers[field.key]) ? (answers[field.key] as string[]) : [];
    const custom = selected.filter(
      (value) => !field.options.some((option) => option.value === value),
    );
    return (
      <div className="grid gap-2 rounded-lg border p-2 text-xs">
        <span id={labelID} className="px-1 pt-1 font-medium">
          {title}
        </span>
        {field.description ? <span className="px-1">{description}</span> : null}
        <CheckList
          aria-labelledby={labelID}
          options={field.options.map((option) => ({
            value: option.value,
            label: option.label,
            ...(option.description ? { description: option.description } : {}),
          }))}
          value={selected}
          onValueChange={(next) => onChange(next)}
        />
        {field.custom ? (
          <div className="flex gap-2 px-1 pb-1">
            <Input
              value={customValue}
              placeholder="自定义值"
              aria-label={`自定义 ${title}`}
              onChange={(event) => setCustomValue(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!customValue.trim() || selected.includes(customValue.trim())}
              onClick={() => {
                onChange([...selected, customValue.trim()]);
                setCustomValue("");
              }}
            >
              添加
            </Button>
          </div>
        ) : null}
        {custom.length ? (
          <div className="flex flex-wrap gap-1.5 px-1 pb-1">
            {custom.map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`移除 ${value}`}
                className="flex items-center gap-1 rounded-md border px-2 py-1 text-micro"
                onClick={() => onChange(selected.filter((item) => item !== value))}
              >
                {value}
                <X className="size-3" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  if (field.type === "string" && field.options.length > 0 && !field.custom) {
    return (
      <label className="grid gap-1.5 text-xs font-medium">
        {title}
        <Select
          value={String(answers[field.key] ?? "")}
          onValueChange={(value) => onChange(String(value))}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {description}
      </label>
    );
  }
  const numeric = field.type === "number" || field.type === "integer";
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {title}
      <Input
        type={
          numeric
            ? "number"
            : field.type === "string" && field.format === "email"
              ? "email"
              : "text"
        }
        value={answers[field.key] === undefined ? "" : String(answers[field.key])}
        placeholder={field.type === "string" ? (field.placeholder ?? undefined) : undefined}
        min={numeric ? (field.minimum ?? undefined) : undefined}
        max={numeric ? (field.maximum ?? undefined) : undefined}
        step={field.type === "integer" ? 1 : undefined}
        onChange={(event) =>
          onChange(
            numeric
              ? event.target.value === ""
                ? undefined
                : Number(event.target.value)
              : event.target.value,
          )
        }
      />
      {description}
    </label>
  );
}

function methodKey(method: PalotIntegrationMethod): string {
  const type = method.type === "unsupported" ? method.methodType : method.type;
  return `${type}:${method.id ?? "default"}`;
}

function connectionMethodIcon(
  method: Exclude<PalotIntegrationMethod, { type: "env" }>,
): ComponentType<{ className?: string }> {
  if (method.type === "key") return KeyRound;
  if (method.type === "command") return Terminal;
  if (method.type === "external") return ExternalLink;
  if (method.type === "unsupported") return CircleAlert;
  return LogIn;
}

function PendingIcon({ className }: { className?: string }) {
  return <LoaderCircle className={cn(className, "animate-spin")} aria-hidden="true" />;
}

/**
 * The code a device flow asks people to enter: the `user_code` URL parameter, or a short
 * code at the end of the instructions ("Enter code: ABCD-1234").
 */
function deviceCode(attempt: IntegrationConnectionAttempt): string | null {
  if (attempt.url) {
    try {
      const code = new URL(attempt.url).searchParams.get("user_code");
      if (code) return code;
    } catch {
      // Not a URL; fall back to the instructions.
    }
  }
  const match = attempt.instructions?.match(/:\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{3,})*)\s*$/);
  return match?.[1] ?? null;
}

function connectionMethodDescription(
  method: Exclude<PalotIntegrationMethod, { type: "env" }>,
): string {
  if (method.type === "key") return "输入来自提供者的 API 密钥。";
  if (method.type === "command") return "使用提供者的命令行流程授权。";
  if (method.type === "external") return "连接在 OpenCode 外部管理的凭据。";
  if (method.type === "unsupported") return "Palot 不支持。请在 OpenCode 中连接它。";
  return "使用提供者的登录流程授权。";
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
