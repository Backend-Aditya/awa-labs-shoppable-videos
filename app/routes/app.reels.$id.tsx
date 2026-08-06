import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, redirect, useFetcher, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { deleteReel, deriveReelStatus, getProductsByIds, getReel, updateReelConfig, upsertReel } from "../models/reel.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const reel = await getReel(admin, params.id!);
  if (!reel) {
    throw new Response("Reel not found", { status: 404 });
  }
  const taggedProducts = await getProductsByIds(admin, reel.config.productIds);
  return { reel, taggedProducts };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const reel = await getReel(admin, params.id!);
  if (!reel) {
    throw new Response("Reel not found", { status: 404 });
  }

  if (intent === "set-products") {
    const productIds = formData.getAll("productId").map(String);
    await updateReelConfig(admin, reel.id, { productIds });
    return { error: null };
  }

  if (intent === "delete") {
    await deleteReel(admin, reel.id);
    return redirect("/app/reels");
  }

  const title = String(formData.get("title") ?? "").trim();
  const published = formData.get("published") != null;

  if (!title) {
    return { error: "Title is required" };
  }

  await upsertReel(admin, reel.handle, title, published, reel.config);
  return { error: null };
};

export default function ReelDetail() {
  const { reel, taggedProducts } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const status = deriveReelStatus(reel.config);
  const statusTone =
    status === "ready"
      ? "success"
      : status === "failed"
        ? "critical"
        : status === "processing"
          ? "info"
          : "neutral";
  const shopify = useAppBridge();
  const productsFetcher = useFetcher();

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

  return (
    <s-page heading={reel.title}>
      <s-link href="/app/reels">Back to reels</s-link>
      <s-section heading="Details">
        <s-stack gap="base">
          <s-paragraph>
            Status: <s-badge tone={statusTone}>{status}</s-badge>
          </s-paragraph>
          <Form method="post">
            <s-stack gap="base">
              <s-text-field
                label="Title"
                name="title"
                defaultValue={reel.title}
                required
              ></s-text-field>
              <s-checkbox
                label="Published"
                name="published"
                defaultChecked={reel.published}
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
