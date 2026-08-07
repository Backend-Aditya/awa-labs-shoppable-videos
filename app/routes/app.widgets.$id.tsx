import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { deleteWidget, getWidget, updateWidget } from "../models/widget.server";

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
