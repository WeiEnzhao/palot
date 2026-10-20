import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PalotModel,
  PalotProject,
  PalotProvider,
  PalotSettingsSnapshot,
} from "../../../shared";
import { modelPickerPreferencesAtom } from "../../atoms/ui";
import { runtimeAtom } from "../../atoms/workspace";
import { modelProjectPreferenceKey } from "../../lib/model-preferences";
import { palot } from "../../services/palot";
import { ProviderSettings } from "./providers-settings";

const links = vi.hoisted(() => ({ openModels: vi.fn(), openProviders: vi.fn() }));
vi.mock("./settings-links", () => ({
  useModelProviderLinks: () => ({ available: true, ...links }),
  useModelsProviderParam: () => undefined,
}));

const project: PalotProject = {
  id: "project-1",
  canonical: "/repo",
  name: "Example",
  sandboxes: [],
  vcs: null,
  updatedAt: null,
};

function provider(id: string, name: string): PalotProvider {
  return { id, name, integrationID: id, package: "", disabled: false };
}

function model(providerID: string, id: string): PalotModel {
  return {
    id,
    modelID: id,
    providerID,
    name: id,
    family: null,
    variants: [],
    inputLimit: null,
    contextLimit: 1000,
    outputLimit: 100,
    releasedAt: 0,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    status: "active",
  };
}

function snapshot(): PalotSettingsSnapshot {
  return {
    location: { directory: "/repo" },
    configSources: [
      {
        type: "document",
        path: "/repo/opencode.json",
        summary: null,
        formatters: [],
        languageServers: [],
        permissions: [],
        providerIDs: ["local-llm"],
        providerPolicies: [{ resource: "openrouter", effect: "deny" }],
      },
    ],
    catalog: {
      models: [model("openai", "gpt-a"), model("openai", "gpt-b"), model("local-llm", "small")],
      defaultModel: null,
      providers: [
        provider("openai", "OpenAI"),
        provider("anthropic", "Anthropic"),
        provider("local-llm", "Local LLM"),
      ],
      errors: [],
    },
    agents: [],
    integrations: [
      {
        id: "openai",
        name: "OpenAI",
        methods: [
          { id: null, type: "key", label: "API key", form: [] },
          { id: null, type: "env", label: "OPENAI_API_KEY", names: ["OPENAI_API_KEY"], form: [] },
        ],
        connections: [
          { type: "credential", id: "work", label: "Work", active: true, method: "oauth" },
          { type: "credential", id: "personal", label: "Personal", active: false, method: "key" },
          { type: "env", id: null, label: "OPENAI_API_KEY", active: false },
        ],
      },
      {
        id: "anthropic",
        name: "Anthropic",
        methods: [
          {
            id: null,
            type: "env",
            label: "ANTHROPIC_API_KEY",
            names: ["ANTHROPIC_API_KEY"],
            form: [],
          },
        ],
        connections: [{ type: "env", id: null, label: "ANTHROPIC_API_KEY", active: true }],
      },
      { id: "local-llm", name: "Local LLM", methods: [], connections: [] },
      {
        id: "openrouter",
        name: "OpenRouter",
        methods: [{ id: null, type: "key", label: "API key", form: [] }],
        connections: [
          { type: "credential", id: "router", label: "Router key", active: true, method: "key" },
        ],
      },
      {
        id: "groq",
        name: "Groq",
        methods: [
          { id: null, type: "key", label: "API key", form: [] },
          { id: null, type: "env", label: "GROQ_API_KEY", names: ["GROQ_API_KEY"], form: [] },
        ],
        connections: [],
      },
      {
        id: "envonly",
        name: "Env Only Cloud",
        methods: [
          {
            id: null,
            type: "env",
            label: "ENVONLY_KEY, ENVONLY_TOKEN",
            names: ["ENVONLY_KEY", "ENVONLY_TOKEN"],
            form: [],
          },
        ],
        connections: [],
      },
    ],
    mcpServers: [],
    mcpResources: [],
    mcpResourceTemplates: [],
    savedPermissions: [],
    plugins: [],
    skills: [],
    commands: [],
    references: [],
    websearchProviders: [],
    errors: [],
  };
}

function renderProviders(value = snapshot()) {
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "connection-1",
    profileID: "local-default",
    phase: "connected",
    connected: true,
    contractVersion: "2.0.29",
    version: "2.0.29",
    binaryPath: null,
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  store.set(modelPickerPreferencesAtom, {
    [modelProjectPreferenceKey("local-default", project.id)]: {
      hidden: ["openai/gpt-b"],
      order: [],
    },
  });
  const refresh = vi.fn(async () => {});
  render(
    <Provider store={store}>
      <ProviderSettings
        project={project}
        location={{ directory: "/repo" }}
        snapshot={value}
        refresh={refresh}
      />
    </Provider>,
  );
  return { refresh };
}

beforeEach(() => {
  vi.spyOn(palot, "removeCredential").mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  links.openModels.mockReset();
});

describe("Providers settings", () => {
  it("labels each connected provider with its source and links to its models", async () => {
    renderProviders();
    const openAI = screen.getByRole("article", { name: "OpenAI 连接" });
    expect(within(openAI).getByText("Account")).toBeTruthy();
    expect(within(openAI).getByText("2 个已存储凭据 · 1 个环境变量回退")).toBeTruthy();
    expect(
      within(screen.getByRole("article", { name: "Anthropic 连接" })).getByText("Env"),
    ).toBeTruthy();
    const local = screen.getByRole("article", { name: "Local LLM 连接" });
    expect(within(local).getByText("Config")).toBeTruthy();
    expect(within(local).getByText("Defined in OpenCode config")).toBeTruthy();
    expect(within(local).queryByRole("button", { name: /断开/ })).toBeNull();

    await userEvent
      .setup()
      .click(within(openAI).getByRole("button", { name: "1 / 2 个模型已显示" }));
    expect(links.openModels).toHaveBeenCalledWith("openai");
  });

  it("explains a provider that config disables while keeping its credentials", () => {
    renderProviders();
    const router = screen.getByRole("article", { name: "OpenRouter 连接" });
    expect(within(router).getAllByText("已被配置禁用").length).toBeGreaterThan(0);
    expect(within(router).getByRole("alert").textContent).toContain(
      "/repo/opencode.json 中的 provider.use 拒绝策略（openrouter）关闭了 OpenRouter。",
    );
    expect(within(router).queryByRole("button", { name: /个模型已显示/ })).toBeNull();
    expect(within(router).getByRole("group", { name: "Router key 连接" })).toBeTruthy();
  });

  it("disconnects only after an armed confirmation that names what remains", async () => {
    const user = userEvent.setup();
    const { refresh } = renderProviders();
    const openAI = screen.getByRole("article", { name: "OpenAI 连接" });
    await user.click(within(openAI).getByRole("button", { name: "断开" }));
    expect(palot.removeCredential).not.toHaveBeenCalled();
    const warning = await within(openAI).findByRole("alert");
    expect(warning.textContent).toContain("这将从此 OpenCode 服务中移除 2 个已存储凭据");
    expect(warning.textContent).toContain(
      "OpenAI 将回退到环境中的 OPENAI_API_KEY",
    );
    await user.keyboard("{Escape}");
    expect(within(openAI).getByRole("button", { name: "断开" })).toBeTruthy();
    await user.click(within(openAI).getByRole("button", { name: "断开" }));
    await user.click(within(openAI).getByRole("button", { name: "确认断开" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(
      vi.mocked(palot.removeCredential).mock.calls.map(([input]) => input.credentialID),
    ).toEqual(["work", "personal"]);
    expect(palot.removeCredential).toHaveBeenCalledWith(
      expect.objectContaining({ connectionID: "connection-1", directory: "/repo" }),
    );
  });

  it("lists environment-only providers with copyable variable names", async () => {
    const user = userEvent.setup();
    renderProviders();
    const available = () => screen.getByRole("list", { name: /提供者/ });
    expect(screen.queryByRole("listitem", { name: "Env Only Cloud" })).toBeNull();
    expect(screen.getByText(/还有 2 个更多提供者/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "浏览全部" }));
    expect(within(available()).getByRole("listitem", { name: "Env Only Cloud" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "仅看常用" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索提供者" }), "env only");
    const envOnly = within(available()).getByRole("listitem", { name: "Env Only Cloud" });
    expect(within(envOnly).queryByRole("button", { name: "连接" })).toBeNull();
    expect(within(envOnly).getByRole("group", { name: "ENVONLY_KEY 变量名" })).toBeTruthy();
    expect(
      within(envOnly).getByRole("group", { name: "ENVONLY_TOKEN 变量名" }),
    ).toBeTruthy();

    await user.clear(screen.getByRole("searchbox", { name: "搜索提供者" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索提供者" }), "groq");
    const groq = within(available()).getByRole("listitem", { name: "Groq" });
    expect(within(groq).getByRole("button", { name: "连接" })).toBeTruthy();
    expect(groq.textContent).toContain("或在 OpenCode 运行处设置 GROQ_API_KEY。");
  });

  it("shows search matches that are already connected instead of an empty list", async () => {
    const user = userEvent.setup();
    renderProviders();
    await act(() =>
      user.type(screen.getByRole("searchbox", { name: "搜索提供者" }), "openai"),
    );
    expect(screen.getByText("已连接：OpenAI")).toBeTruthy();
    expect(screen.getByText("没有其他提供者匹配此搜索。")).toBeTruthy();
  });
});
