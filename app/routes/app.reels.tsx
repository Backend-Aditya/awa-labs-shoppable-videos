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
import { PageShell } from "../components/ui/PageShell";
import { StatTile } from "../components/ui/StatTile";
import { CARD_INTERACTIVE_CLASSES } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { Checkbox } from "../components/ui/Checkbox";
import { Modal, type ModalHandle } from "../components/ui/Modal";

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

function CreateReelModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const modalRef = useRef<ModalHandle>(null);
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (open) {
      modalRef.current?.show();
    } else {
      modalRef.current?.hide();
    }
  }, [open]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return (
    <Modal ref={modalRef} title="Create a reel" onClose={onClose}>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        {fetcher.data?.error && (
          <p className="text-sm text-critical">{fetcher.data.error}</p>
        )}
        <TextField label="Title" name="title" required />
        <Checkbox label="Published" name="published" />
        <div>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            Create reel
          </Button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}

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
    <section>
      <h2 className="mb-3 text-lg font-semibold text-ink">Upload a video</h2>
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
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="intent" value="start-upload" />
        {fetcher.data?.error && (
          <p className="text-sm text-critical">{fetcher.data.error}</p>
        )}
        <TextField label="Title" name="uploadTitle" required />
        <input
          type="file"
          accept="video/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm text-ink file:mr-3 file:rounded-md file:border file:border-border file:bg-bg file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-surface"
        />
        <div>
          <Button type="submit" variant="primary" loading={fetcher.state !== "idle"}>
            Start upload
          </Button>
        </div>
        {uploadStatus === "uploading" && (
          <p className="text-sm text-muted">Uploading to Cloudflare…</p>
        )}
        {uploadStatus === "done" && (
          <p className="text-sm text-success">
            Upload complete — processing will finish shortly.
          </p>
        )}
        {uploadStatus === "error" && (
          <p className="text-sm text-critical">Upload failed. Try again.</p>
        )}
        {uploadStatus === "no-file" && (
          <p className="text-sm text-critical">Choose a video file first.</p>
        )}
      </fetcher.Form>
    </section>
  );
}

function statusTone(status: string | null): "success" | "critical" | "info" | "neutral" {
  return status === "ready"
    ? "success"
    : status === "failed"
      ? "critical"
      : status === "processing"
        ? "info"
        : "neutral";
}

function ReelCard({ reel, onOpen }: { reel: Reel; onOpen: (reel: Reel) => void }) {
  const status = deriveReelStatus(reel.config);
  const productCount = reel.config.productIds?.length ?? 0;

  return (
    // Opens a popup instead of navigating — full-page navigation inside the
    // embedded admin iframe repeatedly failed to reach the detail route (see
    // git history). A click handler that shows a Modal and loads detail data
    // via useFetcher() sidesteps that: fetcher requests go through App
    // Bridge's patched fetch(), which attaches a session-token header, so
    // authenticate.admin() never falls back to needing shop/host params.
    <button
      type="button"
      onClick={() => onOpen(reel)}
      className={`block w-full ${CARD_INTERACTIVE_CLASSES}`}
    >
      <div className="mb-2 h-[180px] w-full overflow-hidden rounded-md bg-surface">
        {reel.config.posterUrl ? (
          <img
            src={reel.config.posterUrl}
            alt={reel.title}
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>
      <div className="mb-2 font-semibold text-ink">{reel.title}</div>
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        <Badge tone={reel.published ? "success" : "neutral"}>
          {reel.published ? "Published" : "Draft"}
        </Badge>
        <Badge tone={statusTone(status)}>{REEL_STATUS_LABELS[status]}</Badge>
      </div>
      <Badge tone={productCount > 0 ? "success" : "neutral"}>
        {productCount > 0 ? `${productCount} tagged` : "Untagged"}
      </Badge>
    </button>
  );
}

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
  const modalRef = useRef<ModalHandle>(null);
  const detailFetcher = useFetcher<ReelDetailLoaderData>();
  const editFetcher = useFetcher<{ error: string | null }>();
  const productsFetcher = useFetcher<{ error: string | null }>();
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();
  const href = reel ? `/app/reels/${reelNumericId(reel)}` : null;

  useEffect(() => {
    if (href) {
      modalRef.current?.show();
      detailFetcher.load(href);
    } else {
      modalRef.current?.hide();
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

  return (
    <Modal ref={modalRef} title={reel?.title ?? "Reel"} onClose={onClose}>
      {!data ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : data.loaderError ? (
        <p className="text-sm text-critical">{data.loaderError}</p>
      ) : detailReel ? (
        <div className="flex flex-col">
          <div className="flex flex-col gap-4 pb-6">
            {detailReel.config.cloudflareStreamUid ? (
              <iframe
                src={`https://iframe.videodelivery.net/${encodeURIComponent(detailReel.config.cloudflareStreamUid)}`}
                title={`Preview of ${detailReel.title}`}
                className="aspect-[9/16] w-full max-w-[220px] border-0"
                allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture"
                allowFullScreen
              ></iframe>
            ) : (
              <p className="text-sm text-muted">No video uploaded yet.</p>
            )}
            <p className="flex items-center gap-2 text-sm text-ink">
              Status:{" "}
              <Badge tone={statusTone(status)}>{status ? REEL_STATUS_LABELS[status] : ""}</Badge>
            </p>
          </div>

          <div className="flex flex-col gap-4 border-t border-border py-6">
            {editFetcher.data?.error && (
              <p className="text-sm text-critical">{editFetcher.data.error}</p>
            )}
            <editFetcher.Form method="post" action={href!} className="flex flex-col gap-4">
              <TextField label="Title" name="title" defaultValue={detailReel.title} required />
              <Checkbox label="Published" name="published" defaultChecked={detailReel.published} />
              <div>
                <Button type="submit" variant="primary" loading={editFetcher.state !== "idle"}>
                  Save
                </Button>
              </div>
            </editFetcher.Form>
          </div>

          <div className="flex flex-col gap-3 border-t border-border py-6">
            {productsFetcher.data?.error && (
              <p className="text-sm text-critical">{productsFetcher.data.error}</p>
            )}
            {data.taggedProducts.length === 0 ? (
              <p className="text-sm text-muted">No products tagged yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {data.taggedProducts.map((product) => (
                  <p key={product.id} className="text-sm text-ink">
                    {product.title}
                  </p>
                ))}
              </div>
            )}
            <div>
              <Button
                variant="secondary"
                onClick={handlePickProducts}
                loading={productsFetcher.state !== "idle"}
              >
                {data.taggedProducts.length === 0 ? "Tag products" : "Edit tagged products"}
              </Button>
            </div>
          </div>

          <div className="border-t border-border pt-6">
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
              <Button type="submit" variant="critical" loading={deleteFetcher.state !== "idle"}>
                Delete reel
              </Button>
            </deleteFetcher.Form>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export default function ReelsLibrary() {
  const { reels } = useLoaderData<typeof loader>();
  const [selectedReelId, setSelectedReelId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
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
    <PageShell
      heading="Reels library"
      description="Upload videos, tag products, and manage what's ready to publish."
      actions={
        <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
          Create reel
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Total reels" value={reels.length} />
        <StatTile label="Published" value={publishedCount} />
        <StatTile label="Ready to play" value={readyCount} />
        <StatTile label="Tagged to products" value={taggedCount} />
      </div>

      <UploadVideoForm />

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">All reels</h2>
        {reels.length === 0 ? (
          <p className="text-sm text-muted">No reels yet. Use Create reel to add your first one.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {reels.map((reel) => (
              <ReelCard key={reel.id} reel={reel} onOpen={(r) => setSelectedReelId(r.id)} />
            ))}
          </div>
        )}
      </section>

      <CreateReelModal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <ReelDetailModal reel={selectedReel} onClose={() => setSelectedReelId(null)} />
    </PageShell>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
