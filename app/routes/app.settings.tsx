import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { getBrand, saveBrand } from "../models/brand.server";
import type { BrandConfig } from "../models/brand";
import { Card, ColorInput, Segmented } from "../components/widget-editor/controls";
import styles from "../components/widget-editor/editor.module.css";
import brandStyles from "../components/widget-editor/brand.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  return { plan: shop.plan, viewCap: shop.viewCapMonthly, brand: await getBrand(shop.id) };
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
  const { plan, viewCap, brand: saved } = useLoaderData<typeof loader>();
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

  return (
    <s-page heading="Settings" inlineSize="large">
      <SaveBar id="brand-save-bar" open={dirty}>
        <button
          variant="primary"
          loading={saving ? "" : undefined}
          disabled={saving}
          onClick={() => fetcher.submit(JSON.stringify(brand), { method: "post", encType: "application/json" })}
        >
          Save
        </button>
        <button disabled={saving} onClick={() => setBrand(baseline)}>
          Discard
        </button>
      </SaveBar>

      <div className={styles.shell}>
        <div className={styles.settingsColumn}>
          <Card
            title="Brand kit"
            description="Every widget uses these unless you give it its own colours in the widget editor."
          >
            <ColorInput label="Accent" value={brand.accentColor} onChange={(accentColor) => set({ accentColor })} />
            <ColorInput label="Button" value={brand.buttonColor} onChange={(buttonColor) => set({ buttonColor })} />
            <ColorInput
              label="Button text"
              value={brand.buttonTextColor}
              onChange={(buttonTextColor) => set({ buttonTextColor })}
            />
            <ColorInput
              label="Sale price"
              value={brand.salePriceColor}
              onChange={(salePriceColor) => set({ salePriceColor })}
            />
          </Card>

          <Card title="Video viewer">
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

          <Card title="Plan">
            <div className={brandStyles.plan}>
              <span className={brandStyles.planName}>{plan.charAt(0) + plan.slice(1).toLowerCase()}</span>
              <span className={styles.hint}>{viewCap.toLocaleString()} video views a month</span>
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
    fontFamily:
      brand.fontFamily === "system"
        ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        : 'Georgia, "Times New Roman", serif',
  } as CSSProperties;

  return (
    <div className={brandStyles.frame}>
      <p className={brandStyles.caption}>
        Sample — {brand.fontFamily === "theme" ? "shown in a serif to stand in for your theme font" : "system font"}
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
