import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import { getTracking, saveTracking } from "../models/tracking.server";
import type { TrackingConfig } from "../models/tracking";
import {
  CLARITY_ID_PATTERN,
  EVENT_FIELDS,
  GA4_ID_PATTERN,
  META_PIXEL_ID_PATTERN,
  PAGE_TAGS,
  TRACKED_EVENTS,
  customPixelCode,
} from "../models/tracking";
import { useEditorGuards } from "../components/useEditorGuards";
import { useThemeStatus } from "../components/useThemeStatus";
import { themeEditorUrl } from "../components/themeEditor";
import { Card, Field, Segmented, Toggle } from "../components/widget-editor/controls";
import styles from "../components/widget-editor/editor.module.css";
import own from "../components/integrations.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  // eslint-disable-next-line no-undef
  return { tracking: await getTracking(shop.id), apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  try {
    const tracking = await saveTracking(admin, shop.id, await request.json());
    return { ok: true, error: null, tracking };
  } catch (e) {
    if (e instanceof Response) throw e;
    return { ok: false, error: "Couldn't save your integrations. Try again.", tracking: null };
  }
};

type PixelTool = "ga4" | "meta" | "any";

export default function Integrations() {
  const { tracking: saved, apiKey } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const theme = useThemeStatus();
  const [tracking, setTracking] = useState<TrackingConfig>(saved);
  const savedKey = JSON.stringify(saved);
  const baseline = useMemo(() => JSON.parse(savedKey) as TrackingConfig, [savedKey]);

  useEffect(() => setTracking(baseline), [baseline]);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) shopify.toast.show("Integrations saved");
    else if (fetcher.data.error) shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.state, fetcher.data, shopify]);

  const clarityInvalid = tracking.clarityId !== "" && !CLARITY_ID_PATTERN.test(tracking.clarityId);
  const dirty = JSON.stringify(tracking) !== savedKey;
  const saving = fetcher.state !== "idle";
  const set = (patch: Partial<TrackingConfig>) => setTracking((prev) => ({ ...prev, ...patch }));
  const save = () => {
    if (clarityInvalid) return;
    fetcher.submit(JSON.stringify(tracking), { method: "post", encType: "application/json" });
  };
  useEditorGuards({ dirty, onSave: save });

  const clarityConnected = saved.clarityId !== "";
  const embedOff = theme !== null && !theme.embedOn;

  return (
    <s-page heading="Integrations" inlineSize="large">
      <SaveBar id="integrations-save-bar" open={dirty} discardConfirmation>
        <button variant="primary" loading={saving ? "" : undefined} disabled={saving || clarityInvalid} onClick={save}>
          Save
        </button>
        <button disabled={saving} onClick={() => setTracking(baseline)}>
          Discard
        </button>
      </SaveBar>

      <div className={styles.shell}>
        <div className={styles.settingsColumn}>
          <Card
            title="Shopify customer events"
            description="The simplest way to get video events into the tools you already use."
            action={<Status on={tracking.shopifyEvents} />}
          >
            <Toggle
              label="Publish video events to Shopify"
              description="Any pixel under Settings › Customer events can use them — the custom pixel on this page, or your own. Shopify applies each visitor's cookie consent."
              checked={tracking.shopifyEvents}
              onChange={(shopifyEvents) => set({ shopifyEvents })}
            />
          </Card>

          <Card
            title="Microsoft Clarity"
            description="Free heatmaps and session recordings. Recordings of sessions that added to cart from a video are kept, and every video event is tagged so you can filter by it."
            action={<Status on={clarityConnected} />}
          >
            <ClarityField value={tracking.clarityId} invalid={clarityInvalid} onChange={(clarityId) => set({ clarityId })} />
            {tracking.clarityId !== "" && embedOff && (
              <s-banner tone="warning">
                Clarity records every page through the app embed, which is off in your theme.{" "}
                <s-link href={themeEditorUrl(apiKey)} target="_top">
                  Turn on the app embed
                </s-link>
              </s-banner>
            )}
          </Card>

          <Card
            title="Tags on your storefront"
            description="If your theme already runs these tags, video events are sent to them too — only when the visitor has allowed that kind of tracking."
          >
            {PAGE_TAGS.map((tag) => (
              <Toggle
                key={tag.key}
                label={tag.name}
                description={`Needs ${tag.requires}. Sent with ${tag.consent} consent.`}
                checked={tracking[tag.key]}
                onChange={(on) => set({ [tag.key]: on } as Partial<TrackingConfig>)}
              />
            ))}
          </Card>
        </div>

        <div className={styles.settingsColumn}>
          <CustomPixel enabled={tracking.shopifyEvents} />
          <Card title="Events" description={`Each carries ${EVENT_FIELDS}.`}>
            <table className={own.events}>
              <tbody>
                {TRACKED_EVENTS.map((event) => (
                  <tr key={event.name}>
                    <th scope="row">{event.when}</th>
                    <td>
                      <code>{event.name}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.hint}>
              Meta and TikTok receive them as <code>{TRACKED_EVENTS[0].pascal}</code> and so on; Klaviyo as metrics like “
              {TRACKED_EVENTS[3].label}”, ready for flows. They never reuse the tools’ own names (like add_to_cart), so
              conversions aren’t counted twice.
            </p>
          </Card>
        </div>
      </div>
    </s-page>
  );
}

function Status({ on }: { on: boolean }) {
  return (
    <span className={own.status} data-on={on || undefined}>
      {on ? "On" : "Off"}
    </span>
  );
}

function ClarityField({ value, invalid, onChange }: { value: string; invalid: boolean; onChange: (value: string) => void }) {
  const id = "clarity-project-id";
  return (
    <Field
      label="Project ID"
      htmlFor={id}
      hint={
        <>
          In{" "}
          <a href="https://clarity.microsoft.com" target="_blank" rel="noreferrer">
            Clarity
          </a>
          , open your project’s Settings › Overview. Leave empty to disconnect. Skip this if Microsoft’s own Clarity app
          is installed — video events reach it either way.
        </>
      }
    >
      <input
        id={id}
        className={styles.input}
        type="text"
        value={value}
        placeholder="e.g. k2x9ab4cde"
        maxLength={20}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.currentTarget.value.trim().toLowerCase())}
      />
      {invalid && (
        <p id={`${id}-error`} className={own.error}>
          A project ID is 6–20 letters and numbers.
        </p>
      )}
    </Field>
  );
}

function CustomPixel({ enabled }: { enabled: boolean }) {
  const shopify = useAppBridge();
  const [tool, setTool] = useState<PixelTool>("ga4");
  const [ids, setIds] = useState<Record<PixelTool, string>>({ ga4: "", meta: "", any: "" });
  const codeRef = useRef<HTMLPreElement>(null);
  const id = ids[tool];
  const pattern = tool === "ga4" ? GA4_ID_PATTERN : META_PIXEL_ID_PATTERN;
  const invalid = tool !== "any" && id !== "" && !pattern.test(id);
  const code = customPixelCode(tool, id);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard blocked in this frame: select the code so ⌘/Ctrl+C works.
      const range = document.createRange();
      range.selectNodeContents(codeRef.current!);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      shopify.toast.show("Code selected — press ⌘C or Ctrl+C to copy");
      return;
    }
    shopify.toast.show("Code copied");
  };

  return (
    <Card
      title="Custom pixel"
      description="Google Analytics, Meta and TikTok's Shopify channels run sandboxed, out of the tags' reach. A custom pixel brings video events to them."
    >
      {!enabled && (
        <s-banner tone="warning">Turn on “Publish video events to Shopify” for a custom pixel to receive them.</s-banner>
      )}
      <Segmented
        label="Send to"
        value={tool}
        onChange={setTool}
        options={[
          { value: "ga4", label: "Google Analytics 4" },
          { value: "meta", label: "Meta Pixel" },
          { value: "any", label: "Other" },
        ]}
      />
      {tool !== "any" && (
        <Field
          label={tool === "ga4" ? "Measurement ID" : "Pixel ID"}
          htmlFor="pixel-id"
          hint={tool === "ga4" ? "In Google Analytics › Admin › Data streams, e.g. G-AB12CD34EF." : "In Meta Events Manager › Data sources, e.g. 1234567890123456."}
        >
          <input
            id="pixel-id"
            className={styles.input}
            type="text"
            value={id}
            placeholder={tool === "ga4" ? "G-XXXXXXXXXX" : "1234567890123456"}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid || undefined}
            onChange={(e) => {
              const value = e.currentTarget.value.trim();
              setIds((prev) => ({ ...prev, [tool]: tool === "ga4" ? value.toUpperCase() : value }));
            }}
          />
        </Field>
      )}
      <div className={own.codeWrap}>
        <div className={own.codeBar}>
          <span>Custom pixel code</span>
          <button type="button" className={own.copy} onClick={copy}>
            Copy
          </button>
        </div>
        <pre ref={codeRef} className={own.code} aria-label="Custom pixel code">
          {code}
        </pre>
      </div>
      <ol className={own.steps}>
        <li>
          In Shopify, open{" "}
          <s-link href="shopify://admin/settings/customer_events" target="_top">
            Settings › Customer events
          </s-link>{" "}
          and choose Add custom pixel.
        </li>
        <li>Paste the code and save.</li>
        <li>
          Under Customer privacy, set Permission to {tool === "meta" ? "Marketing" : "Analytics"}, then Connect.
        </li>
      </ol>
    </Card>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
