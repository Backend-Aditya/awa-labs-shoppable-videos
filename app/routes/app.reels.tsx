import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
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

// Route param is the trailing numeric id only — a raw GID (gid://shopify/Metaobject/123)
// contains ':' and '/' characters that break single-segment routing/URLs.
function reelNumericId(reel: Reel): string {
  return reel.id.split("/").pop()!;
}

const REEL_STATUS_LABELS: Record<string, string> = {
  draft: "No video",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const reels = await listReels(admin, 50);
  return { reels };
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
    const title = String(formData.get("uploadTitle") ?? "").trim();
    if (!title) {
      return { error: "Title is required", uploadURL: null, reelId: null };
    }

    try {
      const reel = await upsertReel(admin, generateReelHandle(title), title, false, {
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

  const title = String(formData.get("title") ?? "").trim();
  const published = formData.get("published") != null;

  if (!title) {
    return { error: "Title is required", uploadURL: null, reelId: null };
  }

  await upsertReel(admin, generateReelHandle(title), title, published, {
    productIds: [],
    interactions: {},
    source: { type: "upload" },
  });

  return { error: null, uploadURL: null, reelId: null };
};

function UploadVideoForm() {
  const fetcher = useFetcher<typeof action>();
  const failureFetcher = useFetcher();
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "done" | "error" | "no-file"
  >("idle");
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

  return (
    <s-section heading="Upload a video">
      <fetcher.Form
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
          <s-text-field label="Title" name="uploadTitle" required></s-text-field>
          <input
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <s-button
            type="submit"
            variant="primary"
            {...(fetcher.state !== "idle" ? { loading: true } : {})}
          >
            Start upload
          </s-button>
          {uploadStatus === "uploading" && (
            <s-paragraph>Uploading to Cloudflare…</s-paragraph>
          )}
          {uploadStatus === "done" && (
            <s-paragraph tone="success">
              Upload complete — processing will finish shortly.
            </s-paragraph>
          )}
          {uploadStatus === "error" && (
            <s-paragraph tone="critical">Upload failed. Try again.</s-paragraph>
          )}
          {uploadStatus === "no-file" && (
            <s-paragraph tone="critical">Choose a video file first.</s-paragraph>
          )}
        </s-stack>
      </fetcher.Form>
    </s-section>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <s-box
      padding="base"
      background="subdued"
      borderRadius="base"
      minInlineSize="140px"
    >
      <s-stack gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}

const TONE_COLORS: Record<string, { bg: string; fg: string }> = {
  success: { bg: "#d1f7dc", fg: "#0a6640" },
  critical: { bg: "#fde4e1", fg: "#a3200e" },
  info: { bg: "#d3ecfa", fg: "#0a4a6e" },
  neutral: { bg: "#e5e5e5", fg: "#444444" },
};

function PlainBadge({ tone, children }: { tone: string; children: React.ReactNode }) {
  const colors = TONE_COLORS[tone] ?? TONE_COLORS.neutral;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 500,
        background: colors.bg,
        color: colors.fg,
      }}
    >
      {children}
    </span>
  );
}

function ReelCard({ reel, onOpen }: { reel: Reel; onOpen: (reel: Reel) => void }) {
  const status = deriveReelStatus(reel.config);
  const statusTone =
    status === "ready"
      ? "success"
      : status === "failed"
        ? "critical"
        : status === "processing"
          ? "info"
          : "neutral";
  const productCount = reel.config.productIds?.length ?? 0;

  return (
    // Opens a popup instead of navigating — full-page navigation inside the
    // embedded admin iframe repeatedly failed to reach the detail route (see
    // git history). A click handler that shows an <s-modal> and loads detail
    // data via useFetcher() sidesteps that: fetcher requests go through
    // App Bridge's patched fetch(), which attaches a session-token header,
    // so authenticate.admin() never falls back to needing shop/host params.
    <button
      type="button"
      onClick={() => onOpen(reel)}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "block",
        width: "100%",
        boxSizing: "border-box",
        textAlign: "left",
        color: "inherit",
        border: "1px solid #d9d9d9",
        borderRadius: "8px",
        padding: "12px",
        background: "#ffffff",
      }}
    >
      <div
        style={{
          background: "#f1f1f1",
          borderRadius: "6px",
          height: "140px",
          width: "100%",
          overflow: "hidden",
          marginBottom: "8px",
        }}
      >
        {reel.config.posterUrl ? (
          <img
            src={reel.config.posterUrl}
            alt={reel.title}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : null}
      </div>
      <div style={{ fontWeight: 600, marginBottom: "8px" }}>{reel.title}</div>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "6px" }}>
        <PlainBadge tone={reel.published ? "success" : "neutral"}>
          {reel.published ? "Published" : "Draft"}
        </PlainBadge>
        <PlainBadge tone={statusTone}>{REEL_STATUS_LABELS[status]}</PlainBadge>
      </div>
      <PlainBadge tone={productCount > 0 ? "success" : "neutral"}>
        {productCount > 0 ? `${productCount} tagged` : "Untagged"}
      </PlainBadge>
    </button>
  );
}

const MODAL_ID = "reel-detail-modal";

type ReelDetailLoaderData = {
  loaderError: string | null;
  reel: Reel | null;
  taggedProducts: { id: string; title: string }[];
};

function ReelDetailModal({
  reel,
  onClose,
}: {
  reel: Reel | null;
  onClose: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modalRef = useRef<any>(null);
  const detailFetcher = useFetcher<ReelDetailLoaderData>();
  const editFetcher = useFetcher<{ error: string | null }>();
  const productsFetcher = useFetcher<{ error: string | null }>();
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();
  const href = reel ? `/app/reels/${reelNumericId(reel)}` : null;

  useEffect(() => {
    if (href) {
      modalRef.current?.showOverlay();
      detailFetcher.load(href);
    } else {
      modalRef.current?.hideOverlay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href]);

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

  const data = detailFetcher.data;
  const detailReel = data?.reel ?? null;
  const status = detailReel ? deriveReelStatus(detailReel.config) : null;
  const statusTone =
    status === "ready"
      ? "success"
      : status === "failed"
        ? "critical"
        : status === "processing"
          ? "info"
          : "neutral";

  return (
    <s-modal id={MODAL_ID} heading={reel?.title ?? "Reel"} ref={modalRef} onHide={onClose}>
      {!data ? (
        <s-paragraph>Loading…</s-paragraph>
      ) : data.loaderError ? (
        <s-paragraph tone="critical">{data.loaderError}</s-paragraph>
      ) : detailReel ? (
        <s-stack gap="base">
          {detailReel.config.cloudflareStreamUid ? (
            <iframe
              src={`https://iframe.videodelivery.net/${encodeURIComponent(detailReel.config.cloudflareStreamUid)}`}
              title={`Preview of ${detailReel.title}`}
              style={{ border: "none", aspectRatio: "9 / 16", width: "100%", maxWidth: "220px" }}
              allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture"
              allowFullScreen
            ></iframe>
          ) : (
            <s-paragraph>No video uploaded yet.</s-paragraph>
          )}
          <s-paragraph>
            Status: <s-badge tone={statusTone}>{status ? REEL_STATUS_LABELS[status] : ""}</s-badge>
          </s-paragraph>

          {editFetcher.data?.error && (
            <s-paragraph tone="critical">{editFetcher.data.error}</s-paragraph>
          )}
          <editFetcher.Form method="post" action={href!}>
            <s-stack gap="base">
              <s-text-field
                label="Title"
                name="title"
                defaultValue={detailReel.title}
                required
              ></s-text-field>
              <s-checkbox
                label="Published"
                name="published"
                defaultChecked={detailReel.published}
              ></s-checkbox>
              <s-button
                type="submit"
                variant="primary"
                {...(editFetcher.state !== "idle" ? { loading: true } : {})}
              >
                Save
              </s-button>
            </s-stack>
          </editFetcher.Form>

          <s-stack gap="base">
            {productsFetcher.data?.error && (
              <s-paragraph tone="critical">{productsFetcher.data.error}</s-paragraph>
            )}
            {data.taggedProducts.length === 0 ? (
              <s-paragraph>No products tagged yet.</s-paragraph>
            ) : (
              <s-stack gap="small">
                {data.taggedProducts.map((product) => (
                  <s-paragraph key={product.id}>{product.title}</s-paragraph>
                ))}
              </s-stack>
            )}
            <s-button
              onClick={handlePickProducts}
              {...(productsFetcher.state !== "idle" ? { loading: true } : {})}
            >
              {data.taggedProducts.length === 0 ? "Tag products" : "Edit tagged products"}
            </s-button>
          </s-stack>

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
            <s-button
              type="submit"
              variant="secondary"
              tone="critical"
              {...(deleteFetcher.state !== "idle" ? { loading: true } : {})}
            >
              Delete reel
            </s-button>
          </deleteFetcher.Form>
        </s-stack>
      ) : null}
    </s-modal>
  );
}

export default function ReelsLibrary() {
  const { reels } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [selectedReelId, setSelectedReelId] = useState<string | null>(null);
  // Re-derived from the live `reels` list (not stored as its own object) so
  // the modal reflects fresh data automatically after the list revalidates.
  const selectedReel = reels.find((r) => r.id === selectedReelId) ?? null;

  const publishedCount = reels.filter((r) => r.published).length;
  const readyCount = reels.filter(
    (r) => deriveReelStatus(r.config) === "ready",
  ).length;
  const taggedCount = reels.filter(
    (r) => (r.config.productIds?.length ?? 0) > 0,
  ).length;

  return (
    <s-page heading="Reels library">
      <s-section>
        <s-stack direction="inline" gap="base">
          <StatTile label="Total reels" value={reels.length} />
          <StatTile label="Published" value={publishedCount} />
          <StatTile label="Ready to play" value={readyCount} />
          <StatTile label="Tagged to products" value={taggedCount} />
        </s-stack>
      </s-section>
      <s-section heading="Create a reel">
        {actionData?.error && (
          <s-paragraph tone="critical">{actionData.error}</s-paragraph>
        )}
        <Form method="post">
          <s-stack gap="base">
            <s-text-field label="Title" name="title" required></s-text-field>
            <s-checkbox label="Published" name="published"></s-checkbox>
            <s-button
              type="submit"
              variant="primary"
              {...(isSubmitting ? { loading: true } : {})}
            >
              Create reel
            </s-button>
          </s-stack>
        </Form>
      </s-section>
      <UploadVideoForm />
      <s-section heading="All reels">
        {reels.length === 0 ? (
          <s-paragraph>No reels yet. Create your first one above.</s-paragraph>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: "12px",
            }}
          >
            {reels.map((reel) => (
              <ReelCard key={reel.id} reel={reel} onOpen={(r) => setSelectedReelId(r.id)} />
            ))}
          </div>
        )}
      </s-section>
      <ReelDetailModal reel={selectedReel} onClose={() => setSelectedReelId(null)} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
