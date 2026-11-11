// The merchant's theme around the editor's live preview, so the previewed
// widget looks exactly as it does on the store:
//  - the theme's styles: the stylesheets and inline <style> blocks from the
//    <head> of a storefront page (fonts, heading styles, colours, spacing);
//  - the widget's real surroundings: where the widget is already placed on
//    the storefront, the chain of theme elements around it (section,
//    container, grid…) is reproduced, empty, around the preview, so the
//    theme's own CSS gives it the same width and side spacing. The <html>
//    and <body> classes and inline styles (theme CSS variables) come too.
// Only styles and wrapper elements are taken: never scripts or content.
// Cached per page for a few minutes; best effort: if the store can't be
// reached, the preview uses its own neutral defaults.
import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { log } from "../lib/logger.server";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

const TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 4000;
const MAX_INLINE_CSS = 400_000;
// Attributes copied onto reproduced wrappers: what theme CSS selects on.
const WRAPPER_ATTRS = new Set(["class", "id", "style", "role"]);

export interface ThemeContext {
  head: string;
  htmlAttrs: string;
  bodyAttrs: string;
  wrapOpen: string;
  wrapClose: string;
  // The widget was found on the store: its real surroundings are reproduced.
  placed: boolean;
}

export const EMPTY_THEME: ThemeContext = { head: "", htmlAttrs: "", bodyAttrs: "", wrapOpen: "", wrapClose: "", placed: false };

const pages = new Map<string, { html: string | null; expires: number }>();

const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const absolute = (href: string, base: string) => {
  try {
    const url = new URL(href, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};

const isElement = (node: Node): node is Element => "tagName" in node;
const attr = (el: Element, name: string) => el.attrs.find((a) => a.name === name)?.value;
const classes = (el: Element) => (attr(el, "class") ?? "").split(/\s+/);
const textOf = (el: Element) =>
  el.childNodes.map((c) => ("value" in c && typeof c.value === "string" ? c.value : "")).join("");

const attrsString = (el: Element | undefined, allowed: Set<string>) =>
  el
    ? el.attrs
        .filter((a) => allowed.has(a.name))
        .map((a) => ` ${a.name}="${escapeAttr(a.value)}"`)
        .join("")
    : "";

async function fetchPage(url: string): Promise<string | null> {
  const cached = pages.get(url);
  if (cached && cached.expires > Date.now()) return cached.html;
  let html: string | null = null;
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "AWA Shoppable Videos preview" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
    if (response.ok) html = await response.text();
  } catch (error) {
    log.warn("preview.theme_page_failed", { url }, error);
  }
  pages.set(url, { html, expires: Date.now() + TTL_MS });
  return html;
}

// <link rel="stylesheet"> and <style> from the page's <head>.
function headStyles(head: Element | undefined, baseUrl: string): string {
  if (!head) return "";
  const parts: string[] = [];
  let inlineBytes = 0;
  for (const node of head.childNodes) {
    if (!isElement(node)) continue;
    if (node.tagName === "link" && /\bstylesheet\b/i.test(attr(node, "rel") ?? "")) {
      const href = attr(node, "href");
      const url = href && absolute(href, baseUrl);
      if (url) parts.push(`<link rel="stylesheet" href="${escapeAttr(url)}">`);
    } else if (node.tagName === "style") {
      const css = textOf(node);
      if (/<\/style/i.test(css) || inlineBytes + css.length > MAX_INLINE_CSS) continue;
      inlineBytes += css.length;
      parts.push(`<style>${css}</style>`);
    }
  }
  return parts.join("\n");
}

// Depth-first search for the widget's root element, keeping the path.
function findWithPath(node: Node, match: (el: Element) => boolean, path: Element[] = []): Element[] | null {
  if (isElement(node)) {
    if (match(node)) return [...path, node];
    path = [...path, node];
  }
  const children = "content" in node && node.content ? node.content.childNodes : "childNodes" in node ? node.childNodes : [];
  for (const child of children) {
    const found = findWithPath(child, match, path);
    if (found) return found;
  }
  return null;
}

const findTag = (root: Node, tag: string) => findWithPath(root, (el) => el.tagName === tag)?.at(-1);

// The storefront pages to look on, and the class the widget's root carries.
export async function themeContextFor(urls: string[], widgetClass: string): Promise<ThemeContext> {
  let fallback: ThemeContext | null = null;
  for (const url of urls) {
    const html = await fetchPage(url);
    if (!html) continue;
    const doc = parse(html);
    const htmlEl = findTag(doc, "html");
    const head = findTag(doc, "head");
    const body = findTag(doc, "body");
    const base: ThemeContext = {
      head: headStyles(head, url),
      htmlAttrs: attrsString(htmlEl, new Set(["class", "style", "lang", "dir"])),
      bodyAttrs: attrsString(body, new Set(["class", "style"])),
      wrapOpen: "",
      wrapClose: "",
      placed: false,
    };
    fallback ??= base;
    if (!body) continue;
    const path = findWithPath(body, (el) => classes(el).includes(widgetClass));
    if (!path) continue;
    // The elements between <body> and the widget, reproduced empty.
    const wrappers = path.slice(1, -1);
    return {
      ...base,
      wrapOpen: wrappers.map((el) => `<${el.tagName}${attrsString(el, WRAPPER_ATTRS)}>`).join(""),
      wrapClose: [...wrappers].reverse().map((el) => `</${el.tagName}>`).join(""),
      placed: true,
    };
  }
  return fallback ?? EMPTY_THEME;
}
