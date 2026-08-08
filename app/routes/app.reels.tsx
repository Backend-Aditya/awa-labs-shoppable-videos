import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useNavigate, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { deleteReel, generateReelHandle, listReels, updateReelConfig, upsertReel } from "../models/reel.server";
import type { Reel } from "../models/reel.server";
import { deriveReelStatus } from "../models/reel-status";
import { createDirectUploadUrl, getCloudflareConfig } from "../models/cloudflare-stream.server";

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
        const { uploadURL } = await createDirectUploadUrl(
          getCloudflareConfig(),
          3600,
          { reelId: reel.id, shop: session.shop },
        );

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

function ReelCard({ reel }: { reel: Reel }) {
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
  const navigate = useNavigate();
  const href = `/app/reels/${encodeURIComponent(reel.id)}`;

  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        navigate(href);
      }}
      style={{
        textDecoration: "none",
        color: "inherit",
        cursor: "pointer",
        display: "block",
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
    </a>
  );
}

export default function ReelsLibrary() {
  const { reels } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

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
              <ReelCard key={reel.id} reel={reel} />
            ))}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
