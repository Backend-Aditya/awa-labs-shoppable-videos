import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import prisma from "../db.server";
import { planFor, usageLevel } from "../models/plans";
import { useThemeStatus } from "../components/useThemeStatus";
import { themeEditorUrl } from "../components/themeEditor";
import { getBrand, saveBrand } from "../models/brand.server";
import type { BrandConfig } from "../models/brand";
import { BRAND_DEFAULTS } from "../models/brand";
import { useEditorGuards } from "../components/useEditorGuards";
import { Card, ColorInput, Segmented } from "../components/widget-editor/controls";
import styles from "../components/widget-editor/editor.module.css";
import brandStyles from "../components/widget-editor/brand.module.css";
import settingsStyles from "../components/settings.module.css";

const PRESET_KEYS = ["accentColor", "buttonColor", "buttonTextColor", "salePriceColor"] as const;
const PRESETS: { name: string; colors: Pick<BrandConfig, (typeof PRESET_KEYS)[number]> }[] = [
  { name: "Classic", colors: { accentColor: "#141414", buttonColor: "#141414", buttonTextColor: "#ffffff", salePriceColor: "#b42318" } },
  { name: "Ocean", colors: { accentColor: "#0b5cff", buttonColor: "#0b5cff", buttonTextColor: "#ffffff", salePriceColor: "#d92d20" } },
  { name: "Forest", colors: { accentColor: "#1a7f5a", buttonColor: "#1a7f5a", buttonTextColor: "#ffffff", salePriceColor: "#b54708" } },
  { name: "Berry", colors: { accentColor: "#a21caf", buttonColor: "#a21caf", buttonTextColor: "#ffffff", salePriceColor: "#be123c" } },
  { name: "Sunset", colors: { accentColor: "#e8590c", buttonColor: "#e8590c", buttonTextColor: "#ffffff", salePriceColor: "#9f1239" } },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const now = new Date();
  const views = await prisma.reelDailyStat
    .aggregate({
      where: { shopId: shop.id, day: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } },
      _sum: { views: true },
    })
    .then((r) => r._sum.views ?? 0)
    .catch(() => 0);
  const plan = planFor(shop.plan);
  return {
    brand: await getBrand(shop.id),
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    plan: { name: plan.name, price: plan.price },
    views,
    viewCap: shop.viewCapMonthly,
    viewLevel: usageLevel(views, shop.viewCapMonthly),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  try {
    const brand = await saveBrand(admin, shop.id, await request.json());
    return { ok: true, error: null, brand };
  } catch (e) {
    if (e instanceof Response) throw e;
    return { ok: false, error: "Couldn't save your brand kit. Try again.", brand: null };
  }
};

export default function Settings() {
  const { brand: saved, apiKey, plan, views, viewCap, viewLevel } = useLoaderData<typeof loader>();
  const theme = useThemeStatus();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [brand, setBrand] = useState<BrandConfig>(saved);
  const savedKey = JSON.stringify(saved);
  const baseline = useMemo(() => JSON.parse(savedKey) as BrandConfig, [savedKey]);

  useEffect(() => setBrand(baseline), [baseline]);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) shopify.toast.show("Brand kit saved");
    else if (fetcher.data.error) shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.state, fetcher.data, shopify]);

  const dirty = JSON.stringify(brand) !== savedKey;
  const saving = fetcher.state !== "idle";
  const set = (patch: Partial<BrandConfig>) => setBrand((prev) => ({ ...prev, ...patch }));
  const save = () => fetcher.submit(JSON.stringify(brand), { method: "post", encType: "application/json" });
  useEditorGuards({ dirty, onSave: save });

  return (
    <s-page heading="Settings" inlineSize="large">
      <SaveBar id="brand-save-bar" open={dirty} discardConfirmation>
        <button
          variant="primary"
          loading={saving ? "" : undefined}
          disabled={saving}
          onClick={save}
        >
          Save
        </button>
        <button disabled={saving} onClick={() => setBrand(baseline)}>
          Discard
        </button>
      </SaveBar>

      <div className={styles.shell}>
        <div className={styles.settingsColumn}>
          <section className={settingsStyles.plan}>
            <div className={settingsStyles.planTop}>
              <div>
                <p className={settingsStyles.eyebrow}>Your plan</p>
                <h2 className={settingsStyles.planName}>
                  {plan.name}
                  <span className={settingsStyles.planPrice}>{plan.price === 0 ? "Free" : `$${plan.price}/mo`}</span>
                </h2>
              </div>
              <s-button onClick={() => navigate("/app/pricing")}>{plan.price === 0 ? "Upgrade" : "Change plan"}</s-button>
            </div>
            <div className={settingsStyles.meterHead}>
              <span>Views this month</span>
              <span>
                {views.toLocaleString()} / {viewCap.toLocaleString()}
              </span>
            </div>
            <div
              className={settingsStyles.track}
              role="progressbar"
              aria-label="Views this month"
              aria-valuemin={0}
              aria-valuemax={viewCap}
              aria-valuenow={views}
            >
              <div
                className={settingsStyles.fill}
                data-level={viewLevel}
                style={{ width: `${Math.min(100, (views / Math.max(viewCap, 1)) * 100)}%` }}
              />
            </div>
          </section>

          <Card
            title="Brand kit"
            action={
              <button
                type="button"
                className={styles.noticeLink}
                disabled={JSON.stringify(brand) === JSON.stringify(BRAND_DEFAULTS)}
                onClick={() => set({ ...BRAND_DEFAULTS })}
              >
                Reset to defaults
              </button>
            }
            description="Every widget uses these unless you give it its own colors in the widget editor."
          >
            <div className={settingsStyles.presets} role="group" aria-label="Color presets">
              {PRESETS.map((preset) => {
                const active = PRESET_KEYS.every((k) => brand[k] === preset.colors[k]);
                return (
                  <button
                    key={preset.name}
                    type="button"
                    className={settingsStyles.preset}
                    data-active={active || undefined}
                    aria-pressed={active}
                    onClick={() => set(preset.colors)}
                  >
                    <span className={settingsStyles.swatches} aria-hidden="true">
                      <span style={{ background: preset.colors.buttonColor }} />
                      <span style={{ background: preset.colors.accentColor }} />
                      <span style={{ background: preset.colors.salePriceColor }} />
                    </span>
                    {preset.name}
                  </button>
                );
              })}
            </div>
            <div className={settingsStyles.colorGrid}>
              <ColorInput label="Accent" value={brand.accentColor} onChange={(accentColor) => set({ accentColor })} />
              <ColorInput label="Button" value={brand.buttonColor} onChange={(buttonColor) => set({ buttonColor })} />
              <ColorInput
                label="Button text color"
                value={brand.buttonTextColor}
                onChange={(buttonTextColor) => set({ buttonTextColor })}
              />
              <ColorInput
                label="Sale price"
                value={brand.salePriceColor}
                onChange={(salePriceColor) => set({ salePriceColor })}
              />
            </div>
          </Card>

          <Card title="Video viewer" description="How the full-screen player looks on your store.">
            <Segmented
              label="Viewer background"
              value={brand.viewerTheme}
              onChange={(viewerTheme) => set({ viewerTheme })}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
            />
            <Segmented
              label="Font"
              value={brand.fontFamily}
              onChange={(fontFamily) => set({ fontFamily })}
              options={[
                { value: "theme", label: "Your theme's" },
                { value: "system", label: "System" },
              ]}
              hint="“Your theme's” matches the rest of your store."
            />
          </Card>

          <Card title="Storefront setup" description="The app embed powers the floating player.">
            <div className={settingsStyles.setupRow}>
              <span className={settingsStyles.status} data-state={theme === null ? "unknown" : theme.embedOn ? "on" : "off"}>
                {theme === null ? "Checking your theme…" : theme.embedOn ? "App embed is on" : "App embed is off"}
              </span>
              <s-link href={themeEditorUrl(apiKey)} target="_top">
                {theme?.embedOn ? "Open theme editor" : "Turn on app embed"}
              </s-link>
            </div>
          </Card>
        </div>

        <div className={styles.previewColumn}>
          <BrandSample brand={brand} />
        </div>
      </div>
    </s-page>
  );
}

function BrandSample({ brand }: { brand: BrandConfig }) {
  const vars = {
    "--b-accent": brand.accentColor,
    "--b-button": brand.buttonColor,
    "--b-button-text": brand.buttonTextColor,
    "--b-sale": brand.salePriceColor,
    // Shopify's admin font. The real storefront font comes from the theme (or
    // the system) and can't be shown here, so the sample never imitates it.
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  } as CSSProperties;

  return (
    <div className={brandStyles.frame}>
      <p className={brandStyles.caption}>
        Sample, {brand.fontFamily === "theme" ? "text on your store uses your theme's font" : "text on your store uses the system font"}
      </p>
      <div className={brandStyles.stage} data-theme={brand.viewerTheme} style={vars}>
        <div className={brandStyles.player}>
          <span className={brandStyles.play}>
            <svg width="16" height="16" viewBox="0 0 10 10" aria-hidden="true">
              <path fill="currentColor" d="M2 1.2v7.6a.5.5 0 0 0 .76.43l6.1-3.8a.5.5 0 0 0 0-.86L2.76.77A.5.5 0 0 0 2 1.2Z" />
            </svg>
          </span>
          <span className={brandStyles.dots}>
            <span data-active />
            <span />
            <span />
          </span>
        </div>
        <div className={brandStyles.panel}>
          <p className={brandStyles.panelTitle}>Shop this video</p>
          {[
            { title: "Linen shirt", price: "$48.00", compare: "$60.00" },
            { title: "Canvas tote", price: "$32.00" },
          ].map((p) => (
            <div key={p.title} className={brandStyles.product}>
              <span className={brandStyles.thumb} />
              <span className={brandStyles.info}>
                <span>{p.title}</span>
                <span className={brandStyles.price}>
                  <span data-sale={p.compare ? true : undefined}>{p.price}</span>
                  {p.compare && <s>{p.compare}</s>}
                </span>
              </span>
              <span className={brandStyles.button}>Add to cart</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
