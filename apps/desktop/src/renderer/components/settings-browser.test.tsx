import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import {
  browserLocalLinksAtom,
  browserSearchEngineAtom,
  browserShowFullURLAtom,
  browserWebLinksAtom,
  experimentalBrowserAtom,
} from "../atoms/ui";
import { createRendererQueryClient } from "../lib/query-client";
import { Settings } from "./settings";

vi.mock("../hooks/use-connection-overview", () => ({
  useConnectionOverview: () => ({ connections: [] }),
}));
vi.mock("../hooks/use-navigation", () => ({
  usePalotNavigation: () => ({ closeSettings: vi.fn(), openSettings: vi.fn() }),
}));
// These tests cover Settings content; the navigation rail belongs to the app shell.
vi.mock("./navigation-rail", () => ({ NavigationRail: () => null }));
vi.mock("../hooks/use-session-catalog", () => ({ useSelectedSession: () => null }));

afterEach(cleanup);

it("shows Browser access and updates its local preferences independently", async () => {
  const store = createStore();
  render(
    <QueryClientProvider client={createRendererQueryClient()}>
      <Provider store={store}>
        <Settings category="browser" />
      </Provider>
    </QueryClientProvider>,
  );

  const user = userEvent.setup();
  expect(screen.getByText(/可以访问从该服务器可达的站点/).textContent).toMatch(
    /localhost 和私有网络。Palot 尚不支持逐站点审批/,
  );
  expect(screen.queryByRole("combobox", { name: "配置服务器" })).toBeNull();
  expect(screen.getByText("Palot 不提供")).toBeTruthy();
  expect(screen.getByRole("button", { name: "清除数据" }).hasAttribute("disabled")).toBe(true);

  await user.click(screen.getByRole("switch", { name: "启用实验性浏览器" }));
  expect(store.get(experimentalBrowserAtom)).toBe(true);

  await user.click(screen.getByRole("combobox", { name: "搜索引擎" }));
  await user.click(screen.getByRole("option", { name: "DuckDuckGo" }));
  expect(store.get(browserSearchEngineAtom)).toBe("duckduckgo");

  await user.click(screen.getByRole("combobox", { name: "网页链接" }));
  await user.click(screen.getByRole("option", { name: "Palot 浏览器" }));
  expect(store.get(browserWebLinksAtom)).toBe("browser");
  expect(store.get(browserLocalLinksAtom)).toBe("browser");

  await user.click(screen.getByRole("combobox", { name: "本地开发链接" }));
  await user.click(screen.getByRole("option", { name: "外部浏览器" }));
  expect(store.get(browserLocalLinksAtom)).toBe("external");
  expect(store.get(browserWebLinksAtom)).toBe("browser");

  await user.click(screen.getByRole("switch", { name: "显示完整 URL" }));
  expect(store.get(browserShowFullURLAtom)).toBe(true);
});
