import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import { getTracking, saveTracking } from "../models/tracking.server";
import type { PageTagKey, TrackingConfig } from "../models/tracking";
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

const PIXEL_MODAL = "custom-pixel-modal";
const CUSTOM_PIXELS_HELP = "https://help.shopify.com/en/manual/promoting-marketing/pixels/custom-pixels";

// Where each tool's page tag is described: what the theme needs and which
// kind of visitor consent applies. Grouped the way merchants think of them.
const TAG_GROUPS: { heading: string; subheading: string; keys: PageTagKey[] }[] = [
  {
    heading: "Analytics",
    subheading: "See how videos perform next to the rest of your traffic.",
    keys: ["ga4", "gtm"],
  },
  {
    heading: "Advertising and email",
    subheading: "Build audiences and flows from what shoppers watch and add to cart.",
    keys: ["meta", "tiktok", "pinterest", "klaviyo"],
  },
];

export default function Integrations() {
  const { tracking: saved, apiKey } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const theme = useThemeStatus();
  const [tracking, setTracking] = useState<TrackingConfig>(saved);
  const [pixelTool, setPixelTool] = useState<PixelTool>("ga4");
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
  useEditorGuards({ dirty, onSave: save, saving });

  // The embed loads Clarity and runs the tag forwarding on every page, so
  // either one is useless with it switched off.
  const needsEmbed = tracking.clarityId !== "" || PAGE_TAGS.some((tag) => tracking[tag.key]);
  const embedOff = theme !== null && !theme.embedOn;

  const openPixel = (tool: PixelTool) => setPixelTool(tool);

  return (
    <s-page heading="Integrations" inlineSize="small">
      <SaveBar id="integrations-save-bar" open={dirty} discardConfirmation>
        <button variant="primary" loading={saving ? "" : undefined} disabled={saving || clarityInvalid} onClick={save}>
          Save
        </button>
        <button disabled={saving} onClick={() => setTracking(baseline)}>
          Discard
        </button>
      </SaveBar>

      {needsEmbed && embedOff && (
        <s-banner tone="warning" heading="Turn on the app embed">
          Clarity and tag forwarding run through the app embed, which is off in your theme.
          <s-button slot="secondary-actions" href={themeEditorUrl(apiKey)} target="_top">
            Turn on the app embed
          </s-button>
        </s-banner>
      )}

      <s-section
        heading="Shopify customer events"
        subheading="The simplest way to get video events into the tools you already use."
      >
        <s-badge slot="accessory" tone={tracking.shopifyEvents ? "success" : "neutral"}>
          {tracking.shopifyEvents ? "On" : "Off"}
        </s-badge>
        <s-switch
          label="Publish video events to Shopify"
          details="Any pixel under Settings › Customer events can use them, including the custom pixel below. Shopify applies each visitor's cookie choices."
          checked={tracking.shopifyEvents}
          onInput={(e) => set({ shopifyEvents: e.currentTarget.checked })}
        />
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-button commandFor={PIXEL_MODAL} command="--show" onClick={() => openPixel("ga4")}>
            Set up custom pixel
          </s-button>
          <s-text color="subdued">For Google Analytics, Meta and other sandboxed tools.</s-text>
        </s-stack>
      </s-section>

      <s-section
        heading="Microsoft Clarity"
        subheading="Free heatmaps and session recordings. Sessions that added to cart from a video are kept, and every video event is tagged for filtering."
      >
        <s-badge slot="accessory" tone={saved.clarityId !== "" ? "success" : "neutral"}>
          {saved.clarityId !== "" ? "Connected" : "Not connected"}
        </s-badge>
        <s-text-field
          label="Project ID"
          placeholder="e.g. k2x9ab4cde"
          maxLength={20}
          autocomplete="off"
          value={tracking.clarityId}
          error={clarityInvalid ? "A project ID is 6 to 20 letters and numbers." : undefined}
          details="In Clarity, open your project's Settings › Overview. Leave empty to disconnect. Skip this if Microsoft's own Clarity app is installed, video events reach it either way."
          onInput={(e) => set({ clarityId: e.currentTarget.value.trim().toLowerCase() })}
        />
      </s-section>

      {TAG_GROUPS.map((group) => (
        <s-section key={group.heading} heading={group.heading} subheading={group.subheading}>
          {group.keys.map((key, index) => {
            const tag = PAGE_TAGS.find((t) => t.key === key)!;
            const sandboxed = key === "ga4" ? "ga4" : key === "meta" ? "meta" : null;
            return (
              <s-stack key={key} gap="base">
                {index > 0 && <s-divider />}
                <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
                  <s-stack gap="small-200">
                    <s-heading>{tag.name}</s-heading>
                    <s-text color="subdued">
                      Needs {tag.requires}. Sent with {tag.consent} consent.
                    </s-text>
                  </s-stack>
                  <s-badge tone={tracking[key] ? "success" : "neutral"}>{tracking[key] ? "On" : "Off"}</s-badge>
                </s-grid>
                <s-switch
                  label={`Send events to ${tag.name}`}
                  labelAccessibilityVisibility="exclusive"
                  checked={tracking[key]}
                  onInput={(e) => set({ [key]: e.currentTarget.checked } as Partial<TrackingConfig>)}
                />
                {sandboxed && (
                  <s-text color="subdued">
                    Using Shopify&rsquo;s {tag.name === "Meta Pixel" ? "Facebook & Instagram" : "Google & YouTube"} channel instead? Its tag
                    can&rsquo;t be reached from the page, so{" "}
                    <s-link commandFor={PIXEL_MODAL} command="--show" onClick={() => openPixel(sandboxed)}>
                      use a custom pixel
                    </s-link>
                    .
                  </s-text>
                )}
              </s-stack>
            );
          })}
        </s-section>
      ))}

      <s-section
        heading="Events"
        subheading={`Every event carries ${EVENT_FIELDS}.`}
      >
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">When it happens</s-table-header>
            <s-table-header listSlot="secondary">Event name</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {TRACKED_EVENTS.map((event) => (
              <s-table-row key={event.name}>
                <s-table-cell>{event.when}</s-table-cell>
                <s-table-cell>
                  <code>{event.name}</code>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        <s-text color="subdued">
          Meta and TikTok receive them as {TRACKED_EVENTS[0].pascal} and so on, Klaviyo as metrics like &ldquo;
          {TRACKED_EVENTS[3].label}&rdquo; for flows. They never reuse the tools&rsquo; own names, such as add_to_cart, so
          conversions aren&rsquo;t counted twice.
        </s-text>
      </s-section>

      <s-stack alignItems="center" paddingBlock="large">
        <s-text color="subdued">
          Learn more about{" "}
          <s-link href={CUSTOM_PIXELS_HELP} target="_blank">
            custom pixels
          </s-link>
          .
        </s-text>
      </s-stack>

      <CustomPixelModal
        tool={pixelTool}
        onTool={setPixelTool}
        shopifyEventsOn={tracking.shopifyEvents}
      />
    </s-page>
  );
}

function CustomPixelModal({
  tool,
  onTool,
  shopifyEventsOn,
}: {
  tool: PixelTool;
  onTool: (tool: PixelTool) => void;
  shopifyEventsOn: boolean;
}) {
  const shopify = useAppBridge();
  const [ids, setIds] = useState<Record<PixelTool, string>>({ ga4: "", meta: "", any: "" });
  const id = ids[tool];
  const pattern = tool === "ga4" ? GA4_ID_PATTERN : META_PIXEL_ID_PATTERN;
  const invalid = tool !== "any" && id !== "" && !pattern.test(id);
  const code = customPixelCode(tool, invalid ? "" : id);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      shopify.toast.show("Code copied");
    } catch {
      // Clipboard blocked in this frame: the code is in a field to copy by hand.
      shopify.toast.show("Couldn't copy. Select the code and press Ctrl+C or ⌘C.", { isError: true });
    }
  };

  return (
    <s-modal id={PIXEL_MODAL} heading="Set up a custom pixel" size="large">
      <s-stack gap="base">
        {!shopifyEventsOn && (
          <s-banner tone="warning">
            Turn on &ldquo;Publish video events to Shopify&rdquo; and save, or a custom pixel won&rsquo;t receive anything.
          </s-banner>
        )}
        <s-paragraph>
          Google, Meta and TikTok&rsquo;s Shopify channels run in a sandbox the page can&rsquo;t reach. A custom pixel
          receives the video events there instead.
        </s-paragraph>
        <s-select
          label="Send to"
          value={tool}
          onInput={(e) => onTool(e.currentTarget.value as PixelTool)}
        >
          <s-option value="ga4">Google Analytics 4</s-option>
          <s-option value="meta">Meta Pixel</s-option>
          <s-option value="any">Another tool</s-option>
        </s-select>
        {tool !== "any" && (
          <s-text-field
            label={tool === "ga4" ? "Measurement ID" : "Pixel ID"}
            placeholder={tool === "ga4" ? "G-XXXXXXXXXX" : "1234567890123456"}
            autocomplete="off"
            value={id}
            error={invalid ? (tool === "ga4" ? "A measurement ID looks like G-AB12CD34EF." : "A pixel ID is 8 to 20 digits.") : undefined}
            details={
              tool === "ga4"
                ? "In Google Analytics › Admin › Data streams."
                : "In Meta Events Manager › Data sources."
            }
            onInput={(e) => {
              const value = e.currentTarget.value.trim();
              setIds((prev) => ({ ...prev, [tool]: tool === "ga4" ? value.toUpperCase() : value }));
            }}
          />
        )}
        <s-text-area label="Custom pixel code" value={code} rows={12} readOnly />
        <s-ordered-list>
          <s-list-item>
            In Shopify, open{" "}
            <s-link href="shopify://admin/settings/customer_events" target="_top">
              Settings › Customer events
            </s-link>{" "}
            and choose Add custom pixel.
          </s-list-item>
          <s-list-item>Paste the code and save.</s-list-item>
          <s-list-item>
            Under Customer privacy, set Permission to {tool === "meta" ? "Marketing" : "Analytics"}, then Connect.
          </s-list-item>
        </s-ordered-list>
      </s-stack>
      <s-button slot="primary-action" variant="primary" onClick={copy}>
        Copy code
      </s-button>
      <s-button slot="secondary-actions" commandFor={PIXEL_MODAL} command="--hide">
        Close
      </s-button>
    </s-modal>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
