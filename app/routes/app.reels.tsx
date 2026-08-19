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
    const title = String(formData.get("title") ?? "").trim();
    const published = formData.get("published") != null;
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
      onHide={() => {
        setFile(null);
        setUploadStatus("idle");
      }}
    >
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
          <s-text-field label="Title" name="title" required></s-text-field>
          <s-checkbox label="Published" name="published"></s-checkbox>
          <s-drop-zone
            label="Video file"
            name="file"
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
        <s-button slot="primary-action" variant="primary" type="submit" loading={isSubmitting}>
          Create reel
        </s-button>
        <s-button slot="secondary-actions" commandFor="create-reel-modal" command="--hide">
          Cancel
        </s-button>
      </fetcher.Form>
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
        {reel.config.posterUrl && (
          <s-image
            src={reel.config.posterUrl}
            alt={reel.title}
            aspectRatio="9/16"
            objectFit="cover"
            loading="lazy"
          ></s-image>
        )}
        <s-text>{reel.title}</s-text>
        <s-stack direction="inline" gap="small-200">
          <s-badge tone={reel.published ? "success" : "neutral"}>
            {reel.published ? "Published" : "Draft"}
          </s-badge>
          <s-badge tone={statusTone(status)}>{REEL_STATUS_LABELS[status]}</s-badge>
        </s-stack>
        <s-badge tone={productCount > 0 ? "success" : "neutral"}>
          {productCount > 0 ? `${productCount} tagged` : "Untagged"}
        </s-badge>
      </s-stack>
    </s-clickable>
  );
}

type ReelDetailLoaderData = {
  loaderError: string | null;
  reel: Reel | null;
  taggedProducts: { id: string; title: string }[];
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

  useEffect(() => {
    if (href) detailFetcher.load(href);
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

  return (
    <s-modal id="reel-detail-modal" heading={reel?.title ?? "Reel"} onHide={onClose}>
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
            Status: <s-badge tone={statusTone(status)}>{status ? REEL_STATUS_LABELS[status] : ""}</s-badge>
          </s-paragraph>

          <s-divider></s-divider>

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
              <s-checkbox
                label="Published"
                name="published"
                defaultChecked={detailReel.published}
              ></s-checkbox>
              <s-button type="submit" variant="primary" loading={editFetcher.state !== "idle"}>
                Save
              </s-button>
            </s-stack>
          </editFetcher.Form>

          <s-divider></s-divider>

          <s-stack gap="base">
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
      ) : null}
    </s-modal>
  );
}

export default function ReelsLibrary() {
  const { reels } = useLoaderData<typeof loader>();
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
      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))" gap="base">
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Total reels</s-text>
              <s-heading>{reels.length}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Published</s-text>
              <s-heading>{publishedCount}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Ready to play</s-text>
              <s-heading>{readyCount}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-200">
              <s-text color="subdued">Tagged to products</s-text>
              <s-heading>{taggedCount}</s-heading>
            </s-stack>
          </s-box>
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
