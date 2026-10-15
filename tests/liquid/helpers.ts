import { JSDOM } from "jsdom";
import { createLiquidEngine } from "../support/liquid-engine.mjs";

export const engine = createLiquidEngine();

export const renderFile = (file: string, context: object) => engine.renderFile(file, context) as Promise<string>;

/** Parse rendered markup so tests query it like a browser would. */
export function dom(html: string) {
  const { document } = new JSDOM(`<!doctype html><body>${html}</body>`).window;
  return {
    html,
    document,
    $: <E extends Element = HTMLElement>(selector: string) => document.querySelector<E>(selector),
    $$: <E extends Element = HTMLElement>(selector: string) => Array.from(document.querySelectorAll<E>(selector)),
  };
}

export async function renderDom(file: string, context: object) {
  return dom(await renderFile(file, context));
}
