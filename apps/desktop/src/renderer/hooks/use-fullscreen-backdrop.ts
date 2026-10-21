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
 * Resolves the wallpaper backdrop. The layer follows the *translucency* switch, not
 * the fullscreen state: every translucent window gets the same wash, fullscreen or not.
 */
export function useFullscreenBackdrop(): FullscreenBackdropLayer | null {
  const [layer, setLayer] = useState<FullscreenBackdropLayer | null>(null);

  useEffect(() => {
    const api = window.palot;
    if (!api.onWallpaperBackdropChanged && !api.getWallpaperBackdrop) return;

    let lastState: WallpaperBackdropState | null = null;

    const translucent = () =>
      document.documentElement.dataset.contentTranslucent === "true" &&
      document.documentElement.dataset.reducedTransparency !== "true";

    const refresh = (state: WallpaperBackdropState | null | undefined) => {
      if (state) lastState = state;
      setLayer(translucent() ? toLayer(state ?? lastState) : null);
    };

    const resolve = async () => {
      if (!translucent()) return setLayer(null);
      // Serve the cached snapshot instantly, then confirm with a fresh resolve.
      setLayer(toLayer(lastState));
      try {
        refresh(await api.getWallpaperBackdrop());
      } catch {
        setLayer(lastState ? toLayer(lastState) : { kind: "gradient", blur: null });
      }
    };

    // The appearance sync flips data-content-translucent / data-reduced-transparency
    // on :root; watch it so the layer follows the opacity slider live.
    const observer = new MutationObserver(() => {
      void resolve();
    });
    observer.observe(document.documentElement, {
      attributeFilter: ["data-content-translucent", "data-reduced-transparency"],
    });
    const unsubscribeBackdrop = api.onWallpaperBackdropChanged?.((state) => refresh(state));
    void resolve();

    return () => {
      observer.disconnect();
      unsubscribeBackdrop?.();
    };
  }, []);

  useEffect(() => {
    // Mirror the resolved layer onto :root so translucent glass cards (composer,
    // queue) can re-paint an aligned slice of the wallpaper locally.
    const root = document.documentElement;
    if (!layer) {
      delete root.dataset.palotWallpaper;
      root.style.removeProperty("--palot-wallpaper-image");
      return;
    }
    if (layer.kind === "image") {
      root.dataset.palotWallpaper = "image";
      root.style.setProperty("--palot-wallpaper-image", `url(${layer.url})`);
    } else {
      root.dataset.palotWallpaper = "gradient";
      root.style.removeProperty("--palot-wallpaper-image");
    }
  }, [layer]);

  return layer;
}
