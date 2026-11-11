// Types for the JS liquid engine (liquid-engine.server.mjs).
import type { Liquid } from "liquidjs";

export const EXTENSION_DIR: string;
export const LOCALE: Record<string, unknown>;
export const REEL_NAMESPACE: string;
export function translate(key: string, vars?: Record<string, unknown>, locale?: Record<string, unknown>): string;
export function formatMoney(cents: number | string | null | undefined, moneyFormat?: string): string;
export function colorBrightness(hex: string): number;
export function shiftLightness(hex: string, delta: number): string;
export function createLiquidEngine(options?: {
  assetBase?: string;
  locale?: Record<string, unknown>;
  moneyFormat?: string;
}): Liquid;
export function squash(html: string): string;
