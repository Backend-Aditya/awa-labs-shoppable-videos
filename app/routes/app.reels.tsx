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
  listReels,
  updateReelConfig,
  upsertReel,
} from "../models/reel.server";
import type { Reel } from "../models/reel.server";
import { deriveReelStatus } from "../models/reel-status";
import { createDirectUploadUrl, getCloudflareConfig } from "../models/cloudflare-stream.server";
import prisma from "../db.server";

// Route param is the trailing numeric id only — a raw GID (gid://shopify/Metaobject/123)
// contains ':' and '/' characters that break single-segment routing/URLs.
function reelNumericId(reel: Reel): string {
  return reel.id.split("/").pop()!;
}

// Matches s-image's borderRadius="base" token, so the no-poster placeholder
// lines up with real thumbnails instead of drifting from a separate value.
const THUMBNAIL_RADIUS = "8px";

type StatIcon = "video" | "check-circle" | "play-circle" | "hashtag" | "view" | "cursor";

function StatTile({
  label,
  value,
  icon,
  tone,
  accent,
}: {
  label: string;
  value: number;
  icon: StatIcon;
  tone?: "info" | "success";
  accent?: boolean;
}) {
  return (
    <s-box
      padding="base"
      background={accent ? "base" : "subdued"}
      border={accent ? "base" : undefined}
      borderColor={accent ? "strong" : undefined}
      borderRadius="base"
    >
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-icon type={icon} tone={tone ?? "neutral"}></s-icon>
          <s-text color="subdued">{label}</s-text>
        </s-stack>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
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
  }

  return { reels, totalAnalytics };
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
    if (!title) {
      return { error: "Title is required", uploadURL: null, reelId: null };
    }

    try {
      const reel = await upsertReel(admin, generateReelHandle(title), title, published, {
        productIds: [],
        interactions: {},
        source: { type: "upload" },
      });

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
        <s-stack gap="base">
          {fetcher.data?.error && (
            <s-paragraph tone="critical">{fetcher.data.error}</s-paragraph>
          )}
          <s-text-field label="Title" name="title" required></s-text-field>
          <input type="hidden" name="published" ref={publishedRef} defaultValue="" key={`published-input-${publishedKey}`} />
          <s-checkbox
            key={`published-checkbox-${publishedKey}`}
            label="Published"
            defaultChecked={false}
            onChange={(event: { currentTarget: { checked: boolean } }) => {
              if (publishedRef.current) {
                publishedRef.current.value = event.currentTarget.checked ? "true" : "";
              }
            }}
          ></s-checkbox>
          <s-drop-zone
            key={dropZoneKey}
            label="Video file"
            accept="video/*"
            accessibilityLabel="Video file"
            onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
          ></s-drop-zone>
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

function ReelCard({ reel, onOpen }: { reel: Reel; onOpen: (reel: Reel) => void }) {
  const status = deriveReelStatus(reel.config);
  const productCount = reel.config.productIds?.length ?? 0;

  return (
    // Opens a popup instead of navigating — full-page navigation inside the
    // embedded admin iframe repeatedly failed to reach the detail route (see
    // git history). A click handler that loads detail data via useFetcher()
    // sidesteps that: fetcher requests go through App Bridge's patched
    // fetch(), which attaches a session-token header, so authenticate.admin()
    // never falls back to needing shop/host params.
    <s-clickable
      padding="base"
      background="subdued"
      borderRadius="base"
      commandFor="reel-detail-modal"
      command="--show"
      onClick={() => onOpen(reel)}
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
            }}
          ></div>
        )}
        <s-text type="strong">{reel.title}</s-text>
        <s-stack direction="inline" gap="small-200">
          <s-badge tone={reel.published ? "success" : "neutral"}>
            {reel.published ? "Published" : "Draft"}
          </s-badge>
          <s-badge tone={statusTone(status)}>{REEL_STATUS_LABELS[status]}</s-badge>
          <s-badge tone={productCount > 0 ? "success" : "neutral"}>
            {productCount > 0 ? `${productCount} tagged` : "Untagged"}
          </s-badge>
        </s-stack>
      </s-stack>
    </s-clickable>
  );
}

type ReelDetailLoaderData = {
  loaderError: string | null;
  reel: Reel | null;
  taggedProducts: { id: string; title: string }[];
  analytics: { views: number; clicks: number };
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
  const detailFetcher = useFetcher<ReelDetailLoaderData>();
  const editFetcher = useFetcher<{ error: string | null }>();
  const productsFetcher = useFetcher<{ error: string | null }>();
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();
  const publishedRef = useRef<HTMLInputElement>(null);
  // This modal instance is shared across every reel — detailFetcher.data
  // doesn't clear when href changes, it keeps the PREVIOUS reel's data until
  // the new load resolves. Without this gate, opening reel B right after
  // editing reel A briefly renders reel A's published/title/products under
  // reel B's heading (the checkbox in particular looked "stuck" from the
  // last reel touched). pendingHrefRef records which href is in flight;
  // resolvedHref is only set once that load actually completes, so `data`
  // below is exposed only when it truly belongs to the current href.
  const pendingHrefRef = useRef<string | null>(null);
  const [resolvedHref, setResolvedHref] = useState<string | null>(null);

  useEffect(() => {
    if (href) {
      pendingHrefRef.current = href;
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href]);

  useEffect(() => {
    if (detailFetcher.state === "idle" && detailFetcher.data) {
      setResolvedHref(pendingHrefRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailFetcher.state, detailFetcher.data]);

  useEffect(() => {
    if (href && editFetcher.state === "idle" && editFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editFetcher.state, editFetcher.data]);

  useEffect(() => {
    if (href && productsFetcher.state === "idle" && productsFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productsFetcher.state, productsFetcher.data]);

  const handlePickProducts = async () => {
    if (!href) return;
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: (detailFetcher.data?.taggedProducts ?? []).map((p) => ({ id: p.id })),
    });
    if (!selected) return;

    const formData = new FormData();
    formData.set("intent", "set-products");
    for (const product of selected) {
      formData.append("productId", product.id);
    }
    productsFetcher.submit(formData, { method: "post", action: href });
  };

  const data = resolvedHref === href ? detailFetcher.data : undefined;
  const detailReel = data?.reel ?? null;
  const status = detailReel ? deriveReelStatus(detailReel.config) : null;

  return (
    <s-modal id="reel-detail-modal" heading={reel?.title ?? "Reel"} accessibilityLabel={reel?.title ?? "Reel"} onHide={onClose}>
      {!data ? (
        <s-paragraph>Loading…</s-paragraph>
      ) : data.loaderError ? (
        <s-paragraph tone="critical">{data.loaderError}</s-paragraph>
      ) : detailReel ? (
        <s-stack gap="large">
          <s-stack gap="small-200" alignItems="center">
            {detailReel.config.cloudflareStreamUid ? (
              <iframe
                src={`https://iframe.videodelivery.net/${encodeURIComponent(detailReel.config.cloudflareStreamUid)}`}
                title={`Preview of ${detailReel.title}`}
                style={{
                  border: "none",
                  borderRadius: "8px",
                  aspectRatio: "9 / 16",
                  width: "100%",
                  maxWidth: "220px",
                }}
                allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture"
                allowFullScreen
              ></iframe>
            ) : (
              <s-box padding="large" background="subdued" borderRadius="base" inlineSize="100%">
                <s-paragraph>No video uploaded yet.</s-paragraph>
              </s-box>
            )}
            <s-stack direction="inline" gap="small-200">
              <s-badge tone={detailReel.published ? "success" : "neutral"}>
                {detailReel.published ? "Published" : "Draft"}
              </s-badge>
              <s-badge tone={statusTone(status)}>{status ? REEL_STATUS_LABELS[status] : ""}</s-badge>
            </s-stack>
          </s-stack>

          <s-divider></s-divider>

          <s-stack gap="small-200">
            <s-heading>Analytics</s-heading>
            <s-grid gridTemplateColumns="repeat(2, 1fr)" gap="small-200">
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small-200">
                  <s-text color="subdued">Views</s-text>
                  <s-heading>{data.analytics?.views || 0}</s-heading>
                </s-stack>
              </s-box>
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small-200">
                  <s-text color="subdued">Product clicks</s-text>
                  <s-heading>{data.analytics?.clicks || 0}</s-heading>
                </s-stack>
              </s-box>
            </s-grid>
          </s-stack>

          <s-divider></s-divider>

          <s-stack gap="base">
            <s-heading>Details</s-heading>
            {editFetcher.data?.error && (
              <s-paragraph tone="critical">{editFetcher.data.error}</s-paragraph>
            )}
            <editFetcher.Form method="post" action={href ?? undefined}>
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
                  onChange={(event: { currentTarget: { checked: boolean } }) => {
                    if (publishedRef.current) {
                      publishedRef.current.value = event.currentTarget.checked ? "true" : "";
                    }
                  }}
                ></s-checkbox>
                <s-button type="submit" variant="primary" loading={editFetcher.state !== "idle"}>
                  Save
                </s-button>
              </s-stack>
            </editFetcher.Form>
          </s-stack>

          <s-divider></s-divider>

          <s-stack gap="base">
            <s-heading>Tagged products</s-heading>
            {productsFetcher.data?.error && (
              <s-paragraph tone="critical">{productsFetcher.data.error}</s-paragraph>
            )}
            {data.taggedProducts.length === 0 ? (
              <s-paragraph>No products tagged yet.</s-paragraph>
            ) : (
              <s-stack gap="small-200">
                {data.taggedProducts.map((product) => (
                  <s-paragraph key={product.id}>{product.title}</s-paragraph>
                ))}
              </s-stack>
            )}
            <s-button
              variant="secondary"
              onClick={handlePickProducts}
              loading={productsFetcher.state !== "idle"}
            >
              {data.taggedProducts.length === 0 ? "Tag products" : "Edit tagged products"}
            </s-button>
          </s-stack>

          <s-divider></s-divider>

          <s-stack gap="base">
            <s-heading>Danger zone</s-heading>
            <deleteFetcher.Form
              method="post"
              action={href ?? undefined}
              onSubmit={(e) => {
                // Don't call onClose() here — it sets selectedReelId to null
                // synchronously, which can flip href to null before/while the
                // fetcher reads this form's action, sending the delete POST
                // for the wrong (or no) id and 404ing (confirmed live on the
                // equivalent widgets modal). The modal closes naturally once
                // the reel disappears from the revalidated list after the
                // delete redirect completes.
                if (!confirm("Delete this reel? This can't be undone.")) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="intent" value="delete" />
              <s-button type="submit" variant="secondary" tone="critical" loading={deleteFetcher.state !== "idle"}>
                Delete reel
              </s-button>
            </deleteFetcher.Form>
          </s-stack>
        </s-stack>
      ) : null}
    </s-modal>
  );
}

export default function ReelsLibrary() {
  const { reels, totalAnalytics } = useLoaderData<typeof loader>();
  const [selectedReelId, setSelectedReelId] = useState<string | null>(null);
  // Re-derived from the live `reels` list (not stored as its own object) so
  // the modal reflects fresh data automatically after the list revalidates.
  const selectedReel = reels.find((r) => r.id === selectedReelId) ?? null;
  const href = selectedReel ? `/app/reels/${reelNumericId(selectedReel)}` : null;

  const publishedCount = reels.filter((r) => r.published).length;
  const readyCount = reels.filter(
    (r) => deriveReelStatus(r.config) === "ready",
  ).length;
  const taggedCount = reels.filter(
    (r) => (r.config.productIds?.length ?? 0) > 0,
  ).length;

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
        <s-grid gridTemplateColumns="repeat(2, 1fr)" gap="base">
          <StatTile label="Total views" value={totalAnalytics.views} icon="view" tone="info" accent />
          <StatTile label="Product clicks" value={totalAnalytics.clicks} icon="cursor" tone="success" accent />
        </s-grid>
      </s-section>

      <s-section heading="All reels">
        {reels.length === 0 ? (
          <s-paragraph>No reels yet. Use Create reel to add your first one.</s-paragraph>
        ) : (
          <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">
            {reels.map((reel) => (
              <ReelCard key={reel.id} reel={reel} onOpen={(r) => setSelectedReelId(r.id)} />
            ))}
          </s-grid>
        )}
      </s-section>

      <CreateReelModal />
      <ReelDetailModal reel={selectedReel} href={href} onClose={() => setSelectedReelId(null)} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
