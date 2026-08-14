# Admin Tailwind Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the embedded admin panel's presentation layer — Home, Reels library, Widgets, and both detail modals — from Shopify Polaris web components + inline styles to a small Tailwind CSS design system, with zero changes to loader/action/fetcher logic.

**Architecture:** Install Tailwind CSS v4 via `@tailwindcss/vite`, define an OKLCH token set in `app/tailwind.css`, build nine small presentational primitives under `app/components/ui/`, then swap each route's markup (and only its markup) onto those primitives one file at a time.

**Tech Stack:** Tailwind CSS v4 (`tailwindcss` + `@tailwindcss/vite`), existing React Router 7 / Shopify App Bridge stack (unchanged).

## Global Constraints

- No change to any loader, action, or `*.server.ts` model function anywhere in this plan — every task touches markup/CSS only. If a task's diff touches business logic, that's a bug in the task, not a requirement.
- `app/routes/app.reels.$id.tsx` and `app/routes/app.widgets.$id.tsx` are out of scope — do not touch them.
- All colors are OKLCH, defined once in `app/tailwind.css` under `@theme`, consumed everywhere else as Tailwind utility classes (`bg-primary`, `text-ink`, etc.) — never hardcode a hex or oklch() value in a route/component file.
- Font family is a system-ui stack, no webfont load. Fixed rem type scale: `text-xs` 12px, `text-sm` 13px, `text-base` 14px, `text-lg` 16px, `text-xl` 20px, `text-2xl` 24px.
- This project has no automated UI test infrastructure (no jsdom/testing-library in `package.json`). Verification per task is `npm run typecheck` (must stay clean throughout — the codebase's existing convention) plus a manual dev-server check of the specific behavior the task touches, per the spec's Testing section.
- Every interactive primitive needs default/hover/focus-visible/disabled states at minimum; `Button` and form fields additionally need a loading/error state where the existing route code has one today.
- Preserve every `data-*`/id-based hook the existing fetcher-driven logic depends on (e.g., `modalRef.current?.showOverlay()`/`hideOverlay()` call sites become `modalRef.current?.show()`/`hide()` — same call sites, new method names) and every code comment that documents a non-obvious fix (the delete-form `onSubmit` comment, the upload `armedRef` comment, etc.) — copy them forward verbatim into the rewritten files.

---

### Task 1: Install and configure Tailwind CSS

**Files:**
- Modify: `package.json` (devDependencies)
- Modify: `vite.config.ts`
- Create: `app/tailwind.css`
- Modify: `app/root.tsx`

**Interfaces:**
- Produces: `app/tailwind.css` — the token file every later task's Tailwind classes resolve against (`bg-bg`, `bg-surface`, `text-ink`, `text-muted`, `border-border`, `bg-primary`, `text-primary-ink`, `text-accent`/`bg-accent`, `bg-success`/`bg-success-bg`/`text-success`, `bg-warning`/`bg-warning-bg`/`text-warning`, `bg-critical`/`bg-critical-bg`/`text-critical`, plus the `text-xs`…`text-2xl` scale and `font-sans`).

- [ ] **Step 1: Install Tailwind**

Run:
```bash
npm install -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Wire the Vite plugin**

In `vite.config.ts`, add the import and register the plugin:

```ts
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
```

Then in the `plugins` array:

```ts
  plugins: [
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
```

(Everything else in the file — `server`, `build`, `optimizeDeps` — is unchanged.)

- [ ] **Step 3: Create the token file**

Create `app/tailwind.css`:

```css
@import "tailwindcss";

@theme {
  --color-bg: oklch(1 0 0);
  --color-surface: oklch(0.97 0.004 200);
  --color-ink: oklch(0.18 0.01 200);
  --color-muted: oklch(0.55 0.012 200);
  --color-border: oklch(0.90 0.006 200);
  --color-primary: oklch(0.48 0.10 200);
  --color-primary-ink: oklch(1 0 0);
  --color-accent: oklch(0.55 0.14 265);
  --color-success: oklch(0.55 0.13 145);
  --color-success-bg: oklch(0.95 0.03 145);
  --color-warning: oklch(0.65 0.15 80);
  --color-warning-bg: oklch(0.96 0.04 80);
  --color-critical: oklch(0.55 0.18 25);
  --color-critical-bg: oklch(0.95 0.04 25);

  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica,
    Arial, sans-serif;

  --text-xs: 0.75rem;
  --text-sm: 0.8125rem;
  --text-base: 0.875rem;
  --text-lg: 1rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
}

body {
  background-color: var(--color-bg);
  color: var(--color-ink);
}
```

- [ ] **Step 4: Import the token file and drop the Polaris/Inter font load**

Replace `app/root.tsx` in full:

```tsx
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import "./tailwind.css";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="font-sans text-base text-ink antialiased">
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Verify**

Run:
```bash
npm run typecheck
```
Expected: no new errors.

Run the dev server (`npm run dev`) and confirm the app still boots to the (still-Polaris-styled) admin screens with no console errors about missing `tailwind.css`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.ts app/tailwind.css app/root.tsx
git commit -m "build: install and configure Tailwind CSS v4"
```

---

### Task 2: Button and Badge primitives

**Files:**
- Create: `app/components/ui/Button.tsx`
- Create: `app/components/ui/Badge.tsx`

**Interfaces:**
- Produces: `Button({ variant?: "primary"|"secondary"|"critical"|"ghost", loading?: boolean, ...ButtonHTMLAttributes })` — default `type="button"`, overridable via props (e.g. `type="submit"`).
- Produces: `Badge({ tone: "success"|"warning"|"critical"|"info"|"neutral", children })`.

- [ ] **Step 1: Create `Button`**

```tsx
import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "critical" | "ghost";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-ink hover:bg-primary/90 focus-visible:outline-primary",
  secondary:
    "border border-border bg-bg text-ink hover:bg-surface focus-visible:outline-primary",
  critical:
    "border border-critical/30 bg-critical-bg text-critical hover:bg-critical/15 focus-visible:outline-critical",
  ghost: "text-ink hover:bg-surface focus-visible:outline-primary",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  children,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {loading && (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Create `Badge`**

```tsx
import type { ReactNode } from "react";

type BadgeTone = "success" | "warning" | "critical" | "info" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  critical: "bg-critical-bg text-critical",
  info: "bg-accent/10 text-accent",
  neutral: "bg-surface text-muted",
};

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 3: Verify**

Run `npm run typecheck` — expected: no new errors (nothing imports these yet, so this only checks the files parse/typecheck standalone).

- [ ] **Step 4: Commit**

```bash
git add app/components/ui/Button.tsx app/components/ui/Badge.tsx
git commit -m "feat(admin-ui): add Button and Badge primitives"
```

---

### Task 3: Card and StatTile primitives

**Files:**
- Create: `app/components/ui/Card.tsx`
- Create: `app/components/ui/StatTile.tsx`

**Interfaces:**
- Consumes: none.
- Produces: `Card({ children, className? })` (plain non-interactive card) plus two exported class-name strings, `CARD_CLASSES` and `CARD_INTERACTIVE_CLASSES`, for call sites that need a clickable/submit `<button>` styled like a card (a real `<button>` can't be `Card`'s child *and* the clickable element in the same node without nesting interactive elements, so those call sites apply `CARD_INTERACTIVE_CLASSES` directly to their own `<button>`).
- Produces: `StatTile({ label, value, sublabel? })`.

- [ ] **Step 1: Create `Card`**

```tsx
import type { ReactNode } from "react";

export const CARD_CLASSES = "rounded-lg border border-border bg-bg p-4";

export const CARD_INTERACTIVE_CLASSES =
  "rounded-lg border border-border bg-bg p-4 text-left transition-colors hover:border-primary/40 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`${CARD_CLASSES} ${className}`}>{children}</div>;
}
```

- [ ] **Step 2: Create `StatTile`**

```tsx
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
    <div className="min-w-[140px] rounded-lg border border-border bg-surface p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
      {sublabel && <div className="mt-1 text-sm text-muted">{sublabel}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Verify**

`npm run typecheck` — expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/components/ui/Card.tsx app/components/ui/StatTile.tsx
git commit -m "feat(admin-ui): add Card and StatTile primitives"
```

---

### Task 4: TextField, Checkbox, Select primitives

**Files:**
- Create: `app/components/ui/TextField.tsx`
- Create: `app/components/ui/Checkbox.tsx`
- Create: `app/components/ui/Select.tsx`

**Interfaces:**
- Produces: `TextField({ label, name, ...InputHTMLAttributes })`, `Checkbox({ label, name, value?, ...InputHTMLAttributes })`, `Select({ label, name, children, ...SelectHTMLAttributes })` — all uncontrolled, matching the existing routes' uncontrolled `defaultValue`/`defaultChecked` usage.

- [ ] **Step 1: Create `TextField`**

```tsx
import type { InputHTMLAttributes } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function TextField({ label, name, id, ...props }: TextFieldProps) {
  const fieldId = id ?? `field-${name}`;
  return (
    <label htmlFor={fieldId} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        id={fieldId}
        name={name}
        className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted"
        {...props}
      />
    </label>
  );
}
```

- [ ] **Step 2: Create `Checkbox`**

```tsx
import type { InputHTMLAttributes } from "react";

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Checkbox({ label, name, value, id, ...props }: CheckboxProps) {
  const fieldId = id ?? `checkbox-${name}-${String(value ?? label).replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <label htmlFor={fieldId} className="flex items-center gap-2 text-sm text-ink">
      <input
        id={fieldId}
        type="checkbox"
        name={name}
        value={value}
        className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/30"
        {...props}
      />
      {label}
    </label>
  );
}
```

- [ ] **Step 3: Create `Select`**

```tsx
import type { SelectHTMLAttributes } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
}

export function Select({ label, name, id, children, ...props }: SelectProps) {
  const fieldId = id ?? `select-${name}`;
  return (
    <label htmlFor={fieldId} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <select
        id={fieldId}
        name={name}
        className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        {...props}
      >
        {children}
      </select>
    </label>
  );
}
```

- [ ] **Step 4: Verify**

`npm run typecheck` — expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add app/components/ui/TextField.tsx app/components/ui/Checkbox.tsx app/components/ui/Select.tsx
git commit -m "feat(admin-ui): add TextField, Checkbox, Select primitives"
```

---

### Task 5: Modal primitive (replaces `s-modal`)

**Files:**
- Create: `app/components/ui/Modal.tsx`

**Interfaces:**
- Produces: `ModalHandle { show(): void; hide(): void }`, `Modal({ title, onClose, children }, ref: Ref<ModalHandle>)`. Built on the native `<dialog>` element. `onClose` fires on the dialog's native `close` event, which covers ESC and the explicit close button — matching the current `s-modal`'s `onHide` callback contract, so call sites only rename `showOverlay`/`hideOverlay` to `show`/`hide`.

- [ ] **Step 1: Create `Modal`**

```tsx
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from "react";

export interface ModalHandle {
  show: () => void;
  hide: () => void;
}

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export const Modal = forwardRef<ModalHandle, ModalProps>(function Modal(
  { title, onClose, children },
  ref,
) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useImperativeHandle(ref, () => ({
    show: () => dialogRef.current?.showModal(),
    hide: () => dialogRef.current?.close(),
  }));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
      className="m-auto w-full max-w-lg rounded-xl border border-border bg-bg p-0 backdrop:bg-ink/40"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
});
```

- [ ] **Step 2: Verify**

`npm run typecheck` — expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/ui/Modal.tsx
git commit -m "feat(admin-ui): add Modal primitive on native <dialog>"
```

---

### Task 6: AppNav and PageShell primitives

**Files:**
- Create: `app/components/ui/AppNav.tsx`
- Create: `app/components/ui/PageShell.tsx`

**Interfaces:**
- Produces: `AppNav()` — top nav bar, replaces `<s-app-nav>` in `app.tsx`.
- Produces: `PageShell({ heading, children })` — page container + heading, replaces `<s-page heading=...>` in each route.

- [ ] **Step 1: Create `AppNav`**

```tsx
import { NavLink } from "react-router";

const LINKS: { to: string; label: string; end?: boolean }[] = [
  { to: "/app", label: "Home", end: true },
  { to: "/app/reels", label: "Reels library" },
  { to: "/app/widgets", label: "Widgets" },
  { to: "/app/settings", label: "Settings" },
];

export function AppNav() {
  return (
    <nav className="border-b border-border bg-bg px-6 py-3">
      <div className="flex items-center gap-1">
        {LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
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
```

- [ ] **Step 2: Create `PageShell`**

```tsx
import type { ReactNode } from "react";

export function PageShell({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-ink">{heading}</h1>
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

`npm run typecheck` — expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/components/ui/AppNav.tsx app/components/ui/PageShell.tsx
git commit -m "feat(admin-ui): add AppNav and PageShell primitives"
```

---

### Task 7: Rewrite `app.tsx` onto AppNav

**Files:**
- Modify: `app/routes/app.tsx`

**Interfaces:**
- Consumes: `AppNav` from Task 6.

- [ ] **Step 1: Replace the file in full**

```tsx
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import type {} from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { AppNav } from "../components/ui/AppNav";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <AppNav />
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

- [ ] **Step 2: Verify**

Run `npm run typecheck` — expected: no new errors.

Start the dev server and open `/app` in the embedded admin. Confirm: nav bar shows Home/Reels library/Widgets/Settings, the current route is highlighted, and clicking each link navigates correctly (this exercises the same GET-navigation path as before — only the nav's markup changed, not the routing).

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.tsx
git commit -m "refactor(admin): rebuild app nav on Tailwind AppNav"
```

---

### Task 8: Rewrite `app._index.tsx`

**Files:**
- Modify: `app/routes/app._index.tsx`

**Interfaces:**
- Consumes: `PageShell` (Task 6), `StatTile` (Task 3), `CARD_INTERACTIVE_CLASSES` (Task 3).

- [ ] **Step 1: Replace the file in full**

```tsx
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { listReels } from "../models/reel.server";
import { deriveReelStatus } from "../models/reel-status";
import { listWidgetsForShop } from "../models/widget.server";
import { PreserveSearchParams } from "../components/PreserveSearchParams";
import { PageShell } from "../components/ui/PageShell";
import { StatTile } from "../components/ui/StatTile";
import { CARD_INTERACTIVE_CLASSES } from "../components/ui/Card";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const [reels, widgets] = await Promise.all([
    listReels(admin, 50),
    listWidgetsForShop(shop.id),
  ]);

  const readyReels = reels.filter((r) => deriveReelStatus(r.config) === "ready").length;
  const publishedWidgets = widgets.filter((w) => w.published).length;

  return {
    plan: shop.plan,
    viewCapMonthly: shop.viewCapMonthly,
    totalReels: reels.length,
    readyReels,
    totalWidgets: widgets.length,
    publishedWidgets,
  };
};

function NavCard({
  to,
  heading,
  description,
}: {
  to: string;
  heading: string;
  description: string;
}) {
  return (
    <form method="get" action={to} className="m-0">
      <PreserveSearchParams />
      <button type="submit" className={`block w-full ${CARD_INTERACTIVE_CLASSES}`}>
        <div className="mb-1.5 font-semibold text-ink">{heading}</div>
        <div className="text-sm text-muted">{description}</div>
      </button>
    </form>
  );
}

export default function Index() {
  const {
    plan,
    viewCapMonthly,
    totalReels,
    readyReels,
    totalWidgets,
    publishedWidgets,
  } = useLoaderData<typeof loader>();

  return (
    <PageShell heading="Shoppable Videos">
      <div className="flex flex-wrap gap-4">
        <StatTile label="Reels" value={totalReels} sublabel={`${readyReels} ready to play`} />
        <StatTile label="Widgets" value={totalWidgets} sublabel={`${publishedWidgets} published`} />
        <StatTile label="Plan" value={plan} sublabel={`${viewCapMonthly.toLocaleString()} views/mo`} />
      </div>
      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Get started</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          <NavCard
            to="/app/reels"
            heading="Reels library"
            description="Upload videos, tag products, manage status"
          />
          <NavCard
            to="/app/widgets"
            heading="Widgets"
            description="Manage where reels show up on your storefront"
          />
        </div>
      </section>
    </PageShell>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

- [ ] **Step 2: Verify**

`npm run typecheck` — expected: no new errors.

In the dev server, open `/app`. Confirm the three stat tiles show correct numbers and both nav cards navigate to `/app/reels` and `/app/widgets` (this is a `<form method="get">` submit — confirm the destination page still loads correctly, proving `PreserveSearchParams` still works unchanged).

- [ ] **Step 3: Commit**

```bash
git add app/routes/app._index.tsx
git commit -m "refactor(admin): rebuild home page on Tailwind primitives"
```

---

### Task 9: Rewrite `app.reels.tsx`

**Files:**
- Modify: `app/routes/app.reels.tsx`

**Interfaces:**
- Consumes: `PageShell`, `StatTile`, `Card`/`CARD_INTERACTIVE_CLASSES`, `Badge`, `Button`, `TextField`, `Checkbox`, `Modal`/`ModalHandle` from Tasks 2–6.
- Loader, action, and every fetcher-driven behavior (upload flow with `armedRef`, mark-upload-failed, delete-form `onSubmit` guard, edit/tag-products revalidation effects) are copied forward unchanged — only JSX/markup changes.

- [ ] **Step 1: Replace the file in full**

```tsx
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  deleteReel,
  generateReelHandle,
  listReels,
  updateReelConfig,
  upsertReel,
} from "../models/reel.server";
import type { Reel } from "../models/reel.server";
import { deriveReelStatus } from "../models/reel-status";
import { createDirectUploadUrl, getCloudflareConfig } from "../models/cloudflare-stream.server";
import { PageShell } from "../components/ui/PageShell";
import { StatTile } from "../components/ui/StatTile";
import { CARD_INTERACTIVE_CLASSES } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { Checkbox } from "../components/ui/Checkbox";
import { Modal, type ModalHandle } from "../components/ui/Modal";

// Route param is the trailing numeric id only — a raw GID (gid://shopify/Metaobject/123)
// contains ':' and '/' characters that break single-segment routing/URLs.
function reelNumericId(reel: Reel): string {
  return reel.id.split("/").pop()!;
}

const REEL_STATUS_LABELS: Record<string, string> = {
  draft: "No video",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const reels = await listReels(admin, 50);
  return { reels };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "mark-upload-failed") {
    const reelId = String(formData.get("reelId") ?? "");
    if (!reelId) {
      return { error: "Missing reel id", uploadURL: null, reelId: null };
    }
    await updateReelConfig(admin, reelId, {
      uploadFailedAt: new Date().toISOString(),
    });
    return { error: null, uploadURL: null, reelId: null };
  }

  if (intent === "start-upload") {
    const title = String(formData.get("uploadTitle") ?? "").trim();
    if (!title) {
      return { error: "Title is required", uploadURL: null, reelId: null };
    }

    try {
      const reel = await upsertReel(admin, generateReelHandle(title), title, false, {
        productIds: [],
        interactions: {},
        source: { type: "upload" },
      });

      try {
        const { uid, uploadURL } = await createDirectUploadUrl(
          getCloudflareConfig(),
          3600,
          { reelId: reel.id, shop: session.shop },
        );

        // Record the stream uid as soon as it exists, not just when the
        // "ready" webhook fires — that webhook depends on a notificationUrl
        // registered against this app's public URL, which in dev points at
        // a Cloudflare tunnel hostname that rotates on every restart. Without
        // this, an otherwise-successful upload leaves config.cloudflareStreamUid
        // unset forever and the preview never appears, regardless of whether
        // the video actually finished processing.
        await updateReelConfig(admin, reel.id, { cloudflareStreamUid: uid });

        return { error: null, uploadURL, reelId: reel.id };
      } catch {
        try {
          await deleteReel(admin, reel.id);
        } catch {
          // best-effort cleanup; the original error below is what the merchant sees
        }
        return {
          error: "Could not start upload. Check Cloudflare configuration.",
          uploadURL: null,
          reelId: null,
        };
      }
    } catch (e) {
      // The Shopify Admin client throws actual Response objects (not Error) for
      // session-token expiry and rate-limit throttling — this is Shopify's own
      // control-flow mechanism and React Router needs to see it propagate. Do not
      // remove this rethrow or it will swallow real auth failures and mislabel
      // them as Cloudflare configuration errors.
      if (e instanceof Response) throw e;
      return {
        error: "Could not create the reel. Try again.",
        uploadURL: null,
        reelId: null,
      };
    }
  }

  const title = String(formData.get("title") ?? "").trim();
  const published = formData.get("published") != null;

  if (!title) {
    return { error: "Title is required", uploadURL: null, reelId: null };
  }

  await upsertReel(admin, generateReelHandle(title), title, published, {
    productIds: [],
    interactions: {},
    source: { type: "upload" },
  });

  return { error: null, uploadURL: null, reelId: null };
};

function UploadVideoForm() {
  const fetcher = useFetcher<typeof action>();
  const failureFetcher = useFetcher();
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "uploading" | "done" | "error" | "no-file"
  >("idle");
  // armedRef gates the upload PUT to fire exactly once per submission. Without
  // it, changing the selected file after a completed/failed upload re-runs this
  // effect and re-fires against the STALE one-time uploadURL from the previous
  // submission — silently uploading the wrong file into the wrong reel's
  // Cloudflare record with no visible error. Do not remove this guard, and do
  // not drop `fetcher.state` from the dependency array (it closes a ~1-3s race
  // during an in-flight submission).
  const armedRef = useRef(false);

  useEffect(() => {
    if (
      armedRef.current &&
      fetcher.state === "idle" &&
      fetcher.data?.uploadURL &&
      file
    ) {
      armedRef.current = false;
      setUploadStatus("uploading");
      const reelId = fetcher.data.reelId;
      const body = new FormData();
      body.append("file", file);
      fetch(fetcher.data.uploadURL, { method: "POST", body })
        .then((res) => {
          setUploadStatus(res.ok ? "done" : "error");
          if (!res.ok && reelId) {
            const failForm = new FormData();
            failForm.set("intent", "mark-upload-failed");
            failForm.set("reelId", reelId);
            failureFetcher.submit(failForm, { method: "post" });
          }
        })
        .catch(() => {
          setUploadStatus("error");
          if (reelId) {
            const failForm = new FormData();
            failForm.set("intent", "mark-upload-failed");
            failForm.set("reelId", reelId);
            failureFetcher.submit(failForm, { method: "post" });
          }
        });
    }
  }, [fetcher.data, file, fetcher.state, failureFetcher]);

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-ink">Upload a video</h2>
      <fetcher.Form
        method="post"
        onSubmit={(e) => {
          if (!file) {
            e.preventDefault();
            setUploadStatus("no-file");
            return;
          }
          armedRef.current = true;
          setUploadStatus("idle");
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="intent" value="start-upload" />
        {fetcher.data?.error && (
          <p className="text-sm text-critical">{fetcher.data.error}</p>
        )}
        <TextField label="Title" name="uploadTitle" required />
        <input
          type="file"
          accept="video/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm text-ink file:mr-3 file:rounded-md file:border file:border-border file:bg-bg file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-surface"
        />
        <div>
          <Button type="submit" variant="primary" loading={fetcher.state !== "idle"}>
            Start upload
          </Button>
        </div>
        {uploadStatus === "uploading" && (
          <p className="text-sm text-muted">Uploading to Cloudflare…</p>
        )}
        {uploadStatus === "done" && (
          <p className="text-sm text-success">
            Upload complete — processing will finish shortly.
          </p>
        )}
        {uploadStatus === "error" && (
          <p className="text-sm text-critical">Upload failed. Try again.</p>
        )}
        {uploadStatus === "no-file" && (
          <p className="text-sm text-critical">Choose a video file first.</p>
        )}
      </fetcher.Form>
    </section>
  );
}

function statusTone(status: string | null): "success" | "critical" | "info" | "neutral" {
  return status === "ready"
    ? "success"
    : status === "failed"
      ? "critical"
      : status === "processing"
        ? "info"
        : "neutral";
}

function ReelCard({ reel, onOpen }: { reel: Reel; onOpen: (reel: Reel) => void }) {
  const status = deriveReelStatus(reel.config);
  const productCount = reel.config.productIds?.length ?? 0;

  return (
    // Opens a popup instead of navigating — full-page navigation inside the
    // embedded admin iframe repeatedly failed to reach the detail route (see
    // git history). A click handler that shows a Modal and loads detail data
    // via useFetcher() sidesteps that: fetcher requests go through App
    // Bridge's patched fetch(), which attaches a session-token header, so
    // authenticate.admin() never falls back to needing shop/host params.
    <button
      type="button"
      onClick={() => onOpen(reel)}
      className={`block w-full ${CARD_INTERACTIVE_CLASSES}`}
    >
      <div className="mb-2 h-[140px] w-full overflow-hidden rounded-md bg-surface">
        {reel.config.posterUrl ? (
          <img
            src={reel.config.posterUrl}
            alt={reel.title}
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>
      <div className="mb-2 font-semibold text-ink">{reel.title}</div>
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        <Badge tone={reel.published ? "success" : "neutral"}>
          {reel.published ? "Published" : "Draft"}
        </Badge>
        <Badge tone={statusTone(status)}>{REEL_STATUS_LABELS[status]}</Badge>
      </div>
      <Badge tone={productCount > 0 ? "success" : "neutral"}>
        {productCount > 0 ? `${productCount} tagged` : "Untagged"}
      </Badge>
    </button>
  );
}

type ReelDetailLoaderData = {
  loaderError: string | null;
  reel: Reel | null;
  taggedProducts: { id: string; title: string }[];
};

function ReelDetailModal({
  reel,
  onClose,
}: {
  reel: Reel | null;
  onClose: () => void;
}) {
  const modalRef = useRef<ModalHandle>(null);
  const detailFetcher = useFetcher<ReelDetailLoaderData>();
  const editFetcher = useFetcher<{ error: string | null }>();
  const productsFetcher = useFetcher<{ error: string | null }>();
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();
  const href = reel ? `/app/reels/${reelNumericId(reel)}` : null;

  useEffect(() => {
    if (href) {
      modalRef.current?.show();
      detailFetcher.load(href);
    } else {
      modalRef.current?.hide();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href]);

  useEffect(() => {
    if (href && editFetcher.state === "idle" && editFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editFetcher.state, editFetcher.data]);

  useEffect(() => {
    if (href && productsFetcher.state === "idle" && productsFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productsFetcher.state, productsFetcher.data]);

  const handlePickProducts = async () => {
    if (!href) return;
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: (detailFetcher.data?.taggedProducts ?? []).map((p) => ({ id: p.id })),
    });
    if (!selected) return;

    const formData = new FormData();
    formData.set("intent", "set-products");
    for (const product of selected) {
      formData.append("productId", product.id);
    }
    productsFetcher.submit(formData, { method: "post", action: href });
  };

  const data = detailFetcher.data;
  const detailReel = data?.reel ?? null;
  const status = detailReel ? deriveReelStatus(detailReel.config) : null;

  return (
    <Modal ref={modalRef} title={reel?.title ?? "Reel"} onClose={onClose}>
      {!data ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : data.loaderError ? (
        <p className="text-sm text-critical">{data.loaderError}</p>
      ) : detailReel ? (
        <div className="flex flex-col gap-4">
          {detailReel.config.cloudflareStreamUid ? (
            <iframe
              src={`https://iframe.videodelivery.net/${encodeURIComponent(detailReel.config.cloudflareStreamUid)}`}
              title={`Preview of ${detailReel.title}`}
              className="aspect-[9/16] w-full max-w-[220px] border-0"
              allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture"
              allowFullScreen
            ></iframe>
          ) : (
            <p className="text-sm text-muted">No video uploaded yet.</p>
          )}
          <p className="flex items-center gap-2 text-sm text-ink">
            Status:{" "}
            <Badge tone={statusTone(status)}>{status ? REEL_STATUS_LABELS[status] : ""}</Badge>
          </p>

          {editFetcher.data?.error && (
            <p className="text-sm text-critical">{editFetcher.data.error}</p>
          )}
          <editFetcher.Form method="post" action={href!} className="flex flex-col gap-4">
            <TextField label="Title" name="title" defaultValue={detailReel.title} required />
            <Checkbox label="Published" name="published" defaultChecked={detailReel.published} />
            <div>
              <Button type="submit" variant="primary" loading={editFetcher.state !== "idle"}>
                Save
              </Button>
            </div>
          </editFetcher.Form>

          <div className="flex flex-col gap-3">
            {productsFetcher.data?.error && (
              <p className="text-sm text-critical">{productsFetcher.data.error}</p>
            )}
            {data.taggedProducts.length === 0 ? (
              <p className="text-sm text-muted">No products tagged yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {data.taggedProducts.map((product) => (
                  <p key={product.id} className="text-sm text-ink">
                    {product.title}
                  </p>
                ))}
              </div>
            )}
            <div>
              <Button
                variant="secondary"
                onClick={handlePickProducts}
                loading={productsFetcher.state !== "idle"}
              >
                {data.taggedProducts.length === 0 ? "Tag products" : "Edit tagged products"}
              </Button>
            </div>
          </div>

          <deleteFetcher.Form
            method="post"
            action={href ?? undefined}
            onSubmit={(e) => {
              // Don't call onClose() here — it sets selectedReelId to null
              // synchronously, which can flip href to null before/while the
              // fetcher reads this form's action, sending the delete POST
              // for the wrong (or no) id and 404ing (confirmed live on the
              // equivalent widgets modal). The modal closes naturally once
              // the reel disappears from the revalidated list after the
              // delete redirect completes.
              if (!confirm("Delete this reel? This can't be undone.")) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="intent" value="delete" />
            <Button type="submit" variant="critical" loading={deleteFetcher.state !== "idle"}>
              Delete reel
            </Button>
          </deleteFetcher.Form>
        </div>
      ) : null}
    </Modal>
  );
}

export default function ReelsLibrary() {
  const { reels } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [selectedReelId, setSelectedReelId] = useState<string | null>(null);
  // Re-derived from the live `reels` list (not stored as its own object) so
  // the modal reflects fresh data automatically after the list revalidates.
  const selectedReel = reels.find((r) => r.id === selectedReelId) ?? null;

  const publishedCount = reels.filter((r) => r.published).length;
  const readyCount = reels.filter(
    (r) => deriveReelStatus(r.config) === "ready",
  ).length;
  const taggedCount = reels.filter(
    (r) => (r.config.productIds?.length ?? 0) > 0,
  ).length;

  return (
    <PageShell heading="Reels library">
      <div className="flex flex-wrap gap-4">
        <StatTile label="Total reels" value={reels.length} />
        <StatTile label="Published" value={publishedCount} />
        <StatTile label="Ready to play" value={readyCount} />
        <StatTile label="Tagged to products" value={taggedCount} />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Create a reel</h2>
        {actionData?.error && (
          <p className="mb-3 text-sm text-critical">{actionData.error}</p>
        )}
        <Form method="post" className="flex flex-col gap-4">
          <TextField label="Title" name="title" required />
          <Checkbox label="Published" name="published" />
          <div>
            <Button type="submit" variant="primary" loading={isSubmitting}>
              Create reel
            </Button>
          </div>
        </Form>
      </section>

      <UploadVideoForm />

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">All reels</h2>
        {reels.length === 0 ? (
          <p className="text-sm text-muted">No reels yet. Create your first one above.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {reels.map((reel) => (
              <ReelCard key={reel.id} reel={reel} onOpen={(r) => setSelectedReelId(r.id)} />
            ))}
          </div>
        )}
      </section>

      <ReelDetailModal reel={selectedReel} onClose={() => setSelectedReelId(null)} />
    </PageShell>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

- [ ] **Step 2: Verify**

`npm run typecheck` — expected: no new errors.

In the dev server, exercise the full flow on `/app/reels`: create a reel, upload a video to a reel, open a reel card (modal shows preview/status/edit form/tag-products/delete), edit the title and save, tag products, and delete a reel. Confirm the modal opens/closes correctly (X button, ESC key, and clicking the backdrop all close it) and that delete still succeeds without a 404 (the `onSubmit` guard is unchanged).

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.reels.tsx
git commit -m "refactor(admin): rebuild reels library on Tailwind primitives"
```

---

### Task 10: Rewrite `app.widgets.tsx`

**Files:**
- Modify: `app/routes/app.widgets.tsx`

**Interfaces:**
- Consumes: `PageShell`, `StatTile`, `Card`/`CARD_INTERACTIVE_CLASSES`, `Badge`, `Button`, `TextField`, `Checkbox`, `Select`, `Modal`/`ModalHandle` from Tasks 2–6.
- Loader, action, and every fetcher-driven behavior (create-widget, edit, set-target/clear-target, set-featured-reel, set-reels, delete-form `onSubmit` guard) are copied forward unchanged — only JSX/markup changes.

- [ ] **Step 1: Replace the file in full**

```tsx
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getOrCreateShop } from "../models/shop.server";
import { createWidget, listWidgetsForShop } from "../models/widget.server";
import type { WidgetConfig, WidgetKind } from "../models/widget.server";
import type { Widget } from "@prisma/client";
import { PageShell } from "../components/ui/PageShell";
import { StatTile } from "../components/ui/StatTile";
import { CARD_INTERACTIVE_CLASSES } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { Checkbox } from "../components/ui/Checkbox";
import { Select } from "../components/ui/Select";
import { Modal, type ModalHandle } from "../components/ui/Modal";

interface WidgetTemplateMeta {
  kind: WidgetKind;
  name: string;
  description: string;
}

const WIDGET_TEMPLATES: WidgetTemplateMeta[] = [
  {
    kind: "PRODUCT_PAGE_REELS",
    name: "Product page reels",
    description: "A row of tagged reels on the product page.",
  },
  {
    kind: "SINGLE_VIDEO",
    name: "Single video",
    description: "One featured video, no carousel.",
  },
  {
    kind: "CAROUSEL",
    name: "Stacked carousel",
    description: "Tagged reels as a swipeable stacked deck.",
  },
  {
    kind: "STORIES",
    name: "Insta-style stories",
    description: "Circular avatars that open a full-screen story viewer.",
  },
  {
    kind: "REEL_POPS",
    name: "Reel pops",
    description: "A site-wide floating bubble that expands into a video.",
  },
];

const WIDGET_KINDS: WidgetKind[] = WIDGET_TEMPLATES.map((t) => t.kind);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const widgets = await listWidgetsForShop(shop.id);
  return { widgets };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "");

  if (!name || !WIDGET_KINDS.includes(type as WidgetKind)) {
    return { error: "Name and a valid widget type are required" };
  }

  await createWidget(shop.id, type as WidgetKind, name, {
    templateStyle: "classic",
    targetRule: { type: "all_products" },
  });

  return { error: null };
};

function WidgetCard({ widget, onOpen }: { widget: Widget; onOpen: (widget: Widget) => void }) {
  return (
    // Opens a popup instead of navigating — see ReelCard in app.reels.tsx for
    // why: full-page navigation inside the embedded admin iframe repeatedly
    // failed to reach the detail route, while fetcher requests (used here)
    // go through App Bridge's patched fetch() and carry a session token.
    <button
      type="button"
      onClick={() => onOpen(widget)}
      className={`block w-full ${CARD_INTERACTIVE_CLASSES}`}
    >
      <div className="mb-1.5 font-semibold text-ink">{widget.name}</div>
      <div className="mb-2 text-sm text-muted">{widget.type}</div>
      <Badge tone={widget.published ? "success" : "neutral"}>
        {widget.published ? "Published" : "Draft"}
      </Badge>
    </button>
  );
}

function TemplatePicker({
  value,
  onChange,
}: {
  value: WidgetKind;
  onChange: (kind: WidgetKind) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
      {WIDGET_TEMPLATES.map((template) => (
        <button
          key={template.kind}
          type="button"
          onClick={() => onChange(template.kind)}
          className={`rounded-lg border p-2.5 text-left transition-colors ${
            template.kind === value
              ? "border-2 border-primary"
              : "border border-border hover:border-primary/40"
          }`}
        >
          <div className="mb-2 h-14 rounded-md bg-surface" />
          <div className="text-sm font-semibold text-ink">{template.name}</div>
          <div className="text-xs text-muted">{template.description}</div>
        </button>
      ))}
    </div>
  );
}

type WidgetDetailLoaderData = {
  widget: Widget;
  reels: { id: string; title: string }[];
};

function WidgetDetailModal({
  widget,
  onClose,
}: {
  widget: Widget | null;
  onClose: () => void;
}) {
  const modalRef = useRef<ModalHandle>(null);
  const detailFetcher = useFetcher<WidgetDetailLoaderData>();
  const editFetcher = useFetcher<{ error: string | null }>();
  const targetFetcher = useFetcher<{ error: string | null }>();
  const featuredReelFetcher = useFetcher<{ error: string | null }>();
  const reelsFetcher = useFetcher<{ error: string | null }>();
  const deleteFetcher = useFetcher();
  const shopify = useAppBridge();
  const href = widget ? `/app/widgets/${encodeURIComponent(widget.id)}` : null;

  useEffect(() => {
    if (href) {
      modalRef.current?.show();
      detailFetcher.load(href);
    } else {
      modalRef.current?.hide();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href]);

  useEffect(() => {
    if (href && editFetcher.state === "idle" && editFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editFetcher.state, editFetcher.data]);

  useEffect(() => {
    if (href && targetFetcher.state === "idle" && targetFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFetcher.state, targetFetcher.data]);

  useEffect(() => {
    if (href && featuredReelFetcher.state === "idle" && featuredReelFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featuredReelFetcher.state, featuredReelFetcher.data]);

  useEffect(() => {
    if (href && reelsFetcher.state === "idle" && reelsFetcher.data) {
      detailFetcher.load(href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reelsFetcher.state, reelsFetcher.data]);

  const detailWidget = detailFetcher.data?.widget ?? null;
  const targetRule = detailWidget
    ? (detailWidget.config as unknown as WidgetConfig).targetRule
    : null;
  const currentHandles = targetRule?.type === "handles" ? targetRule.handles : [];

  const handlePickProducts = async () => {
    if (!href) return;
    const selected = await shopify.resourcePicker({ type: "product", multiple: true });
    if (!selected) return;

    const formData = new FormData();
    formData.set("intent", "set-target");
    for (const product of selected) {
      formData.append("productHandle", product.handle);
    }
    targetFetcher.submit(formData, { method: "post", action: href });
  };

  const handleClearTarget = () => {
    if (!href) return;
    const formData = new FormData();
    formData.set("intent", "clear-target");
    targetFetcher.submit(formData, { method: "post", action: href });
  };

  return (
    <Modal ref={modalRef} title={widget?.name ?? "Widget"} onClose={onClose}>
      {!detailWidget ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink">Type: {detailWidget.type}</p>

          {editFetcher.data?.error && (
            <p className="text-sm text-critical">{editFetcher.data.error}</p>
          )}
          <editFetcher.Form method="post" action={href!} className="flex flex-col gap-4">
            <TextField label="Name" name="name" defaultValue={detailWidget.name} required />
            <Checkbox label="Published" name="published" defaultChecked={detailWidget.published} />
            <div>
              <Button type="submit" variant="primary" loading={editFetcher.state !== "idle"}>
                Save
              </Button>
            </div>
          </editFetcher.Form>

          <div className="flex flex-col gap-3">
            {targetFetcher.data?.error && (
              <p className="text-sm text-critical">{targetFetcher.data.error}</p>
            )}
            {targetRule?.type === "all_products" ? (
              <p className="text-sm text-ink">Showing on all products.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm text-ink">Targeting {currentHandles.length} product(s):</p>
                {currentHandles.map((handle) => (
                  <p key={handle} className="text-sm text-muted">
                    {handle}
                  </p>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={handlePickProducts}
                loading={targetFetcher.state !== "idle"}
              >
                Choose products
              </Button>
              {targetRule?.type === "handles" && (
                <Button variant="ghost" onClick={handleClearTarget}>
                  Target all products instead
                </Button>
              )}
            </div>
          </div>

          {(detailWidget.type === "SINGLE_VIDEO" || detailWidget.type === "REEL_POPS") && (
            <div className="flex flex-col gap-3">
              {featuredReelFetcher.data?.error && (
                <p className="text-sm text-critical">{featuredReelFetcher.data.error}</p>
              )}
              <p className="text-sm text-ink">
                Featured reel:{" "}
                {(() => {
                  const featuredReelId = (detailWidget.config as unknown as WidgetConfig)
                    .featuredReelId;
                  const reels = detailFetcher.data?.reels ?? [];
                  const featured = reels.find((r) => r.id === featuredReelId);
                  return featured ? featured.title : "None chosen yet";
                })()}
              </p>
              <featuredReelFetcher.Form method="post" action={href!} className="flex flex-col gap-3">
                <input type="hidden" name="intent" value="set-featured-reel" />
                <Select label="Choose reel" name="featuredReelId" required>
                  {(detailFetcher.data?.reels ?? []).map((reel) => (
                    <option key={reel.id} value={reel.id}>
                      {reel.title}
                    </option>
                  ))}
                </Select>
                <div>
                  <Button
                    type="submit"
                    variant="secondary"
                    loading={featuredReelFetcher.state !== "idle"}
                  >
                    Save featured reel
                  </Button>
                </div>
              </featuredReelFetcher.Form>
            </div>
          )}

          {(detailWidget.type === "PRODUCT_PAGE_REELS" ||
            detailWidget.type === "CAROUSEL" ||
            detailWidget.type === "STORIES") && (
            <div className="flex flex-col gap-3">
              {reelsFetcher.data?.error && (
                <p className="text-sm text-critical">{reelsFetcher.data.error}</p>
              )}
              <p className="text-sm text-ink">
                Reels shown by this widget (same set on every targeted product page):
              </p>
              <reelsFetcher.Form method="post" action={href!} className="flex flex-col gap-3">
                <input type="hidden" name="intent" value="set-reels" />
                <div className="flex flex-col gap-2">
                  {(detailFetcher.data?.reels ?? []).map((reel) => (
                    <Checkbox
                      key={reel.id}
                      label={reel.title}
                      name="reelId"
                      value={reel.id}
                      defaultChecked={(
                        (detailWidget.config as unknown as WidgetConfig).reelIds ?? []
                      ).includes(reel.id)}
                    />
                  ))}
                </div>
                <div>
                  <Button
                    type="submit"
                    variant="secondary"
                    loading={reelsFetcher.state !== "idle"}
                  >
                    Save reels
                  </Button>
                </div>
              </reelsFetcher.Form>
            </div>
          )}

          <deleteFetcher.Form
            method="post"
            action={href ?? undefined}
            onSubmit={(e) => {
              // Don't call onClose() here — it sets selectedWidgetId to
              // null synchronously, which can flip href to null before/while
              // the fetcher reads this form's action, sending the delete
              // POST for the wrong (or no) id and 404ing (confirmed live).
              // The modal closes naturally once the widget disappears from
              // the revalidated list after the delete redirect completes.
              if (!confirm("Delete this widget? This can't be undone.")) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="intent" value="delete" />
            <Button type="submit" variant="critical" loading={deleteFetcher.state !== "idle"}>
              Delete widget
            </Button>
          </deleteFetcher.Form>
        </div>
      )}
    </Modal>
  );
}

function CreateWidgetSection({
  actionData,
  isSubmitting,
}: {
  actionData: { error: string | null } | undefined;
  isSubmitting: boolean;
}) {
  const [selectedKind, setSelectedKind] = useState<WidgetKind>("PRODUCT_PAGE_REELS");

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-ink">Create a widget</h2>
      {actionData?.error && (
        <p className="mb-3 text-sm text-critical">{actionData.error}</p>
      )}
      <Form method="post" className="flex flex-col gap-4">
        <TextField label="Name" name="name" required />
        <input type="hidden" name="type" value={selectedKind} />
        <TemplatePicker value={selectedKind} onChange={setSelectedKind} />
        <div>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            Create widget
          </Button>
        </div>
      </Form>
    </section>
  );
}

export default function Widgets() {
  const { widgets } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const publishedCount = widgets.filter((w) => w.published).length;
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const selectedWidget = widgets.find((w) => w.id === selectedWidgetId) ?? null;

  return (
    <PageShell heading="Widgets">
      <div className="flex flex-wrap gap-4">
        <StatTile label="Total widgets" value={widgets.length} />
        <StatTile label="Published" value={publishedCount} />
      </div>

      <CreateWidgetSection actionData={actionData} isSubmitting={isSubmitting} />

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">All widgets</h2>
        {widgets.length === 0 ? (
          <p className="text-sm text-muted">No widgets yet. Create your first one above.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {widgets.map((widget) => (
              <WidgetCard key={widget.id} widget={widget} onOpen={(w) => setSelectedWidgetId(w.id)} />
            ))}
          </div>
        )}
      </section>

      <WidgetDetailModal widget={selectedWidget} onClose={() => setSelectedWidgetId(null)} />
    </PageShell>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

- [ ] **Step 2: Verify**

`npm run typecheck` — expected: no new errors.

In the dev server, exercise the full flow on `/app/widgets`: create one widget per template kind, open a widget card (modal shows type/edit form/target picker/featured-reel or choose-reels section depending on kind/delete), edit and save, choose target products then clear target, set a featured reel (SINGLE_VIDEO/REEL_POPS), check/save reels (PRODUCT_PAGE_REELS/CAROUSEL/STORIES), and delete a widget. Confirm delete still succeeds without a 404.

- [ ] **Step 3: Commit**

```bash
git add app/routes/app.widgets.tsx
git commit -m "refactor(admin): rebuild widgets page on Tailwind primitives"
```

---

### Task 11: Remove the now-unused Polaris web component types dependency check

**Files:**
- Modify: none (verification-only task)

**Interfaces:** none.

- [ ] **Step 1: Confirm no `s-*` element remains**

Run (from repo root):
```bash
grep -rn "<s-" app/routes/app.tsx app/routes/app._index.tsx app/routes/app.reels.tsx app/routes/app.widgets.tsx
```
Expected: no output. If any match remains, it's a task from this plan that didn't fully replace its file — fix it before proceeding.

- [ ] **Step 2: Full project typecheck and lint**

```bash
npm run typecheck
npm run lint
```
Expected: both clean (lint may report pre-existing warnings unrelated to this plan's files — only new errors/warnings in the four rewritten routes or the nine new `app/components/ui/*` files block this task).

- [ ] **Step 3: Full manual walkthrough**

Run the dev server and click through, in order: `/app` (stat tiles, both nav cards) → `/app/reels` (create, upload, open/edit/tag/delete a reel) → `/app/widgets` (create one of each template kind, open/edit/target/featured-reel-or-reels/delete a widget). Confirm every screen visually reads as one consistent Tailwind design system (no leftover Polaris chrome, no unstyled native form controls) and every fetcher action still works.

- [ ] **Step 4: Commit (only if Step 1 or 2 required a fix)**

If no fixes were needed, skip committing — this task is verification-only.
