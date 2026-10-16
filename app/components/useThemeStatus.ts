// Real activation state of the app's theme extension, from App Bridge
// (`shopify.app.extensions()`): whether the app embed is on and which blocks
// are placed in the live theme. `null` while loading or when the host
// doesn't support the API — callers fall back to softer wording then.
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

export const EMBED_HANDLE = "shoppable-videos";

export interface ThemeStatus {
  embedOn: boolean;
  placedBlocks: Set<string>;
}

type Activation = { handle: string; status: string; activations?: unknown[] };
type ExtensionInfo = { type: string; activations?: Activation[] };

export function useThemeStatus(): ThemeStatus | null {
  const shopify = useAppBridge();
  const [status, setStatus] = useState<ThemeStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const app = (shopify as unknown as { app?: { extensions?: () => Promise<ExtensionInfo[]> } }).app;
    if (!app?.extensions) return;
    app
      .extensions()
      .then((extensions) => {
        if (cancelled) return;
        const theme = extensions.find((e) => e.type === "theme_app_extension");
        const activations = theme?.activations ?? [];
        setStatus({
          embedOn: activations.some((a) => a.handle === EMBED_HANDLE && a.status === "active"),
          placedBlocks: new Set(
            activations
              .filter((a) => a.handle !== EMBED_HANDLE && (a.status === "active" || (a.activations?.length ?? 0) > 0))
              .map((a) => a.handle),
          ),
        });
      })
      .catch(() => {
        // Unsupported or failed: leave status unknown.
      });
    return () => {
      cancelled = true;
    };
  }, [shopify]);

  return status;
}
