import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  deleteReel,
  generateReelHandle,
  getReel,
  listReels,
  syncProductReelMetafields,
  updateReelConfig,
  upsertReel,
} from "../models/reel.server";
import type { Reel, ProductSummary } from "../models/reel.server";
import { TaggedProductRow } from "../components/TaggedProductRow";
import { deriveReelStatus } from "../models/reel-status";
import { createDirectUploadUrl, getCloudflareConfig } from "../models/cloudflare-stream.server";
import { StatTile } from "../components/StatTile";
import { useResourceDetail } from "../components/useResourceDetail";
import { getShopRevenueTotals } from "../models/order-attribution.server";
import type { ShopRevenueTotals } from "../models/order-attribution.server";
import prisma from "../db.server";

// Route param is the trailing numeric id only — a raw GID (gid://shopify/Metaobject/123)
// contains ':' and '/' characters that break single-segment routing/URLs.
function reelNumericId(reel: Reel): string {
  return reel.id.split("/").pop()!;
}

// Matches s-image's borderRadius="base" token, so the no-poster placeholder
// lines up with real thumbnails instead of drifting from a separate value.
const THUMBNAIL_RADIUS = "8px";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in the browser's
// local timezone, no offset suffix — new Date(iso) already converts a
// stored UTC ISO string to local time for getHours()/getMinutes(), so this
// just needs to format it, not convert it again.
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatMoney(amount: string, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(
      Number(amount),
    );
  } catch {
    // Intl throws on an unrecognized currency code — fall back to the raw
    // string rather than crashing the page over a display formatting issue.
    return `${amount} ${currencyCode}`;
  }
}

// Multi-currency shops can have more than one entry; joins them rather
// than silently picking one, since summing across currencies would be
// meaningless.
function formatRevenueTotals(totals: { currencyCode: string; revenue: string }[]): string {
  if (totals.length === 0) return "—";
  return totals.map((t) => formatMoney(t.revenue, t.currencyCode)).join(", ");
}

const REEL_STATUS_LABELS: Record<string, string> = {
  draft: "No video",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const reels = await listReels(admin, 50);

  let totalAnalytics = { views: 0, clicks: 0 };
  let revenueTotals: ShopRevenueTotals = { totalOrderCount: 0, totalsByCurrency: [] };
  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (shopRecord) {
    const events = await prisma.reelEvent.groupBy({
      by: ["eventType"],
      where: { shopId: shopRecord.id },
      _count: { eventType: true },
    });
    totalAnalytics = {
      views: events.find((e) => e.eventType === "view")?._count.eventType || 0,
      clicks: events.find((e) => e.eventType === "click_product")?._count.eventType || 0,
    };
    revenueTotals = await getShopRevenueTotals(shopRecord.id);
  }

  return { reels, totalAnalytics, revenueTotals };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "mark-upload-failed") {
    const reelId = String(formData.get("reelId") ?? "");
    if (!reelId) {
      return { error: "Missing reel id", uploadURL: null, reelId: null };
    }
    await updateReelConfig(admin, reelId, {
      uploadFailedAt: new Date().toISOString(),
    });
    return { error: null, uploadURL: null, reelId: null };
  }

  if (intent === "start-upload") {
    const title = String(formData.get("title") ?? "").trim();
    const published = formData.get("published") === "true";
    const productIds = formData.getAll("productId").map(String);
    if (!title) {
      return { error: "Title is required", uploadURL: null, reelId: null };
    }

    try {
      const reel = await upsertReel(admin, generateReelHandle(title), title, published, {
        productIds,
        interactions: {},
        source: { type: "upload" },
      });
      if (productIds.length > 0) {
        await syncProductReelMetafields(admin, reel.id, [], productIds);
      }

      try {
        const { uid, uploadURL } = await createDirectUploadUrl(
          getCloudflareConfig(),
          3600,
          { reelId: reel.id, shop: session.shop },
        );

        // Record the stream uid as soon as it exists, not just when the
        // "ready" webhook fires — that webhook depends on a notificationUrl
        // registered against this app's public URL, which in dev points at
        // a Cloudflare tunnel hostname that rotates on every restart. Without
        // this, an otherwise-successful upload leaves config.cloudflareStreamUid
        // unset forever and the preview never appears, regardless of whether
        // the video actually finished processing.
        await updateReelConfig(admin, reel.id, { cloudflareStreamUid: uid });

        return { error: null, uploadURL, reelId: reel.id };
      } catch {
        try {
          if (productIds.length > 0) {
            // Clear the reel reference these products' metafields now hold
            // before the reel itself is gone — otherwise they'd point at a
            // deleted metaobject.
            await syncProductReelMetafields(admin, reel.id, productIds, []);
          }
          await deleteReel(admin, reel.id);
        } catch {
          // best-effort cleanup; the original error below is what the merchant sees
        }
        return {
          error: "Could not start upload. Check Cloudflare configuration.",
          uploadURL: null,
          reelId: null,
        };
      }
    } catch (e) {
      // The Shopify Admin client throws actual Response objects (not Error) for
      // session-token expiry and rate-limit throttling — this is Shopify's own
      // control-flow mechanism and React Router needs to see it propagate. Do not
      // remove this rethrow or it will swallow real auth failures and mislabel
      // them as Cloudflare configuration errors.
      if (e instanceof Response) throw e;
      return {
        error: "Could not create the reel. Try again.",
        uploadURL: null,
        reelId: null,
      };
    }
  }

  if (intent === "bulk-publish" || intent === "bulk-unpublish") {
    const published = intent === "bulk-publish";
    const reelIds = formData.getAll("reelId").map(String);
    for (const id of reelIds) {
      const reel = await getReel(admin, id);
      if (!reel) continue;
      await upsertReel(admin, reel.handle, reel.title, published, reel.config);
    }
    return { error: null, uploadURL: null, reelId: null };
  }

  if (intent === "bulk-delete") {
    const reelIds = formData.getAll("reelId").map(String);
    for (const id of reelIds) {
      await deleteReel(admin, id);
    }
    return { error: null, uploadURL: null, reelId: null };
  }

  return { error: "Unknown request", uploadURL: null, reelId: null };
};

function statusTone(status: string | null): "success" | "critical" | "info" | "neutral" {
  return status === "ready"
    ? "success"
    : status === "failed"
      ? "critical"
      : status === "processing"
        ? "info"
        : "neutral";
}

function CreateReelModal() {
  const fetcher = useFetcher<typeof action>();
  const failureFetcher = useFetcher();
  const shopify = useAppBridge();
  const formRef = useRef<HTMLFormElement>(null);
  const publishedRef = useRef<HTMLInputElement>(null);
  const [publishedKey, setPublishedKey] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "done" | "error" | "no-file"
  >("idle");
  const [dropZoneKey, setDropZoneKey] = useState(0);
  const [taggedProducts, setTaggedProducts] = useState<
    { id: string; title: string; imageUrl: string | null }[]
  >([]);
  // armedRef gates the upload PUT to fire exactly once per submission. Without
  // it, changing the selected file after a completed/failed upload re-runs this
  // effect and re-fires against the STALE one-time uploadURL from the previous
  // submission — silently uploading the wrong file into the wrong reel's
  // Cloudflare record with no visible error. Do not remove this guard, and do
  // not drop `fetcher.state` from the dependency array (it closes a ~1-3s race
  // during an in-flight submission).
  const armedRef = useRef(false);

  useEffect(() => {
    if (
      armedRef.current &&
      fetcher.state === "idle" &&
      fetcher.data?.uploadURL &&
      file
    ) {
      armedRef.current = false;
      setUploadStatus("uploading");
      const reelId = fetcher.data.reelId;
      const body = new FormData();
      body.append("file", file);
      fetch(fetcher.data.uploadURL, { method: "POST", body })
        .then((res) => {
          setUploadStatus(res.ok ? "done" : "error");
          if (!res.ok && reelId) {
            const failForm = new FormData();
            failForm.set("intent", "mark-upload-failed");
            failForm.set("reelId", reelId);
            failureFetcher.submit(failForm, { method: "post" });
          }
        })
        .catch(() => {
          setUploadStatus("error");
          if (reelId) {
            const failForm = new FormData();
            failForm.set("intent", "mark-upload-failed");
            failForm.set("reelId", reelId);
            failureFetcher.submit(failForm, { method: "post" });
          }
        });
    }
  }, [fetcher.data, file, fetcher.state, failureFetcher]);

  useEffect(() => {
    if (uploadStatus === "done") {
      shopify.modal.hide("create-reel-modal");
    }
  }, [uploadStatus, shopify]);

  const isSubmitting = fetcher.state !== "idle" || uploadStatus === "uploading";

  return (
    <s-modal
      id="create-reel-modal"
      heading="Create a reel"
      accessibilityLabel="Create a reel"
      onHide={() => {
        setFile(null);
        setUploadStatus("idle");
        setDropZoneKey((k) => k + 1);
        setPublishedKey((k) => k + 1);
        setTaggedProducts([]);
      }}
    >
      <fetcher.Form
        id="create-reel-form"
        ref={formRef}
        method="post"
        onSubmit={(e) => {
          if (!file) {
            e.preventDefault();
            setUploadStatus("no-file");
            return;
          }
          armedRef.current = true;
          setUploadStatus("idle");
        }}
      >
        <input type="hidden" name="intent" value="start-upload" />
        <s-stack gap="large">
          {fetcher.data?.error && (
            <s-paragraph tone="critical">{fetcher.data.error}</s-paragraph>
          )}

          <s-stack gap="base">
            <s-text-field label="Title" name="title" required></s-text-field>
            <input type="hidden" name="published" ref={publishedRef} defaultValue="" key={`published-input-${publishedKey}`} />
            <s-checkbox
              key={`published-checkbox-${publishedKey}`}
              label="Published"
              defaultChecked={false}
              onChange={(event: { currentTarget: { checked: boolean } | null }) => {
                if (publishedRef.current && event.currentTarget) {
                  publishedRef.current.value = event.currentTarget.checked ? "true" : "";
                }
              }}
            ></s-checkbox>
          </s-stack>

          <s-divider></s-divider>

          <s-stack gap="small-200">
            <s-heading>Video</s-heading>
            {file ? (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-icon type="play-circle" tone="info"></s-icon>
                  <s-stack gap="small-100">
                    <s-text type="strong">{file.name}</s-text>
                    <s-text color="subdued">{formatBytes(file.size)}</s-text>
                  </s-stack>
                  <s-button
                    type="button"
                    variant="tertiary"
                    tone="critical"
                    onClick={() => {
                      setFile(null);
                      setDropZoneKey((k) => k + 1);
                    }}
                  >
                    Remove
                  </s-button>
                </s-stack>
              </s-box>
            ) : (
              <s-drop-zone
                key={dropZoneKey}
                label="Video file"
                accept="video/*"
                accessibilityLabel="Video file"
                onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
              ></s-drop-zone>
            )}
            {uploadStatus === "uploading" && (
              <s-paragraph>Uploading to Cloudflare…</s-paragraph>
            )}
            {uploadStatus === "error" && (
              <s-paragraph tone="critical">Upload failed. Try again.</s-paragraph>
            )}
            {uploadStatus === "no-file" && (
              <s-paragraph tone="critical">Choose a video file first.</s-paragraph>
            )}
          </s-stack>

          <s-divider></s-divider>

          <s-stack gap="small-200">
            <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
              <s-heading>
                Tag products{taggedProducts.length > 0 ? ` (${taggedProducts.length})` : " (optional)"}
              </s-heading>
              <s-button
                type="button"
                variant="secondary"
                onClick={async () => {
                  const selected = await shopify.resourcePicker({
                    type: "product",
                    multiple: true,
                    selectionIds: taggedProducts.map((p) => ({ id: p.id })),
                  });
                  if (!selected) return;
                  setTaggedProducts(
                    selected.map((p) => ({
                      id: p.id,
                      title: p.title,
                      imageUrl: p.images?.[0]?.originalSrc ?? null,
                    })),
                  );
                }}
              >
                {taggedProducts.length === 0 ? "Choose products" : "Edit"}
              </s-button>
            </s-stack>
            {taggedProducts.length > 0 && (
              <s-box padding="small-200" background="subdued" borderRadius="base">
                <s-stack gap="small-200">
                  {taggedProducts.map((product) => (
                    <TaggedProductRow
                      key={product.id}
                      product={{ ...product, handle: "", priceRange: null }}
                    />
                  ))}
                </s-stack>
              </s-box>
            )}
            {taggedProducts.map((product) => (
              <input key={product.id} type="hidden" name="productId" value={product.id} />
            ))}
          </s-stack>
        </s-stack>
      </fetcher.Form>
      <s-button
        slot="primary-action"
        variant="primary"
        loading={isSubmitting}
        onClick={() => formRef.current?.requestSubmit()}
      >
        Create reel
      </s-button>
      <s-button slot="secondary-actions" commandFor="create-reel-modal" command="--hide">
        Cancel
      </s-button>
    </s-modal>
  );
}

function ReelCard({
  reel,
  onOpen,
  onDeleteClick,
  selectionMode,
  selected,
  onToggleSelect,
}: {
  reel: Reel;
  onOpen: (reel: Reel) => void;
  onDeleteClick: (reel: Reel) => void;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: (reel: Reel) => void;
}) {
  const status = deriveReelStatus(reel.config);
  const productCount = reel.config.productIds?.length ?? 0;

  return (
    // The kebab/checkbox below is a DOM sibling of this s-clickable, not a
    // descendant — nesting an interactive element inside a commandFor-driven
    // clickable risks its click also bubbling into the outer element's own
    // native command handling (opening the detail modal) before React's
    // synthetic stopPropagation can run. Keeping them as siblings, with it
    // absolutely positioned on top, sidesteps that entirely.
    <div style={{ position: "relative" }}>
      {/* Opens a popup instead of navigating — full-page navigation inside the
      embedded admin iframe repeatedly failed to reach the detail route (see
      git history). A click handler that loads detail data via useFetcher()
      sidesteps that: fetcher requests go through App Bridge's patched
      fetch(), which attaches a session-token header, so authenticate.admin()
      never falls back to needing shop/host params.
      In selection mode, clicking toggles the checkbox instead — commandFor
      is omitted entirely rather than left pointing at a modal we don't want
      to open while bulk-selecting. */}
      <s-clickable
        padding="base"
        background={selected ? "strong" : "subdued"}
        border="base"
        borderColor={selected ? "strong" : undefined}
        borderRadius="base"
        onClick={() => (selectionMode ? onToggleSelect(reel) : onOpen(reel))}
        {...(selectionMode ? {} : { commandFor: "reel-detail-modal", command: "--show" })}
      >
      <s-stack gap="small-200">
        {reel.config.posterUrl ? (
          <s-image
            src={reel.config.posterUrl}
            alt={reel.title}
            aspectRatio="9/16"
            objectFit="cover"
            loading="lazy"
            borderRadius="base"
          ></s-image>
        ) : (
          <div
            style={{
              aspectRatio: "9 / 16",
              width: "100%",
              borderRadius: THUMBNAIL_RADIUS,
              background: "var(--p-color-bg-surface-strong, #d9d9d9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <s-icon type="play-circle" tone="neutral"></s-icon>
          </div>
        )}
        <s-text type="strong">{reel.title}</s-text>
        <s-stack direction="inline" gap="small-100">
          <s-badge tone={reel.published ? "success" : reel.config.publishAt ? "info" : "neutral"}>
            {reel.published ? "Published" : reel.config.publishAt ? "Scheduled" : "Draft"}
          </s-badge>
          <s-badge tone={statusTone(status)}>{REEL_STATUS_LABELS[status]}</s-badge>
          <s-badge tone={productCount > 0 ? "success" : "neutral"}>
            {productCount > 0 ? `${productCount} tagged` : "Untagged"}
          </s-badge>
        </s-stack>
      </s-stack>
      </s-clickable>
      {/* Inset to match s-clickable's own padding="base" (16px) so this
          lands right on the poster image's corner, not floating above it
          relative to the card's outer edge. A solid background chip (not
          "tertiary", which is transparent) keeps the icon legible over an
          arbitrary photo. */}
      <div
        style={{
          position: "absolute",
          top: "16px",
          right: "16px",
          borderRadius: "999px",
          boxShadow: "0 1px 4px rgba(0, 0, 0, 0.25)",
          overflow: "hidden",
        }}
      >
        {selectionMode ? (
          <div
            style={{
              background: "white",
              width: "28px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <s-icon
              type={selected ? "check-circle-filled" : "circle"}
              tone={selected ? "info" : "neutral"}
            ></s-icon>
          </div>
        ) : (
          <s-button
            icon="menu-horizontal"
            variant="secondary"
            accessibilityLabel={`More actions for ${reel.title}`}
            commandFor="reel-delete-modal"
            command="--show"
            onClick={() => onDeleteClick(reel)}
          ></s-button>
        )}
      </div>
    </div>
  );
}

type ReelDetailLoaderData = {
  loaderError: string | null;
  reel: Reel | null;
  taggedProducts: ProductSummary[];
  analytics: { views: number; clicks: number };
  revenueStats: { orderCount: number; revenue: string; currencyCode: string | null }[];
};


function ReelDetailModal({
  reel,
  href,
  onClose,
}: {
  reel: Reel | null;
  href: string | null;
  onClose: () => void;
}) {
  const editFetcher = useFetcher<{ error: string | null }>();
  const productsFetcher = useFetcher<{ error: string | null }>();
  const duplicateFetcher = useFetcher();
  const shopify = useAppBridge();
  const publishedRef = useRef<HTMLInputElement>(null);
  const editFormRef = useRef<HTMLFormElement>(null);
  const { data, isLoading } = useResourceDetail<ReelDetailLoaderData>(href, [
    editFetcher,
    productsFetcher,
  ]);

  // The duplicate action redirects to /app/reels (the list we're already
  // on), so the fetcher's own state going back to idle after a submit is
  // the signal it's done — close the modal so the newly-revalidated list
  // (with the new "(copy)" reel in it) is what the merchant sees next.
  const duplicateSubmittedRef = useRef(false);
  useEffect(() => {
    if (duplicateSubmittedRef.current && duplicateFetcher.state === "idle") {
      duplicateSubmittedRef.current = false;
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicateFetcher.state]);

  const handlePickProducts = async () => {
    if (!href) return;
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: (data?.taggedProducts ?? []).map((p) => ({ id: p.id })),
    });
    if (!selected) return;

    const formData = new FormData();
    formData.set("intent", "set-products");
    for (const product of selected) {
      formData.append("productId", product.id);
    }
    productsFetcher.submit(formData, { method: "post", action: href });
  };

  const detailReel = data?.reel ?? null;
  const status = detailReel ? deriveReelStatus(detailReel.config) : null;

  return (
    <s-modal
      id="reel-detail-modal"
      heading={reel?.title ?? "Reel"}
      accessibilityLabel={reel?.title ?? "Reel"}
      size="large"
      onHide={onClose}
    >
      {isLoading || !data ? (
        <s-paragraph>Loading…</s-paragraph>
      ) : data.loaderError ? (
        <s-paragraph tone="critical">{data.loaderError}</s-paragraph>
      ) : detailReel ? (
        <s-stack gap="large">
          <s-grid gridTemplateColumns="minmax(120px, 160px) 1fr" gap="base">
            {detailReel.config.cloudflareStreamUid ? (
              <iframe
                src={`https://iframe.videodelivery.net/${encodeURIComponent(detailReel.config.cloudflareStreamUid)}`}
                title={`Preview of ${detailReel.title}`}
                style={{
                  border: "none",
                  borderRadius: "8px",
                  aspectRatio: "9 / 16",
                  width: "100%",
                }}
                allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture"
                allowFullScreen
              ></iframe>
            ) : (
              <div
                style={{
                  aspectRatio: "9 / 16",
                  width: "100%",
                  borderRadius: "8px",
                  background: "var(--p-color-bg-surface-strong, #d9d9d9)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <s-icon type="play-circle" tone="neutral"></s-icon>
              </div>
            )}

            <s-stack gap="base">
              <s-stack direction="inline" gap="small-100">
                <s-badge tone={detailReel.published ? "success" : detailReel.config.publishAt ? "info" : "neutral"}>
                  {detailReel.published ? "Published" : detailReel.config.publishAt ? "Scheduled" : "Draft"}
                </s-badge>
                <s-badge tone={statusTone(status)}>{status ? REEL_STATUS_LABELS[status] : ""}</s-badge>
              </s-stack>
              <s-grid gridTemplateColumns="repeat(2, 1fr)" gap="small-200">
                <StatTile label="Views" value={data.analytics?.views || 0} icon="view" tone="info" />
                <StatTile label="Product clicks" value={data.analytics?.clicks || 0} icon="cursor" tone="success" />
                <StatTile
                  label="Orders"
                  value={data.revenueStats?.reduce((sum, s) => sum + s.orderCount, 0) ?? 0}
                  icon="order"
                  tone="success"
                />
                <StatTile
                  label="Revenue"
                  value={formatRevenueTotals(
                    (data.revenueStats ?? [])
                      .filter((s): s is { orderCount: number; revenue: string; currencyCode: string } =>
                        s.currencyCode !== null,
                      ),
                  )}
                  icon="money"
                  tone="success"
                />
              </s-grid>
            </s-stack>
          </s-grid>

          <s-divider></s-divider>

          <s-stack gap="base">
            <s-heading>Details</s-heading>
            {editFetcher.data?.error && (
              <s-paragraph tone="critical">{editFetcher.data.error}</s-paragraph>
            )}
            <editFetcher.Form method="post" action={href ?? undefined} ref={editFormRef}>
              <s-stack gap="base">
                <s-text-field
                  label="Title"
                  name="title"
                  defaultValue={detailReel.title}
                  required
                ></s-text-field>
                <input
                  type="hidden"
                  name="published"
                  ref={publishedRef}
                  key={`published-${detailReel.id}`}
                  defaultValue={detailReel.published ? "true" : ""}
                />
                <s-checkbox
                  key={`checkbox-${detailReel.id}`}
                  label="Published"
                  defaultChecked={detailReel.published}
                  onChange={(event: { currentTarget: { checked: boolean } | null }) => {
                    if (publishedRef.current && event.currentTarget) {
                      publishedRef.current.value = event.currentTarget.checked ? "true" : "";
                    }
                  }}
                ></s-checkbox>

                <s-stack gap="small-100">
                  <label htmlFor={`publish-at-${detailReel.id}`}>
                    <s-text>Schedule publish (optional)</s-text>
                  </label>
                  <input
                    id={`publish-at-${detailReel.id}`}
                    type="datetime-local"
                    name="publishAt"
                    key={`publish-at-${detailReel.id}`}
                    defaultValue={
                      detailReel.config.publishAt ? toDatetimeLocalValue(detailReel.config.publishAt) : ""
                    }
                    style={{
                      padding: "8px 10px",
                      borderRadius: "8px",
                      border: "1px solid var(--p-color-border, #c9cccf)",
                      fontSize: "14px",
                      fontFamily: "inherit",
                      width: "100%",
                      boxSizing: "border-box",
                    }}
                  />
                  {detailReel.config.publishAt && !detailReel.published && (
                    <s-text color="subdued">
                      Publishes automatically at the scheduled time — checking &ldquo;Published&rdquo;
                      above instead publishes it immediately and clears the schedule.
                    </s-text>
                  )}
                </s-stack>

                <s-divider></s-divider>

                <s-stack gap="small-100">
                  <s-heading>Video SEO</s-heading>
                  <s-paragraph color="subdued">
                    Used for this video&rsquo;s schema.org metadata on the storefront, for search engines indexing it as video content.
                  </s-paragraph>
                </s-stack>
                <s-text-field
                  key={`seo-title-${detailReel.id}`}
                  label="SEO title"
                  name="seoTitle"
                  defaultValue={detailReel.config.seoTitle ?? ""}
                  placeholder={detailReel.title}
                  maxLength={70}
                ></s-text-field>
                <s-text-area
                  key={`seo-description-${detailReel.id}`}
                  label="SEO description"
                  name="seoDescription"
                  defaultValue={detailReel.config.seoDescription ?? ""}
                  maxLength={160}
                  rows={3}
                ></s-text-area>
              </s-stack>
            </editFetcher.Form>
          </s-stack>

          <s-divider></s-divider>

          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
              <s-heading>
                Tagged products{data.taggedProducts.length > 0 ? ` (${data.taggedProducts.length})` : ""}
              </s-heading>
              <s-button
                variant="secondary"
                onClick={handlePickProducts}
                loading={productsFetcher.state !== "idle"}
              >
                {data.taggedProducts.length === 0 ? "Tag products" : "Edit"}
              </s-button>
            </s-stack>
            {productsFetcher.data?.error && (
              <s-paragraph tone="critical">{productsFetcher.data.error}</s-paragraph>
            )}
            {data.taggedProducts.length === 0 ? (
              <s-paragraph color="subdued">No products tagged yet.</s-paragraph>
            ) : (
              <s-box padding="small-200" background="subdued" borderRadius="base">
                <s-stack gap="small-200">
                  {data.taggedProducts.map((product) => (
                    <TaggedProductRow key={product.id} product={product} />
                  ))}
                </s-stack>
              </s-box>
            )}
          </s-stack>
        </s-stack>
      ) : null}
      {detailReel && (
        <s-button
          slot="primary-action"
          variant="primary"
          loading={editFetcher.state !== "idle"}
          onClick={() => editFormRef.current?.requestSubmit()}
        >
          Save
        </s-button>
      )}
      {detailReel && (
        <s-button
          slot="secondary-actions"
          variant="tertiary"
          loading={duplicateFetcher.state !== "idle"}
          onClick={() => {
            if (!href) return;
            duplicateSubmittedRef.current = true;
            const formData = new FormData();
            formData.set("intent", "duplicate");
            duplicateFetcher.submit(formData, { method: "post", action: href });
          }}
        >
          Duplicate
        </s-button>
      )}
      <s-button slot="secondary-actions" commandFor="reel-detail-modal" command="--hide">
        Close
      </s-button>
    </s-modal>
  );
}

// Small, dedicated confirm-delete modal — separate from the (large) detail
// modal so deleting a reel doesn't require opening its full detail view
// first. Triggered from the kebab button on each ReelCard.
function ReelDeleteModal({
  reel,
  onClose,
}: {
  reel: Reel | null;
  onClose: () => void;
}) {
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();
  const submittedRef = useRef(false);
  const href = reel ? `/app/reels/${reelNumericId(reel)}` : null;

  useEffect(() => {
    if (submittedRef.current && deleteFetcher.state === "idle") {
      submittedRef.current = false;
      shopify.modal.hide("reel-delete-modal");
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteFetcher.state]);

  return (
    <s-modal
      id="reel-delete-modal"
      heading="Delete reel"
      accessibilityLabel="Delete reel"
      onHide={onClose}
    >
      <s-paragraph>
        Delete {reel ? <strong>{reel.title}</strong> : "this reel"}? This can&rsquo;t be undone.
      </s-paragraph>
      <s-button
        slot="primary-action"
        variant="primary"
        tone="critical"
        loading={deleteFetcher.state !== "idle"}
        onClick={() => {
          if (!href) return;
          submittedRef.current = true;
          const formData = new FormData();
          formData.set("intent", "delete");
          deleteFetcher.submit(formData, { method: "post", action: href });
        }}
      >
        Delete reel
      </s-button>
      <s-button slot="secondary-actions" commandFor="reel-delete-modal" command="--hide">
        Cancel
      </s-button>
    </s-modal>
  );
}

// Bulk-delete confirmation — separate from the single-reel ReelDeleteModal
// since it needs its own modal id (both could otherwise be open/targeted
// at once from the same page) and submits a list of ids to the list
// route's own action instead of a per-reel detail route.
function BulkDeleteReelsModal({
  reelIds,
  onDone,
}: {
  reelIds: string[];
  onDone: () => void;
}) {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const submittedRef = useRef(false);

  useEffect(() => {
    if (submittedRef.current && fetcher.state === "idle") {
      submittedRef.current = false;
      shopify.modal.hide("bulk-delete-reels-modal");
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

  return (
    <s-modal
      id="bulk-delete-reels-modal"
      heading="Delete reels"
      accessibilityLabel="Delete reels"
    >
      <s-paragraph>
        Delete {reelIds.length} reel{reelIds.length === 1 ? "" : "s"}? This can&rsquo;t be undone.
      </s-paragraph>
      <s-button
        slot="primary-action"
        variant="primary"
        tone="critical"
        loading={fetcher.state !== "idle"}
        onClick={() => {
          if (reelIds.length === 0) return;
          submittedRef.current = true;
          const formData = new FormData();
          formData.set("intent", "bulk-delete");
          for (const id of reelIds) formData.append("reelId", id);
          fetcher.submit(formData, { method: "post" });
        }}
      >
        Delete {reelIds.length} reel{reelIds.length === 1 ? "" : "s"}
      </s-button>
      <s-button slot="secondary-actions" commandFor="bulk-delete-reels-modal" command="--hide">
        Cancel
      </s-button>
    </s-modal>
  );
}

const REEL_STATUS_FILTER_OPTIONS: { value: "all" | ReturnType<typeof deriveReelStatus>; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "No video" },
  { value: "processing", label: "Processing" },
  { value: "ready", label: "Ready" },
  { value: "failed", label: "Failed" },
];

export default function ReelsLibrary() {
  const { reels, totalAnalytics, revenueTotals } = useLoaderData<typeof loader>();
  const [selectedReelId, setSelectedReelId] = useState<string | null>(null);
  const [reelPendingDelete, setReelPendingDelete] = useState<Reel | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ReturnType<typeof deriveReelStatus>>("all");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const bulkFetcher = useFetcher();
  // Re-derived from the live `reels` list (not stored as its own object) so
  // the modal reflects fresh data automatically after the list revalidates.
  const selectedReel = reels.find((r) => r.id === selectedReelId) ?? null;
  const href = selectedReel ? `/app/reels/${reelNumericId(selectedReel)}` : null;

  const exitBulkMode = () => {
    setBulkMode(false);
    setBulkSelectedIds(new Set());
  };

  const submitBulk = (intent: "bulk-publish" | "bulk-unpublish") => {
    if (bulkSelectedIds.size === 0) return;
    const formData = new FormData();
    formData.set("intent", intent);
    for (const id of bulkSelectedIds) formData.append("reelId", id);
    bulkFetcher.submit(formData, { method: "post" });
    exitBulkMode();
  };

  const publishedCount = reels.filter((r) => r.published).length;
  const readyCount = reels.filter(
    (r) => deriveReelStatus(r.config) === "ready",
  ).length;
  const taggedCount = reels.filter(
    (r) => (r.config.productIds?.length ?? 0) > 0,
  ).length;

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredReels = reels.filter((reel) => {
    if (statusFilter !== "all" && deriveReelStatus(reel.config) !== statusFilter) return false;
    if (normalizedQuery && !reel.title.toLowerCase().includes(normalizedQuery)) return false;
    return true;
  });
  const isFiltered = normalizedQuery !== "" || statusFilter !== "all";

  return (
    <s-page heading="Reels library" inlineSize="large">
      <s-button slot="primary-action" variant="primary" commandFor="create-reel-modal" command="--show">
        Create reel
      </s-button>
      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
          <StatTile label="Total reels" value={reels.length} icon="video" />
          <StatTile label="Published" value={publishedCount} icon="check-circle" />
          <StatTile label="Ready to play" value={readyCount} icon="play-circle" />
          <StatTile label="Tagged to products" value={taggedCount} icon="hashtag" />
        </s-grid>
      </s-section>

      <s-section heading="Performance">
        <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
          <StatTile label="Total views" value={totalAnalytics.views} icon="view" tone="info" accent />
          <StatTile label="Product clicks" value={totalAnalytics.clicks} icon="cursor" tone="success" accent />
          <StatTile label="Orders" value={revenueTotals.totalOrderCount} icon="order" tone="success" accent />
          <StatTile
            label="Revenue"
            value={formatRevenueTotals(revenueTotals.totalsByCurrency)}
            icon="money"
            tone="success"
            accent
          />
        </s-grid>
      </s-section>

      <s-section heading="All reels">
        {reels.length === 0 ? (
          <s-paragraph>No reels yet. Use Create reel to add your first one.</s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
              <s-stack direction="inline" gap="small-200">
                <s-text-field
                  label="Search"
                  labelAccessibilityVisibility="exclusive"
                  placeholder="Search reels by title"
                  value={searchQuery}
                  onChange={(event: { currentTarget: { value: string } | null }) => {
                    if (event.currentTarget) setSearchQuery(event.currentTarget.value);
                  }}
                ></s-text-field>
                <s-select
                  label="Status"
                  labelAccessibilityVisibility="exclusive"
                  value={statusFilter}
                  onChange={(event: { currentTarget: { value: string } | null }) => {
                    if (event.currentTarget) {
                      setStatusFilter(event.currentTarget.value as typeof statusFilter);
                    }
                  }}
                >
                  {REEL_STATUS_FILTER_OPTIONS.map((option) => (
                    <s-option key={option.value} value={option.value}>
                      {option.label}
                    </s-option>
                  ))}
                </s-select>
              </s-stack>
              <s-button
                type="button"
                variant="tertiary"
                onClick={() => (bulkMode ? exitBulkMode() : setBulkMode(true))}
              >
                {bulkMode ? "Cancel selection" : "Select"}
              </s-button>
            </s-stack>

            {bulkMode && (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                  <s-text>{bulkSelectedIds.size} selected</s-text>
                  <s-stack direction="inline" gap="small-200">
                    <s-button
                      type="button"
                      variant="secondary"
                      disabled={bulkSelectedIds.size === 0}
                      loading={bulkFetcher.state !== "idle"}
                      onClick={() => submitBulk("bulk-publish")}
                    >
                      Publish
                    </s-button>
                    <s-button
                      type="button"
                      variant="secondary"
                      disabled={bulkSelectedIds.size === 0}
                      loading={bulkFetcher.state !== "idle"}
                      onClick={() => submitBulk("bulk-unpublish")}
                    >
                      Unpublish
                    </s-button>
                    <s-button
                      type="button"
                      variant="secondary"
                      tone="critical"
                      disabled={bulkSelectedIds.size === 0}
                      commandFor="bulk-delete-reels-modal"
                      command="--show"
                    >
                      Delete
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            )}

            {filteredReels.length === 0 ? (
              <s-stack gap="small-200">
                <s-paragraph color="subdued">No reels match your search.</s-paragraph>
                <s-button
                  type="button"
                  variant="tertiary"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                  }}
                >
                  Clear filters
                </s-button>
              </s-stack>
            ) : (
              <>
                {isFiltered && (
                  <s-text color="subdued">
                    {filteredReels.length} of {reels.length} reels
                  </s-text>
                )}
                <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">
                  {filteredReels.map((reel) => (
                    <ReelCard
                      key={reel.id}
                      reel={reel}
                      onOpen={(r) => setSelectedReelId(r.id)}
                      onDeleteClick={(r) => setReelPendingDelete(r)}
                      selectionMode={bulkMode}
                      selected={bulkSelectedIds.has(reel.id)}
                      onToggleSelect={(r) => {
                        setBulkSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(r.id)) next.delete(r.id);
                          else next.add(r.id);
                          return next;
                        });
                      }}
                    />
                  ))}
                </s-grid>
              </>
            )}
          </s-stack>
        )}
      </s-section>

      <CreateReelModal />
      <ReelDetailModal reel={selectedReel} href={href} onClose={() => setSelectedReelId(null)} />
      <ReelDeleteModal reel={reelPendingDelete} onClose={() => setReelPendingDelete(null)} />
      <BulkDeleteReelsModal reelIds={[...bulkSelectedIds]} onDone={exitBulkMode} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
