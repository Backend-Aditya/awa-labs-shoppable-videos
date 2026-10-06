// Shared stat-tile markup — app._index.tsx, app.reels.tsx, and
// app.widgets.tsx each reimplemented this box/stack/heading combination
// slightly differently (some with an icon, some without), so updating the
// design's spacing/tone meant hunting across three files. One component,
// used everywhere a page shows a labeled count.
export type StatIcon =
  | "video"
  | "check-circle"
  | "play-circle"
  | "hashtag"
  | "view"
  | "cursor"
  | "order"
  | "money";

export function StatTile({
  label,
  value,
  icon,
  tone,
  accent,
}: {
  label: string;
  value: number | string;
  icon?: StatIcon;
  tone?: "info" | "success";
  accent?: boolean;
}) {
  return (
    <s-box
      padding="base"
      background={accent ? "base" : "subdued"}
      border={accent ? "base" : undefined}
      borderColor={accent ? "strong" : undefined}
      borderRadius="base"
    >
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          {icon && <s-icon type={icon} tone={tone ?? "neutral"}></s-icon>}
          <s-text color="subdued">{label}</s-text>
        </s-stack>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}
