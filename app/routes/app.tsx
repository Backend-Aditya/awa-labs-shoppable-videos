import type React from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, isRouteErrorResponse, useLoaderData, useNavigation, useRouteError } from "react-router";
import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import type {} from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

const HOME_LINK = { rel: "home" } as Record<string, string>;

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        {/* rel="home" marks the app's home page (shown via the app name);
            Polaris' types don't declare it, so it's passed through a spread. */}
        <s-link href="/app" {...HOME_LINK}>
          Home
        </s-link>
        <s-link href="/app/reels">Videos</s-link>
        <s-link href="/app/widgets">Widgets</s-link>
        <s-link href="/app/analytics">Analytics</s-link>
        <s-link href="/app/integrations">Integrations</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/pricing">Pricing</s-link>
      </s-app-nav>
      <NavigationLoading />
      <Outlet />
    </AppProvider>
  );
}

// Shows the admin's own top loading bar while a route's data loads, so
// moving between pages never looks frozen.
function NavigationLoading() {
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const busy = navigation.state === "loading";
  useEffect(() => {
    shopify.loading(busy);
  }, [busy, shopify]);
  return null;
}

// Shopify's boundary renders its own auth/redirect responses and rethrows
// everything else, which used to reach React Router's raw crash screen.
// Our own 404s and any unexpected error get a page with a way back instead.
export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <ErrorPage
        title="Not found"
        body={`${typeof error.data === "string" && error.data ? error.data : "This page doesn't exist"}. It may have been deleted.`}
        actions={[
          { label: "Go to videos", href: "/app/reels" },
          { label: "Go to widgets", href: "/app/widgets" },
        ]}
      />
    );
  }

  try {
    return boundary.error(error);
  } catch {
    console.error(error);
    return (
      <ErrorPage
        title="Something went wrong"
        body="We couldn't load this page. This is usually a brief connection problem with Shopify. Try again in a moment."
        actions={[
          { label: "Try again", onClick: () => window.location.reload(), primary: true },
          { label: "Go to overview", href: "/app" },
        ]}
      />
    );
  }
}

// Plain HTML on purpose: error boundaries render outside AppProvider, where
// Polaris web components may not be loaded.
function ErrorPage({
  title,
  body,
  actions,
}: {
  title: string;
  body: string;
  actions: { label: string; href?: string; onClick?: () => void; primary?: boolean }[];
}) {
  const button = (primary?: boolean): React.CSSProperties => ({
    display: "inline-block",
    padding: "6px 14px",
    borderRadius: 8,
    border: primary ? "1px solid #303030" : "1px solid #c9c9c9",
    background: primary ? "#303030" : "#fff",
    color: primary ? "#fff" : "#303030",
    font: "inherit",
    fontWeight: 600,
    textDecoration: "none",
    cursor: "pointer",
  });
  return (
    <main
      style={{
        maxWidth: 520,
        margin: "64px auto",
        padding: 24,
        borderRadius: 12,
        background: "#fff",
        boxShadow: "0 0 0 1px #e3e3e3",
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 14,
        lineHeight: "20px",
        color: "#303030",
      }}
    >
      <h1 style={{ margin: "0 0 8px", fontSize: 18 }}>{title}</h1>
      <p style={{ margin: "0 0 16px", color: "#616161" }}>{body}</p>
      <div style={{ display: "flex", gap: 8 }}>
        {actions.map((action) =>
          action.href ? (
            <a
              key={action.label}
              href={`${action.href}${typeof window === "undefined" ? "" : window.location.search}`}
              style={button(action.primary)}
            >
              {action.label}
            </a>
          ) : (
            <button key={action.label} type="button" onClick={action.onClick} style={button(action.primary)}>
              {action.label}
            </button>
          ),
        )}
      </div>
    </main>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
