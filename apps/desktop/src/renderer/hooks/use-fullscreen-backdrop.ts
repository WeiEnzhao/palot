/** Feeds the fullscreen backdrop layer: custom pick → system wallpaper → gradient fallback. */

import { useEffect, useState } from "react";
import type { WallpaperBackdropState } from "../../shared/window-chrome";

export type FullscreenBackdropLayer =
  | { kind: "image"; url: string; blur: WallpaperBackdropState["blur"] }
  | { kind: "gradient"; blur: null };

/** Backdrop blur per tier; strong matches the legacy fixed 48px wash. */
export const BACKDROP_BLUR_PX: Record<WallpaperBackdropState["blur"], number> = {
  soft: 16,
  medium: 32,
  strong: 48,
};

function toLayer(state: WallpaperBackdropState | null | undefined): FullscreenBackdropLayer {
  if (state?.image) return { kind: "image", url: state.image, blur: state.blur };
  // No static source (dynamic/system-default wallpaper): fall back to the themed gradient wash.
  return { kind: "gradient", blur: null };
}

/**
 * Resolves the fullscreen backdrop once per fullscreen entry; normal (non-fullscreen)
 * windows never render the layer, so native vibrancy is untouched.
 */
export function useFullscreenBackdrop(): FullscreenBackdropLayer | null {
  const [layer, setLayer] = useState<FullscreenBackdropLayer | null>(null);

  useEffect(() => {
    const api = window.palot;
    if (!api.onFullscreenChanged) return;

    let lastFullscreen = false;
    let lastState: WallpaperBackdropState | null = null;
    const swap = (state: WallpaperBackdropState | null | undefined) => {
      if (state) lastState = state;
      setLayer(lastFullscreen ? toLayer(state ?? lastState) : null);
    };

    const onEnter = async () => {
      lastFullscreen = true;
      document.documentElement.dataset.palotFullscreen = "true";
      // Serve the cached snapshot instantly, then confirm with a fresh resolve.
      setLayer(toLayer(lastState));
      try {
        swap(await api.getWallpaperBackdrop());
      } catch {
        setLayer(lastState ? toLayer(lastState) : { kind: "gradient", blur: null });
      }
    };
    const onExit = () => {
      lastFullscreen = false;
      document.documentElement.dataset.palotFullscreen = "false";
      setLayer(null);
    };

    const unsubscribeBackdrop = api.onWallpaperBackdropChanged?.((state) => swap(state));
    const unsubscribeFullscreen = api.onFullscreenChanged((fullscreen) => {
      if (fullscreen) void onEnter();
      else onExit();
    });
    return () => {
      unsubscribeBackdrop?.();
      unsubscribeFullscreen();
    };
  }, []);

  return layer;
}
