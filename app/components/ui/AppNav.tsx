import { NavLink, useLocation } from "react-router";

const LINKS: { to: string; label: string; end?: boolean }[] = [
  { to: "/app", label: "Home", end: true },
  { to: "/app/reels", label: "Reels library" },
  { to: "/app/widgets", label: "Widgets" },
  { to: "/app/settings", label: "Settings" },
];

export function AppNav() {
  const location = useLocation();
  return (
    <nav className="border-b border-border bg-bg px-6 py-3">
      <div className="flex items-center gap-1">
        {LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={{ pathname: link.to, search: location.search }}
            end={link.end}
            className={({ isActive }) =>
              `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted hover:bg-surface hover:text-ink"
              }`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
