export function StatTile({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1.5 text-3xl font-semibold text-ink">{value}</div>
      {sublabel && <div className="mt-1.5 text-sm text-muted">{sublabel}</div>}
    </div>
  );
}
