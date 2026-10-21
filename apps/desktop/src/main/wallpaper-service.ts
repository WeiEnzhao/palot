/** Resolves the fullscreen backdrop snapshot: custom pick → system wallpaper → builtin still. */

import { app, dialog, nativeImage } from "electron";
import { execFileSync, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import Store from "electron-store";
import type { WallpaperBackdropState } from "../shared/window-chrome";

interface WallpaperStore {
  customPath?: string | null;
}

const RASTER_WIDTH = 1_600;
/** Repeated fullscreen toggles reuse the last raster for this long. */
const RESOLVE_CACHE_MS = 10_000;

/** macOS stores per-wallpaper choices in this XML plist (Sonoma and newer). */
const WALLPAPER_INDEX = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "com.apple.wallpaper",
  "Store",
  "Index.plist",
);

const backdropStore = new Store<WallpaperStore>({ name: "wallpaper-backdrop" });

/** Photo files referenced by non-dynamic wallpaper choices in the wallpaper Index.plist. */
function wallpaperIndexFiles(): string[] {
  try {
    const plist = execFileSync("/usr/bin/plutil", ["-convert", "xml1", "-o", "-", WALLPAPER_INDEX], {
      encoding: "utf8",
      timeout: 2_000,
    });
    const files: string[] = [];
    const entryPattern = /<key>Files<\/key>\s*<array>\s*([\s\S]*?)<\/array>/gu;
    for (const entry of plist.matchAll(entryPattern)) {
      const body = entry[1] ?? "";
      for (const file of body.matchAll(/<string>([^<]+)<\/string>/gu)) {
        const candidate = file[1];
        if (candidate) files.push(candidate);
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Downsize to a share-width JPEG via sips (ships with macOS, reads HEIC/JPEG/PNG/…). */
async function rasterize(sourcePath: string): Promise<string | null> {
  const target = path.join(app.getPath("temp"), `palot-wallpaper-${Date.now()}.jpg`);
  const exit = await new Promise<number>((resolve) => {
    const child = spawn(
      "/usr/bin/sips",
      [
        "-s",
        "format",
        "jpeg",
        "--resampleWidth",
        String(RASTER_WIDTH),
        sourcePath,
        "--out",
        target,
      ],
      { stdio: "ignore" },
    );
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
  if (exit !== 0) return null;
  try {
    const data = await fs.readFile(target);
    if (nativeImage.createFromBuffer(data).isEmpty()) return null;
    return `data:image/jpeg;base64,${data.toString("base64")}`;
  } catch {
    return null;
  } finally {
    await fs.rm(target, { force: true });
  }
}

async function resolveBackdrop(): Promise<WallpaperBackdropState> {
  // 1. Custom pick stored by the settings pane always wins.
  const customPath = backdropStore.get("customPath");
  if (customPath && (await exists(customPath))) {
    const image = await rasterize(customPath);
    if (image) return { image, source: "custom" };
  }

  // 2. Whatever the system currently shows behind windows (custom photos set in System Settings).
  for (const file of wallpaperIndexFiles()) {
    const image = await rasterize(file);
    if (image) return { image, source: "system" };
  }

  // 3. Dynamic/system-default wallpapers have no static file; the renderer falls back to its own still.
  return { image: null, source: "builtin" };
}

export function wallpaperBackdropService() {
  let pending: Promise<WallpaperBackdropState> | null = null;
  let pendingAt = 0;

  const throttled = (): Promise<WallpaperBackdropState> => {
    const now = Date.now();
    if (pending && now - pendingAt < RESOLVE_CACHE_MS) return pending;
    pendingAt = now;
    pending = resolveBackdrop();
    return pending;
  };

  return {
    resolve: throttled,
    async choose(): Promise<WallpaperBackdropState | null> {
      const result = await dialog.showOpenDialog({
        title: "选择全屏背景图片",
        properties: ["openFile"],
        filters: [
          {
            name: "图片",
            extensions: ["jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "tiff"],
          },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const picked = result.filePaths[0];
      if (!picked) return null;
      const image = await rasterize(picked);
      if (!image) throw new Error("无法读取所选图片");
      backdropStore.set("customPath", picked);
      return { image, source: "custom" };
    },
    async clear(): Promise<WallpaperBackdropState> {
      backdropStore.set("customPath", null);
      return resolveBackdrop();
    },
  };
}
