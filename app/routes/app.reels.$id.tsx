import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useState } from "react";
import { Form, redirect, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { deleteReel, getProductsByIds, getReel, syncProductReelMetafields, updateReelConfig, upsertReel } from "../models/reel.server";
import { deriveReelStatus } from "../models/reel-status";
import { PreserveSearchParams } from "../components/PreserveSearchParams";

const REEL_STATUS_LABELS: Record<string, string> = {
  draft: "No video",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

// The route param is the trailing numeric id only (see app.reels.tsx's
// href construction) — the full GID is reconstructed here, server-side,
// so the URL never has to carry ':' or '/' characters.
function toReelGid(numericId: string): string {
  return `gid://shopify/Metaobject/${numericId}`;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  // Temporary diagnostic wrapper: surface ANY failure visibly on the page
  // instead of letting it fall into Shopify's bare-div error boundary
  // (which renders as near-invisible unstyled text — easy to mistake for
  // "the page did nothing"). Once navigation is confirmed working, this
  // can be simplified back to letting errors throw normally.
  try {
    const { admin } = await authenticate.admin(request);
    const reel = await getReel(admin, toReelGid(params.id!));
    if (!reel) {
      return {
        loaderError: `No reel found for id "${params.id}" (looked up as ${toReelGid(params.id!)})`,
        reel: null,
        taggedProducts: [],
      };
    }
    const taggedProducts = await getProductsByIds(admin, reel.config.productIds);
    return { loaderError: null, reel, taggedProducts };
  } catch (e) {
    if (e instanceof Response) throw e;
    return {
      loaderError: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      reel: null,
      taggedProducts: [],
    };
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const reel = await getReel(admin, toReelGid(params.id!));
  if (!reel) {
    throw new Response("Reel not found", { status: 404 });
  }

  if (intent === "set-products") {
    const productIds = formData.getAll("productId").map(String);
    const previousProductIds = reel.config.productIds;
    await updateReelConfig(admin, reel.id, { productIds });
    await syncProductReelMetafields(admin, reel.id, previousProductIds, productIds);
    return { error: null };
  }

  if (intent === "delete") {
    await deleteReel(admin, reel.id);
    return redirect("/app/reels");
  }

  const title = String(formData.get("title") ?? "").trim();
  const published = formData.get("published") === "true";

  if (!title) {
    return { error: "Title is required" };
  }

  await upsertReel(admin, reel.handle, title, published, reel.config);
  return { error: null };
};

export default function ReelDetail() {
  const { loaderError, reel, taggedProducts } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting =
    navigation.formData?.get("intent") == null && navigation.state === "submitting";
  const shopify = useAppBridge();
  const productsFetcher = useFetcher<typeof action>();
  const [published, setPublished] = useState(reel?.published ?? false);

  useEffect(() => {
    if (reel) setPublished(reel.published);
  }, [reel]);

  const handlePickProducts = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: taggedProducts.map((p) => ({ id: p.id })),
    });
    if (!selected) return;

    const formData = new FormData();
    formData.set("intent", "set-products");
    for (const product of selected) {
      formData.append("productId", product.id);
    }
    productsFetcher.submit(formData, { method: "post" });
  };

  if (!reel) {
    return (
      <s-page heading="Reel detail — error">
        <s-section>
          <form method="get" action="/app/reels" style={{ margin: 0 }}>
            <button
              type="submit"
              style={{ all: "unset", cursor: "pointer", color: "#2c6ecb", textDecoration: "underline" }}
            >
              Back to reels
            </button>
          </form>
        </s-section>
        <s-section heading="Something went wrong loading this reel">
          <s-paragraph tone="critical">{loaderError}</s-paragraph>
        </s-section>
      </s-page>
    );
  }

  const status = deriveReelStatus(reel.config);
  const statusTone =
    status === "ready"
      ? "success"
      : status === "failed"
        ? "critical"
        : status === "processing"
          ? "info"
          : "neutral";

  return (
    <s-page heading={reel.title}>
      <s-section>
        <form method="get" action="/app/reels" style={{ margin: 0 }}>
          <PreserveSearchParams />
          <button
            type="submit"
            style={{
              all: "unset",
              cursor: "pointer",
              color: "#2c6ecb",
              textDecoration: "underline",
            }}
          >
            Back to reels
          </button>
        </form>
      </s-section>
      <s-section heading="Preview">
        {reel.config.cloudflareStreamUid ? (
          <iframe
            src={`https://iframe.videodelivery.net/${encodeURIComponent(reel.config.cloudflareStreamUid)}`}
            title={`Preview of ${reel.title}`}
            style={{ border: "none", aspectRatio: "9 / 16", width: "100%", maxWidth: "280px" }}
            allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture"
            allowFullScreen
          ></iframe>
        ) : (
          <s-paragraph>No video uploaded yet.</s-paragraph>
        )}
      </s-section>
      <s-section heading="Details">
        <s-stack gap="base">
          {actionData?.error && (
            <s-paragraph tone="critical">{actionData.error}</s-paragraph>
          )}
          <s-paragraph>
            Status: <s-badge tone={statusTone}>{REEL_STATUS_LABELS[status]}</s-badge>
          </s-paragraph>
          <Form method="post">
            <s-stack gap="base">
              <s-text-field
                label="Title"
                name="title"
                defaultValue={reel.title}
                required
              ></s-text-field>
              <input type="hidden" name="published" value={published ? "true" : ""} />
              <s-checkbox
                label="Published"
                checked={published}
                onChange={(event: { currentTarget: { checked: boolean } }) =>
                  setPublished(event.currentTarget.checked)
                }
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
      <s-section heading="Tagged products">
        <s-stack gap="base">
          {productsFetcher.data?.error && (
            <s-paragraph tone="critical">{productsFetcher.data.error}</s-paragraph>
          )}
          {taggedProducts.length === 0 ? (
            <s-paragraph>No products tagged yet.</s-paragraph>
          ) : (
            <s-stack gap="small">
              {taggedProducts.map((product) => (
                <s-paragraph key={product.id}>{product.title}</s-paragraph>
              ))}
            </s-stack>
          )}
          <s-button
            onClick={handlePickProducts}
            {...(productsFetcher.state !== "idle" ? { loading: true } : {})}
          >
            {taggedProducts.length === 0 ? "Tag products" : "Edit tagged products"}
          </s-button>
        </s-stack>
      </s-section>
      <s-section heading="Danger zone">
        <Form
          method="post"
          onSubmit={(e) => {
            if (!confirm("Delete this reel? This can't be undone.")) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="intent" value="delete" />
          <s-button type="submit" variant="secondary" tone="critical">
            Delete reel
          </s-button>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
