import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, redirect, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { getOrCreateShop } from "../models/shop.server";
import { deleteWidget, getWidget, updateWidget, updateWidgetTargetRule } from "../models/widget.server";
import type { WidgetConfig } from "../models/widget.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const widget = await getWidget(shop.id, params.id!);
  if (!widget) {
    throw new Response("Widget not found", { status: 404 });
  }
  return { widget };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const widget = await getWidget(shop.id, params.id!);
  if (!widget) {
    throw new Response("Widget not found", { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "set-target") {
    const handles = formData.getAll("productHandle").map(String);
    const targetRule: WidgetConfig["targetRule"] =
      handles.length > 0 ? { type: "handles", handles } : { type: "all_products" };
    await updateWidgetTargetRule(widget.id, targetRule);
    return { error: null };
  }

  if (intent === "clear-target") {
    await updateWidgetTargetRule(widget.id, { type: "all_products" });
    return { error: null };
  }

  if (intent === "delete") {
    await deleteWidget(widget.id);
    return redirect("/app/widgets");
  }

  const name = String(formData.get("name") ?? "").trim();
  const published = formData.get("published") != null;

  if (!name) {
    return { error: "Name is required" };
  }

  await updateWidget(widget.id, { name, published });
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
    <s-page heading={widget.name}>
      <s-link href="/app/widgets">Back to widgets</s-link>
      <s-section heading="Details">
        <s-stack gap="base">
          {actionData?.error && (
            <s-paragraph tone="critical">{actionData.error}</s-paragraph>
          )}
          <s-paragraph>
            Type: <s-text>{widget.type}</s-text>
          </s-paragraph>
          <Form method="post">
            <s-stack gap="base">
              <s-text-field
                label="Name"
                name="name"
                defaultValue={widget.name}
                required
              ></s-text-field>
              <s-checkbox
                label="Published"
                name="published"
                defaultChecked={widget.published}
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
