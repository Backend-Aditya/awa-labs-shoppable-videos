import type { LoaderFunctionArgs } from "react-router";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { EXTENSION_DIR } from "../lib/liquid-engine.server.mjs";
import { PREVIEW_ASSETS } from "../models/widget-preview.server";

// The storefront widget files (the theme extension's built assets) for the
// widget editor's live preview page. Public, like they are on every
// storefront; only the listed files are served, by exact name.
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const file = String(params.file ?? "");
  if (!PREVIEW_ASSETS.has(file)) return new Response("Not found", { status: 404 });
  try {
    const body = await readFile(path.join(EXTENSION_DIR, "assets", file));
    return new Response(body, {
      headers: {
        "Content-Type": file.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
        // Redeploys change these; a short cache keeps editing snappy.
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};
