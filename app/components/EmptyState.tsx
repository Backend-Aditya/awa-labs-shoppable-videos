// A plain "No X yet." sentence (the old pattern in app.widgets.tsx and
// app.reels.tsx) buries the next step merchants need to take. One shared
// zero-state — icon, heading, body copy, and a call-to-action button that
// opens the same create modal as the page's primary action — for any list
// that can be empty.
import type { StatIcon } from "./StatTile";

export function EmptyState({
  icon,
  heading,
  body,
  actionLabel,
  actionCommandFor,
}: {
  icon: StatIcon;
  heading: string;
  body: string;
  actionLabel: string;
  actionCommandFor: string;
}) {
  return (
    <s-box padding="large-200">
      <s-stack gap="base" alignItems="center">
        <s-box padding="base" background="subdued" borderRadius="large-200">
          <s-icon type={icon} tone="info"></s-icon>
        </s-box>
        <s-stack gap="small-100" alignItems="center">
          <s-heading>{heading}</s-heading>
          <s-text color="subdued">{body}</s-text>
        </s-stack>
        <s-button variant="primary" commandFor={actionCommandFor} command="--show">
          {actionLabel}
        </s-button>
      </s-stack>
    </s-box>
  );
}
