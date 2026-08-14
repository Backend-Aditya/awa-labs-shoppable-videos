import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
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
  const config = widget.config as unknown as WidgetConfig;
  const kind = widget.type as WidgetKind;
  const meta = WIDGET_TEMPLATES.find((t) => t.kind === kind);
  const targetRule = config.targetRule;
  const handleCount = targetRule?.type === "handles" ? targetRule.handles.length : 0;
  const targetSummary =
    targetRule?.type === "all_products"
      ? "All products"
      : `${handleCount} product${handleCount === 1 ? "" : "s"}`;
  const reelCount = config.reelIds?.length ?? 0;
  const hasFeaturedReel = Boolean(config.featuredReelId);
  const showsFeaturedReel = kind === "SINGLE_VIDEO" || kind === "REEL_POPS";
  const showsReelCount = kind === "PRODUCT_PAGE_REELS" || kind === "CAROUSEL" || kind === "STORIES";

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
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface">
          <TemplateIcon kind={kind} />
        </div>
        <div className="min-w-0 text-left">
          <div className="truncate font-semibold text-ink">{widget.name}</div>
          <div className="truncate text-xs text-muted">{meta?.name ?? widget.type}</div>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Badge tone={widget.published ? "success" : "neutral"}>
          {widget.published ? "Published" : "Draft"}
        </Badge>
        <Badge tone="neutral">{targetSummary}</Badge>
      </div>
      {(showsFeaturedReel || showsReelCount) && (
        <div className="text-xs text-muted">
          {showsFeaturedReel && (hasFeaturedReel ? "Featured reel set" : "No featured reel yet")}
          {showsReelCount && `${reelCount} reel${reelCount === 1 ? "" : "s"} selected`}
        </div>
      )}
    </button>
  );
}

function TemplateIcon({ kind }: { kind: WidgetKind }) {
  const common = "h-6 w-6 text-primary";
  switch (kind) {
    case "PRODUCT_PAGE_REELS":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="3" y="6" width="4" height="12" rx="1" />
          <rect x="10" y="6" width="4" height="12" rx="1" />
          <rect x="17" y="6" width="4" height="12" rx="1" />
        </svg>
      );
    case "SINGLE_VIDEO":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="5" y="4" width="14" height="16" rx="2" />
          <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "CAROUSEL":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="2" y="7" width="5" height="10" rx="1" />
          <rect x="9.5" y="5" width="5" height="14" rx="1" />
          <rect x="17" y="7" width="5" height="10" rx="1" />
        </svg>
      );
    case "STORIES":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="7" cy="12" r="4" />
          <circle cx="17" cy="12" r="4" />
        </svg>
      );
    case "REEL_POPS":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="12" cy="12" r="7" />
          <circle cx="17" cy="7" r="2" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return null;
  }
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
          <div className="mb-2 flex h-14 items-center justify-center rounded-md bg-surface">
            <TemplateIcon kind={template.kind} />
          </div>
          <div className="text-sm font-semibold text-ink">{template.name}</div>
          <div className="text-xs text-muted">{template.description}</div>
        </button>
      ))}
    </div>
  );
}

function CreateWidgetModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const modalRef = useRef<ModalHandle>(null);
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";
  const [selectedKind, setSelectedKind] = useState<WidgetKind>("PRODUCT_PAGE_REELS");

  useEffect(() => {
    if (open) {
      modalRef.current?.show();
    } else {
      modalRef.current?.hide();
    }
  }, [open]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return (
    <Modal ref={modalRef} title="Create a widget" onClose={onClose}>
      <fetcher.Form method="post" className="flex flex-col gap-4">
        {fetcher.data?.error && (
          <p className="text-sm text-critical">{fetcher.data.error}</p>
        )}
        <TextField label="Name" name="name" required />
        <input type="hidden" name="type" value={selectedKind} />
        <TemplatePicker value={selectedKind} onChange={setSelectedKind} />
        <div>
          <Button type="submit" variant="primary" loading={isSubmitting}>
            Create widget
          </Button>
        </div>
      </fetcher.Form>
    </Modal>
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
        <div className="flex flex-col">
          <div className="flex flex-col gap-4 pb-6">
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
          </div>

          <div className="flex flex-col gap-3 border-t border-border py-6">
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
            <div className="flex flex-col gap-3 border-t border-border py-6">
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
            <div className="flex flex-col gap-3 border-t border-border py-6">
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

          <div className="border-t border-border pt-6">
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
        </div>
      )}
    </Modal>
  );
}

export default function Widgets() {
  const { widgets } = useLoaderData<typeof loader>();
  const publishedCount = widgets.filter((w) => w.published).length;
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const selectedWidget = widgets.find((w) => w.id === selectedWidgetId) ?? null;

  return (
    <PageShell
      heading="Widgets"
      description="Control where and how your reels appear on the storefront."
      actions={
        <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
          Create widget
        </Button>
      }
    >
      <div className="grid max-w-md grid-cols-2 gap-4">
        <StatTile label="Total widgets" value={widgets.length} />
        <StatTile label="Published" value={publishedCount} />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">All widgets</h2>
        {widgets.length === 0 ? (
          <p className="text-sm text-muted">No widgets yet. Use Create widget to add your first one.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {widgets.map((widget) => (
              <WidgetCard key={widget.id} widget={widget} onOpen={(w) => setSelectedWidgetId(w.id)} />
            ))}
          </div>
        )}
      </section>

      <CreateWidgetModal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <WidgetDetailModal widget={selectedWidget} onClose={() => setSelectedWidgetId(null)} />
    </PageShell>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
