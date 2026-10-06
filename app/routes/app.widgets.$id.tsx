import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useRef } from "react";
import { Form, redirect, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { getOrCreateShop } from "../models/shop.server";
import { createWidget, deleteWidget, getWidget, updateWidget, updateWidgetDeviceVisibility, updateWidgetFeaturedReel, updateWidgetPageTypes, updateWidgetReels, updateWidgetStyle, updateWidgetTargetRule } from "../models/widget.server";
import type { WidgetConfig, WidgetKind, WidgetStyleConfig } from "../models/widget.server";
import { listReels } from "../models/reel.server";
import { PreserveSearchParams } from "../components/PreserveSearchParams";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const widget = await getWidget(shop.id, params.id!);
  if (!widget) {
    throw new Response("Widget not found", { status: 404 });
  }

  const needsReelPicker =
    widget.type === "SINGLE_VIDEO" ||
    widget.type === "REEL_POPS" ||
    widget.type === "PRODUCT_PAGE_REELS" ||
    widget.type === "CAROUSEL" ||
    widget.type === "STORIES";
  const reels = needsReelPicker ? await listReels(admin, 50) : [];

  return { widget, reels };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const widget = await getWidget(shop.id, params.id!);
  if (!widget) {
    throw new Response("Widget not found", { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "set-target") {
    const handles = formData.getAll("productHandle").map(String).filter(Boolean);
    const targetRule: WidgetConfig["targetRule"] =
      handles.length > 0 ? { type: "handles", handles } : { type: "all_products" };
    await updateWidgetTargetRule(admin, shop.id, widget.id, targetRule);
    return { error: null };
  }

  if (intent === "set-target-collections") {
    const handles = formData.getAll("collectionHandle").map(String).filter(Boolean);
    const targetRule: WidgetConfig["targetRule"] =
      handles.length > 0 ? { type: "collections", handles } : { type: "all_products" };
    await updateWidgetTargetRule(admin, shop.id, widget.id, targetRule);
    return { error: null };
  }

  if (intent === "clear-target") {
    await updateWidgetTargetRule(admin, shop.id, widget.id, { type: "all_products" });
    return { error: null };
  }

  if (intent === "set-device-visibility") {
    const deviceVisibility = String(formData.get("deviceVisibility") ?? "all") as WidgetConfig["deviceVisibility"];
    await updateWidgetDeviceVisibility(admin, shop.id, widget.id, deviceVisibility);
    return { error: null };
  }

  if (intent === "set-page-types") {
    const pageTypes = formData.getAll("pageType").map(String).filter(Boolean);
    await updateWidgetPageTypes(admin, shop.id, widget.id, pageTypes);
    return { error: null };
  }

  if (intent === "set-featured-reel") {
    const featuredReelId = String(formData.get("featuredReelId") ?? "");
    if (!featuredReelId) {
      return { error: "Choose a reel first" };
    }
    await updateWidgetFeaturedReel(admin, shop.id, widget.id, featuredReelId);
    return { error: null };
  }

  if (intent === "set-reels") {
    const submittedReelIds = formData.getAll("reelId").map(String).filter(Boolean);
    // Filter against the reels currently available in the picker so a
    // stale/deleted reel id can never be persisted into a widget's curated
    // list — an invalid metaobject reference here would block every future
    // publish/unpublish/target-rule sync for this widget's kind (see
    // syncShopWidgetState, which writes the reel-list field in the same
    // metafieldsSet call as the widget's published/targetRule state).
    const validReelIds = new Set((await listReels(admin, 50)).map((reel) => reel.id));
    const reelIds = submittedReelIds.filter((reelId) => validReelIds.has(reelId));
    await updateWidgetReels(admin, shop.id, widget.id, reelIds);
    return { error: null };
  }

  if (intent === "set-style") {
    const str = (key: string) => {
      const value = String(formData.get(key) ?? "").trim();
      return value ? value : undefined;
    };
    const num = (key: string) => {
      const value = Number(formData.get(key));
      return Number.isFinite(value) && value > 0 ? value : undefined;
    };
    const bool = (key: string) => formData.get(key) === "true";

    const style: WidgetStyleConfig = {
      heading: str("heading"),
      watchLabel: str("watchLabel"),
      accentColor: str("accentColor"),
      triggerSize: num("triggerSize"),
      cornerStyle: str("cornerStyle") as WidgetStyleConfig["cornerStyle"],
      ctaColor: str("ctaColor"),
      ctaTextColor: str("ctaTextColor"),
      ctaLabel: str("ctaLabel"),
      showPrice: bool("showPrice"),
      showTitleOverlay: bool("showTitleOverlay"),
      mutedDefault: bool("mutedDefault"),
      loop: bool("loop"),
      storyDuration: num("storyDuration"),
      position: str("position") as WidgetStyleConfig["position"],
      showPulse: bool("showPulse"),
      backgroundColor: str("backgroundColor"),
      textColor: str("textColor"),
      shadowPreset: str("shadowPreset") as WidgetStyleConfig["shadowPreset"],
      layoutMode: str("layoutMode") as WidgetStyleConfig["layoutMode"],
      columns: num("columns"),
      playTrigger: str("playTrigger") as WidgetStyleConfig["playTrigger"],
      autoplayOnScroll: bool("autoplayOnScroll"),
      ctaStyle: str("ctaStyle") as WidgetStyleConfig["ctaStyle"],
      showProductImage: bool("showProductImage"),
      tagRevealMode: str("tagRevealMode") as WidgetStyleConfig["tagRevealMode"],
    };
    await updateWidgetStyle(admin, shop.id, widget.id, style);
    return { error: null };
  }

  if (intent === "delete") {
    await deleteWidget(admin, shop.id, widget.id);
    return redirect("/app/widgets");
  }

  if (intent === "duplicate") {
    // Published false by default — the one-published-widget-per-kind
    // invariant means a duplicate can't come in already published without
    // silently unpublishing the original (see updateWidget's sibling-
    // unpublish logic). No Shopify sync needed: createWidget never writes
    // the shop metafield, matching how creating any new unpublished widget
    // already works.
    await createWidget(
      shop.id,
      widget.type as WidgetKind,
      `${widget.name} (copy)`,
      widget.config as unknown as WidgetConfig,
    );
    return redirect("/app/widgets");
  }

  const name = String(formData.get("name") ?? "").trim();
  const published = formData.get("published") === "true";

  if (!name) {
    return { error: "Name is required" };
  }

  await updateWidget(admin, shop.id, widget.id, { name, published });
  return { error: null };
};

export default function WidgetDetail() {
  const { widget } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting =
    navigation.formData?.get("intent") == null &&
    navigation.state === "submitting";

  const shopify = useAppBridge();
  const targetFetcher = useFetcher<typeof action>();
  const targetRule = (widget.config as unknown as WidgetConfig).targetRule;
  const currentHandles = targetRule.type === "handles" ? targetRule.handles : [];
  const publishedRef = useRef<HTMLInputElement>(null);

  const handlePickProducts = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
    });
    if (!selected) return;

    const formData = new FormData();
    formData.set("intent", "set-target");
    for (const product of selected) {
      formData.append("productHandle", product.handle);
    }
    targetFetcher.submit(formData, { method: "post" });
  };

  const handleClearTarget = () => {
    const formData = new FormData();
    formData.set("intent", "clear-target");
    targetFetcher.submit(formData, { method: "post" });
  };

  return (
    <s-page heading={widget.name} inlineSize="large">
      <s-section>
        <form method="get" action="/app/widgets" style={{ margin: 0 }}>
          <PreserveSearchParams />
          <button
            type="submit"
            style={{
              all: "unset",
              cursor: "pointer",
              color: "var(--p-color-text-link, #2c6ecb)",
              textDecoration: "underline",
            }}
          >
            Back to widgets
          </button>
        </form>
      </s-section>
      <s-section heading="Details">
        <s-stack gap="base">
          {actionData?.error && (
            <s-paragraph tone="critical">{actionData.error}</s-paragraph>
          )}
          <s-paragraph>
            Type: <s-text>{widget.type}</s-text>
          </s-paragraph>
          <Form method="post" key={widget.id}>
            <s-stack gap="base">
              <s-text-field
                label="Name"
                name="name"
                defaultValue={widget.name}
                required
              ></s-text-field>
              <input
                type="hidden"
                name="published"
                ref={publishedRef}
                defaultValue={widget.published ? "true" : ""}
              />
              <s-checkbox
                label="Published"
                defaultChecked={widget.published}
                onChange={(event: { currentTarget: { checked: boolean } | null }) => {
                  if (publishedRef.current && event.currentTarget) {
                    publishedRef.current.value = event.currentTarget.checked ? "true" : "";
                  }
                }}
              ></s-checkbox>
              <s-button
                type="submit"
                variant="primary"
                {...(isSubmitting ? { loading: true } : {})}
              >
                Save
              </s-button>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>
      <s-section heading="Target products">
        <s-stack gap="base">
          {targetFetcher.data?.error && (
            <s-paragraph tone="critical">{targetFetcher.data.error}</s-paragraph>
          )}
          {targetRule.type === "all_products" ? (
            <s-paragraph>Showing on all products.</s-paragraph>
          ) : (
            <s-stack gap="small">
              <s-paragraph>Targeting {currentHandles.length} product(s):</s-paragraph>
              {currentHandles.map((handle) => (
                <s-paragraph key={handle}>{handle}</s-paragraph>
              ))}
            </s-stack>
          )}
          <s-button
            onClick={handlePickProducts}
            {...(targetFetcher.state !== "idle" ? { loading: true } : {})}
          >
            Choose products
          </s-button>
          {targetRule.type === "handles" && (
            <s-button onClick={handleClearTarget} variant="secondary">
              Target all products instead
            </s-button>
          )}
        </s-stack>
      </s-section>
      <s-section heading="Danger zone">
        <Form
          method="post"
          onSubmit={(e) => {
            if (!confirm("Delete this widget? This can't be undone.")) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="intent" value="delete" />
          <s-button type="submit" variant="secondary" tone="critical">
            Delete widget
          </s-button>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
