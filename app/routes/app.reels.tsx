import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { deleteReel, generateReelHandle, listReels, upsertReel } from "../models/reel.server";
import { createDirectUploadUrl } from "../models/cloudflare-stream.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const reels = await listReels(admin, 50);
  return { reels };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "start-upload") {
    const title = String(formData.get("uploadTitle") ?? "").trim();
    if (!title) {
      return { error: "Title is required", uploadURL: null };
    }

    try {
      const reel = await upsertReel(admin, generateReelHandle(title), title, false, {
        productIds: [],
        interactions: {},
        source: { type: "upload" },
      });

      try {
        const { uploadURL } = await createDirectUploadUrl(
          {
            accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
            apiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
          },
          3600,
          { reelId: reel.id, shop: session.shop },
        );

        return { error: null, uploadURL };
      } catch {
        try {
          await deleteReel(admin, reel.id);
        } catch {
          // best-effort cleanup; the original error below is what the merchant sees
        }
        return {
          error: "Could not start upload. Check Cloudflare configuration.",
          uploadURL: null,
        };
      }
    } catch {
      return {
        error: "Could not start upload. Check Cloudflare configuration.",
        uploadURL: null,
      };
    }
  }

  const title = String(formData.get("title") ?? "").trim();
  const published = formData.get("published") != null;

  if (!title) {
    return { error: "Title is required", uploadURL: null };
  }

  await upsertReel(admin, generateReelHandle(title), title, published, {
    productIds: [],
    interactions: {},
    source: { type: "upload" },
  });

  return { error: null, uploadURL: null };
};

function UploadVideoForm() {
  const fetcher = useFetcher<typeof action>();
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "done" | "error"
  >("idle");
  const armedRef = useRef(false);

  useEffect(() => {
    if (armedRef.current && fetcher.data?.uploadURL && file) {
      armedRef.current = false;
      setUploadStatus("uploading");
      const body = new FormData();
      body.append("file", file);
      fetch(fetcher.data.uploadURL, { method: "POST", body })
        .then((res) => {
          setUploadStatus(res.ok ? "done" : "error");
        })
        .catch(() => setUploadStatus("error"));
    }
  }, [fetcher.data, file]);

  return (
    <s-section heading="Upload a video">
      <fetcher.Form
        method="post"
        onSubmit={(e) => {
          if (!file) {
            e.preventDefault();
            setUploadStatus("error");
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
        </s-stack>
      </fetcher.Form>
    </s-section>
  );
}

export default function ReelsLibrary() {
  const { reels } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <s-page heading="Reels library">
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
          <s-table variant="list">
            <s-table-header-row>
              <s-table-header listSlot="primary">Title</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {reels.map((reel) => (
                <s-table-row key={reel.id}>
                  <s-table-cell>{reel.title}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={reel.published ? "success" : "neutral"}>
                      {reel.published ? "Published" : "Draft"}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
