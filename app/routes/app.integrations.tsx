import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
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
const CLARITY_MODAL = "clarity-modal";
const EVENTS_MODAL = "events-modal";
const CUSTOM_PIXELS_HELP = "https://help.shopify.com/en/manual/promoting-marketing/pixels/custom-pixels";

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
  const clarityOn = tracking.clarityId !== "" && !clarityInvalid;

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

      <s-section padding="none" heading="Connect your tools">
        <Row
          title="Shopify customer events"
          description="Lets any pixel in Settings › Customer events use video events."
          control={
            <s-switch
              label="Publish video events to Shopify"
              labelAccessibilityVisibility="exclusive"
              checked={tracking.shopifyEvents}
              onInput={(e) => set({ shopifyEvents: e.currentTarget.checked })}
            />
          }
        />
        <s-divider />
        <Row
          title="Custom pixel"
          description="For Google, Meta and TikTok's Shopify channels."
          control={
            <s-button commandFor={PIXEL_MODAL} command="--show" onClick={() => setPixelTool("ga4")}>
              Set up
            </s-button>
          }
        />
        <s-divider />
        <Row
          title="Microsoft Clarity"
          description="Heatmaps and session recordings."
          badge={<s-badge tone={clarityOn ? "success" : "neutral"}>{clarityOn ? "Connected" : "Not connected"}</s-badge>}
          control={
            <s-button commandFor={CLARITY_MODAL} command="--show">
              {clarityOn ? "Edit" : "Set up"}
            </s-button>
          }
        />
      </s-section>

      <s-section padding="none" heading="Tags on your storefront">
        {PAGE_TAGS.map((tag, index) => (
          <s-stack key={tag.key}>
            {index > 0 && <s-divider />}
            <Row
              title={tag.name}
              description={`Needs ${tag.requires}.`}
              control={
                <s-switch
                  label={`Send events to ${tag.name}`}
                  labelAccessibilityVisibility="exclusive"
                  checked={tracking[tag.key]}
                  onInput={(e) => set({ [tag.key]: e.currentTarget.checked } as Partial<TrackingConfig>)}
                />
              }
            />
          </s-stack>
        ))}
        <s-divider />
        <s-box padding="base">
          <s-text color="subdued">
            Only sent when the visitor has allowed that kind of tracking. Using a Shopify channel instead? Its tag can&rsquo;t be
            reached from the page, so use a{" "}
            <s-link commandFor={PIXEL_MODAL} command="--show" onClick={() => setPixelTool("ga4")}>
              custom pixel
            </s-link>
            .
          </s-text>
        </s-box>
      </s-section>

      <s-stack alignItems="center" paddingBlock="large" gap="small-200">
        <s-link commandFor={EVENTS_MODAL} command="--show">
          View tracked events
        </s-link>
        <s-text color="subdued">
          Learn more about{" "}
          <s-link href={CUSTOM_PIXELS_HELP} target="_blank">
            custom pixels
          </s-link>
          .
        </s-text>
      </s-stack>

      <ClarityModal value={tracking.clarityId} invalid={clarityInvalid} onChange={(clarityId) => set({ clarityId })} />
      <CustomPixelModal tool={pixelTool} onTool={setPixelTool} shopifyEventsOn={tracking.shopifyEvents} />
      <EventsModal />
    </s-page>
  );
}

// One integration: name and a single line on the left, its control on the right.
function Row({
  title,
  description,
  badge,
  control,
}: {
  title: string;
  description: string;
  badge?: ReactNode;
  control: ReactNode;
}) {
  return (
    <s-box padding="base">
      <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
        <s-stack gap="small-300">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text type="strong">{title}</s-text>
            {badge}
          </s-stack>
          <s-text color="subdued">{description}</s-text>
        </s-stack>
        {control}
      </s-grid>
    </s-box>
  );
}

function ClarityModal({ value, invalid, onChange }: { value: string; invalid: boolean; onChange: (value: string) => void }) {
  return (
    <s-modal id={CLARITY_MODAL} heading="Microsoft Clarity" size="small">
      <s-stack gap="base">
        <s-paragraph>
          Free heatmaps and recordings. Sessions that added to cart from a video are kept, and every video event is tagged so you
          can filter by it.
        </s-paragraph>
        <s-text-field
          label="Project ID"
          placeholder="e.g. k2x9ab4cde"
          maxLength={20}
          autocomplete="off"
          value={value}
          error={invalid ? "A project ID is 6 to 20 letters and numbers." : undefined}
          details="In Clarity, open your project's Settings › Overview. Leave empty to disconnect. Skip this if Microsoft's own Clarity app is installed."
          onInput={(e) => onChange(e.currentTarget.value.trim().toLowerCase())}
        />
      </s-stack>
      <s-button slot="primary-action" variant="primary" commandFor={CLARITY_MODAL} command="--hide">
        Done
      </s-button>
    </s-modal>
  );
}

function EventsModal() {
  return (
    <s-modal id={EVENTS_MODAL} heading="Tracked events" size="base">
      <s-stack gap="base">
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
        <s-text color="subdued">Every event carries {EVENT_FIELDS}.</s-text>
        <s-text color="subdued">
          Meta and TikTok receive them as {TRACKED_EVENTS[0].pascal} and so on, Klaviyo as metrics like &ldquo;
          {TRACKED_EVENTS[3].label}&rdquo;. They never reuse the tools&rsquo; own names, such as add_to_cart, so conversions
          aren&rsquo;t counted twice.
        </s-text>
      </s-stack>
      <s-button slot="primary-action" variant="primary" commandFor={EVENTS_MODAL} command="--hide">
        Close
      </s-button>
    </s-modal>
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
