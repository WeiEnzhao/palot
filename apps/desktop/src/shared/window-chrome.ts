/** Window chrome modes shared by Electron main, preload, and renderer. */

export type WindowChromeTier = "liquid-glass" | "vibrancy" | "opaque";

export const WINDOW_CHROME_TIERS: readonly WindowChromeTier[] = [
  "liquid-glass",
  "vibrancy",
  "opaque",
];

export function isWindowChromeTier(value: string): value is WindowChromeTier {
  return WINDOW_CHROME_TIERS.includes(value as WindowChromeTier);
}

/** Present when a Linux tiling compositor owns window closing, so Palot omits its own close button. */
export const WINDOW_MANAGER_OWNS_CLOSE_ARGUMENT = "--palot-window-manager-owns-close";

/** Resolved fullscreen backdrop snapshot, sent to the renderer as a rasterized data URL. */
export type WallpaperBackdropSource = "custom" | "system" | "builtin";

/** Backdrop Gaussian strength: how much of the original image is still recognizable. */
export type WallpaperBackdropBlur = "soft" | "medium" | "strong";

export interface WallpaperBackdropState {
  /** JPEG data URL for the resolved backdrop, or null when only the builtin asset applies. */
  image: string | null;
  source: WallpaperBackdropSource;
  /** Blur tier applied by the renderer's backdrop layer (default keeps the legacy strength). */
  blur: WallpaperBackdropBlur;
}
