import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { createWidget, listWidgetsForShop } from "../models/widget.server";
import type { WidgetKind } from "../models/widget.server";
import type { Widget } from "@prisma/client";

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

function openStandalone(href: string) {
  window.open(window.location.origin + href + window.location.search, "_blank");
}

function WidgetCard({ widget }: { widget: Widget }) {
  const href = `/app/widgets/${encodeURIComponent(widget.id)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.preventDefault();
        openStandalone(href);
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
      <div style={{ fontWeight: 600, marginBottom: "6px" }}>{widget.name}</div>
      <div style={{ color: "#6b6b6b", marginBottom: "8px" }}>{widget.type}</div>
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: "999px",
          fontSize: "12px",
          fontWeight: 500,
          background: widget.published ? "#d1f7dc" : "#e5e5e5",
          color: widget.published ? "#0a6640" : "#444444",
        }}
      >
        {widget.published ? "Published" : "Draft"}
      </span>
    </a>
  );
}

export default function Widgets() {
  const { widgets } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const publishedCount = widgets.filter((w) => w.published).length;

  return (
    <s-page heading="Widgets">
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-box padding="base" background="subdued" borderRadius="base" minInlineSize="140px">
            <s-stack gap="small-200">
              <s-text color="subdued">Total widgets</s-text>
              <s-heading>{widgets.length}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" background="subdued" borderRadius="base" minInlineSize="140px">
            <s-stack gap="small-200">
              <s-text color="subdued">Published</s-text>
              <s-heading>{publishedCount}</s-heading>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
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
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: "12px",
            }}
          >
            {widgets.map((widget) => (
              <WidgetCard key={widget.id} widget={widget} />
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
