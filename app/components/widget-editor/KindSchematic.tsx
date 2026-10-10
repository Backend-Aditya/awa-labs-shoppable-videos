// Small line-drawing of each widget sitting on a page, used on the widget
// list and in the create flow. The page is drawn in light greys and the
// widget in solid ink so the shape of each type reads at a glance.
import type { WidgetKind } from "../../models/widget-kinds";

const PAGE = "#e6e6e6";
const INK = "#303030";
const MID = "#9a9a9a";

export function KindSchematic({ kind }: { kind: WidgetKind }) {
  return (
    <svg viewBox="0 0 160 100" width="100%" height="100%" role="img" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width="160" height="100" rx="6" fill="#f6f6f6" />
      {SHAPES[kind] ?? null}
    </svg>
  );
}

const SHAPES: Partial<Record<WidgetKind, JSX.Element>> = {
  PRODUCT_PAGE_REELS: (
    <g>
      <rect x="12" y="10" width="40" height="34" rx="3" fill={PAGE} />
      <rect x="60" y="12" width="60" height="5" rx="2" fill={PAGE} />
      <rect x="60" y="22" width="28" height="4" rx="2" fill={PAGE} />
      <rect x="60" y="32" width="70" height="9" rx="3" fill={PAGE} />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i} opacity={i > 3 ? 0.35 : 1}>
          <rect x={12 + i * 30} y="52" width="24" height="38" rx="3" fill={i === 0 ? INK : MID} />
          <rect x={12 + i * 30} y="93" width="16" height="3" rx="1.5" fill={PAGE} />
        </g>
      ))}
    </g>
  ),
  CAROUSEL: (
    <g>
      <rect x="54" y="10" width="52" height="5" rx="2" fill={PAGE} />
      <rect x="22" y="30" width="28" height="50" rx="5" fill={MID} opacity="0.45" />
      <rect x="110" y="30" width="28" height="50" rx="5" fill={MID} opacity="0.45" />
      <rect x="38" y="25" width="30" height="58" rx="5" fill={MID} />
      <rect x="92" y="25" width="30" height="58" rx="5" fill={MID} />
      <rect x="61" y="20" width="38" height="68" rx="6" fill={INK} />
      <path d="M76 49v10l8-5z" fill="#fff" />
      <rect x="70" y="92" width="10" height="3" rx="1.5" fill={INK} />
      <circle cx="85" cy="93.5" r="1.5" fill={MID} />
      <circle cx="90" cy="93.5" r="1.5" fill={MID} />
    </g>
  ),
  STORIES: (
    <g>
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <circle cx={24 + i * 28} cy="28" r="11" fill="none" stroke={i < 4 ? INK : MID} strokeWidth="2" />
          <circle cx={24 + i * 28} cy="28" r="7.5" fill={MID} />
          <rect x={18 + i * 28} y="44" width="12" height="3" rx="1.5" fill={PAGE} />
        </g>
      ))}
      <rect x="12" y="56" width="64" height="34" rx="3" fill={PAGE} />
      <rect x="84" y="56" width="64" height="34" rx="3" fill={PAGE} />
    </g>
  ),
  SINGLE_VIDEO: (
    <g>
      <rect x="20" y="10" width="44" height="80" rx="5" fill={INK} />
      <circle cx="42" cy="50" r="8" fill="#fff" />
      <path d="M40 46v8l6-4z" fill={INK} />
      <rect x="74" y="16" width="56" height="6" rx="2" fill={MID} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="74" y={34 + i * 18} width="12" height="12" rx="2" fill={PAGE} />
          <rect x="90" y={36 + i * 18} width="30" height="3" rx="1.5" fill={PAGE} />
          <rect x="90" y={42 + i * 18} width="16" height="3" rx="1.5" fill={PAGE} />
          <rect x="126" y={36 + i * 18} width="20" height="8" rx="4" fill={INK} />
        </g>
      ))}
    </g>
  ),
  REEL_POPS: (
    <g>
      <rect x="12" y="10" width="136" height="8" rx="2" fill={PAGE} />
      <rect x="12" y="26" width="64" height="40" rx="3" fill={PAGE} />
      <rect x="84" y="26" width="64" height="40" rx="3" fill={PAGE} />
      <rect x="12" y="72" width="64" height="20" rx="3" fill={PAGE} />
      <rect x="120" y="44" width="26" height="46" rx="5" fill={INK} stroke="#fff" strokeWidth="2" />
      <circle cx="146" cy="44" r="4" fill={INK} stroke="#fff" strokeWidth="1.5" />
      <rect x="88" y="78" width="28" height="9" rx="4.5" fill={INK} />
    </g>
  ),
  ADD_TO_CART_VIDEO: (
    <g>
      <rect x="12" y="10" width="56" height="80" rx="3" fill={PAGE} />
      <rect x="78" y="12" width="60" height="6" rx="2" fill={PAGE} />
      <rect x="78" y="24" width="26" height="4" rx="2" fill={PAGE} />
      <rect x="78" y="36" width="70" height="12" rx="3" fill={MID} />
      <rect x="78" y="56" width="70" height="22" rx="4" fill="none" stroke={INK} strokeWidth="1.5" />
      <rect x="82" y="60" width="14" height="14" rx="2" fill={INK} />
      <rect x="100" y="62" width="30" height="3.5" rx="1.5" fill={INK} />
      <rect x="100" y="69" width="20" height="3" rx="1.5" fill={MID} />
    </g>
  ),
};
