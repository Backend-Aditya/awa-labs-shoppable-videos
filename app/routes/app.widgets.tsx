import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { createWidget, listWidgetsForShop } from "../models/widget.server";
import type { WidgetKind } from "../models/widget.server";

const WIDGET_KINDS: WidgetKind[] = [
  "PRODUCT_PAGE_REELS",
  "CAROUSEL",
  "GRID",
  "STORIES",
  "REEL_POPS",
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const widgets = await listWidgetsForShop(shop.id);
  return { widgets };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "");

  if (!name || !WIDGET_KINDS.includes(type as WidgetKind)) {
    return { error: "Name and a valid widget type are required" };
  }

  await createWidget(shop.id, type as WidgetKind, name, {
    templateStyle: "classic",
    targetRule: { type: "all_products" },
  });

  return { error: null };
};

export default function Widgets() {
  const { widgets } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <s-page heading="Widgets">
      <s-section heading="Create a widget">
        {actionData?.error && (
          <s-paragraph tone="critical">{actionData.error}</s-paragraph>
        )}
        <Form method="post">
          <s-stack gap="base">
            <s-text-field label="Name" name="name" required></s-text-field>
            <s-select
              label="Type"
              name="type"
              placeholder="Select a widget type"
              required
            >
              {WIDGET_KINDS.map((kind) => (
                <s-option key={kind} value={kind}>
                  {kind}
                </s-option>
              ))}
            </s-select>
            <s-button
              type="submit"
              variant="primary"
              {...(isSubmitting ? { loading: true } : {})}
            >
              Create widget
            </s-button>
          </s-stack>
        </Form>
      </s-section>
      <s-section heading="All widgets">
        {widgets.length === 0 ? (
          <s-paragraph>No widgets yet. Create your first one above.</s-paragraph>
        ) : (
          <s-table variant="list">
            <s-table-header-row>
              <s-table-header listSlot="primary">Name</s-table-header>
              <s-table-header listSlot="labeled">Type</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {widgets.map((widget) => {
                return (
                <s-table-row key={widget.id}>
                  <s-table-cell>
                    <Link
                      to={`/app/widgets/${encodeURIComponent(widget.id)}`}
                      style={{ color: "inherit", textDecoration: "underline" }}
                    >
                      {widget.name}
                    </Link>
                  </s-table-cell>
                  <s-table-cell>{widget.type}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={widget.published ? "success" : "neutral"}>
                      {widget.published ? "Published" : "Draft"}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
                );
              })}
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
