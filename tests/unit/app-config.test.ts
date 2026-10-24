// shopify.app.toml checks that a config edit can't get half right: the
// orders/paid webhook and the read_orders scope only work together, and
// every webhook Shopify is told about needs a route to land on.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Comment lines dropped, so a commented-out subscription doesn't count.
const config = readFileSync("shopify.app.toml", "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("#"))
  .join("\n");

const scopes = (config.match(/^scopes\s*=\s*"([^"]*)"/m)?.[1] ?? "").split(",").map((s) => s.trim());
const webhookUris = [...config.matchAll(/^\s*uri\s*=\s*"(\/webhooks\/[^"]+)"/gm)].map((m) => m[1]);
const topics = [...config.matchAll(/^\s*topics\s*=\s*\[([^\]]*)\]/gm)].flatMap((m) => m[1].match(/"[^"]+"/g)?.map((t) => t.slice(1, -1)) ?? []);

describe("shopify.app.toml", () => {
  it("asks for read_orders exactly when it subscribes to orders/paid", () => {
    // Without the scope Shopify sends no order webhooks; without the webhook
    // the scope would ask merchants for a permission nothing uses.
    expect(scopes.includes("read_orders")).toBe(topics.includes("orders/paid"));
  });

  it("routes every webhook subscription to a handler", () => {
    expect(webhookUris.length).toBeGreaterThan(0);
    for (const uri of webhookUris) {
      const route = `app/routes/${uri.slice(1).replaceAll("/", ".")}.tsx`;
      expect(existsSync(route), `${uri} -> ${route}`).toBe(true);
    }
  });
});
