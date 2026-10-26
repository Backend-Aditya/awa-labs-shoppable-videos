import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import type { DragEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useNavigate, useRevalidator, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getReel, listReels, setReelPublished } from "../models/reel.server";
import { mapLimit } from "../lib/concurrency";
import { log } from "../lib/logger.server";
import { deriveReelStatus } from "../models/reel-status";
import { healProcessingReels } from "../models/reel-media.server";
import { releaseStreamAssets } from "../models/stream-assets.server";
import { deleteReelEverywhere } from "../models/reel-lifecycle.server";
import { getOrCreateShop } from "../models/shop.server";
import { getViewCountsByReel, reelKey } from "../models/analytics.server";
import { animatedPreviewUrl, formatDuration } from "../models/reel-media";
import { classifyImportLink } from "../models/video-link";
import {
  importReel,
  isVideoFile,
  titleFromFilename,
  uploadNewReel,
  validateVideoFile,
} from "../components/reels/upload";
import styles from "../components/reels/reels.module.css";
import { handleRovingKeys } from "../components/widget-editor/controls";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const [reels, views] = await Promise.all([listReels(admin), getViewCountsByReel(shop.id)]);
  const healed = await healProcessingReels(admin, reels, 6, (uids) => releaseStreamAssets(admin, shop.id, uids));
  return {
    reels: healed.map((reel) => ({
      id: reel.id,
      key: reelKey(reel.id),
      title: reel.title,
      published: reel.published,
      status: deriveReelStatus(reel.config),
      replacing: Boolean(reel.config.replacingStreamUid),
      posterUrl: reel.config.posterUrl ?? null,
      coverTime: reel.config.coverTimeSeconds ?? 0,
      duration: reel.config.durationSeconds ?? 0,
      productCount: reel.config.productIds?.length ?? 0,
      source: reel.config.source?.type ?? "upload",
      views: views[reelKey(reel.id)] ?? 0,
    })),
  };
};

type LibraryReel = ReturnType<typeof useLoaderData<typeof loader>>["reels"][number];

const REEL_GID = /^gid:\/\/shopify\/Metaobject\/\d+$/;
const BULK_LIMIT = 100;

type BulkResult = { ok: boolean; error: string | null; message: string | null; failedIds: string[] };

export const action = async ({ request }: ActionFunctionArgs): Promise<BulkResult> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const ids = [...new Set(formData.getAll("reelId").map(String))].filter((id) => REEL_GID.test(id));

  if (ids.length === 0) return { ok: false, error: "Select at least one video.", message: null, failedIds: [] };
  if (ids.length > BULK_LIMIT) {
    return { ok: false, error: `Select up to ${BULK_LIMIT} videos at a time.`, message: null, failedIds: [] };
  }

  const run = async (task: (id: string) => Promise<void>) => {
    const results = await mapLimit(ids, 4, task);
    const failedIds = ids.filter((_, i) => results[i].status === "rejected");
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        if (r.reason instanceof Response) throw r.reason;
        log.error("reels.bulk_item_failed", { shop: session.shop, intent, reelId: ids[i] }, r.reason);
      }
    });
    return failedIds;
  };

  const plural = (n: number) => `${n} video${n === 1 ? "" : "s"}`;

  if (intent === "bulk-publish" || intent === "bulk-unpublish") {
    const published = intent === "bulk-publish";
    const failedIds = await run(async (id) => {
      const reel = await getReel(admin, id);
      if (reel && reel.published !== published) await setReelPublished(admin, reel.handle, published);
    });
    const done = ids.length - failedIds.length;
    return failedIds.length
      ? { ok: false, error: `${plural(failedIds.length)} couldn't be updated. They're still selected. Try again.`, message: null, failedIds }
      : { ok: true, error: null, message: `${plural(done)} ${published ? "published" : "unpublished"}`, failedIds };
  }

  if (intent === "bulk-delete") {
    const failedIds = await run(async (id) => {
      const reel = await getReel(admin, id);
      if (reel) await deleteReelEverywhere(admin, shop.id, reel);
    });
    const done = ids.length - failedIds.length;
    return failedIds.length
      ? { ok: false, error: `${plural(failedIds.length)} couldn't be deleted. They're still selected. Try again.`, message: null, failedIds }
      : { ok: true, error: null, message: `${plural(done)} deleted`, failedIds };
  }

  return { ok: false, error: "Unknown request", message: null, failedIds: [] };
};

/* ------------------------------------------------------------------ page */

type Filter = "all" | "live" | "draft" | "processing" | "untagged" | "failed";
type Sort = "newest" | "oldest" | "views" | "title";

const FILTERS: { id: Filter; label: string; test: (r: LibraryReel) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "live", label: "Live", test: (r) => r.published && r.status === "ready" },
  { id: "draft", label: "Drafts", test: (r) => !r.published },
  { id: "processing", label: "Processing", test: (r) => r.status === "processing" || r.replacing },
  { id: "untagged", label: "No products", test: (r) => r.productCount === 0 },
  { id: "failed", label: "Failed", test: (r) => r.status === "failed" },
];

const numericId = (key: string) => Number(key) || 0;

export default function ReelsLibrary() {
  const { reels } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const bulkFetcher = useFetcher<typeof action>();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLElementTagNameMap["s-search-field"]>(null);
  // "/" jumps to search from anywhere on the page (unless typing already);
  // Escape in the box clears it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, s-search-field, s-text-field, s-select, [contenteditable='true']")) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  // Enter/leave fire for every child element crossed; count them so the
  // overlay only clears when the pointer really leaves the page area.
  const dragDepth = useRef(0);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("reelup-library-view");
      if (saved === "list" || saved === "grid") setView(saved);
    } catch {
      // ignore
    }
  }, []);

  // The selection stays (with the bar showing progress) until the result
  // arrives; anything that failed stays selected so it can be retried.
  useEffect(() => {
    if (bulkFetcher.state !== "idle" || !bulkFetcher.data) return;
    const result = bulkFetcher.data;
    if (result.ok && result.message) shopify.toast.show(result.message);
    else if (result.error) shopify.toast.show(result.error, { isError: true });
    setSelected(new Set(result.failedIds ?? []));
  }, [bulkFetcher.state, bulkFetcher.data, shopify]);

  // Selection survives filtering but forgets reels that no longer exist.
  useEffect(() => {
    setSelected((prev) => new Set([...prev].filter((id) => reels.some((r) => r.id === id))));
  }, [reels]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, reels.filter(f.test).length])), [reels]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const test = FILTERS.find((f) => f.id === filter)!.test;
    const list = reels.filter((r) => test(r) && (!q || r.title.toLowerCase().includes(q)));
    const sorted = [...list];
    if (sort === "newest") sorted.sort((a, b) => numericId(b.key) - numericId(a.key));
    if (sort === "oldest") sorted.sort((a, b) => numericId(a.key) - numericId(b.key));
    if (sort === "views") sorted.sort((a, b) => b.views - a.views);
    if (sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
    return sorted;
  }, [reels, query, filter, sort]);

  const setViewMode = (mode: "grid" | "list") => {
    setView(mode);
    try {
      localStorage.setItem("reelup-library-view", mode);
    } catch {
      // ignore
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = (intent: "bulk-publish" | "bulk-unpublish" | "bulk-delete") => {
    const formData = new FormData();
    formData.set("intent", intent);
    selected.forEach((id) => formData.append("reelId", id));
    bulkFetcher.submit(formData, { method: "post" });
  };
  const bulkBusy = bulkFetcher.state !== "idle";
  const [deleteCount, setDeleteCount] = useState(0);

  const open = (reel: LibraryReel) => navigate(`/app/reels/${reel.key}`);

  const openUpload = (files: File[] = []) => {
    setPendingFiles(files);
    shopify.modal.show("upload-modal");
  };

  // Links elsewhere in the app (Home's "Upload videos") land here with
  // ?upload=1 to open the uploader straight away.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("upload") === "1") {
      openUpload();
      const next = new URLSearchParams(searchParams);
      next.delete("upload");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per arrival
  }, []);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const all = Array.from(event.dataTransfer.files);
    const files = all.filter(isVideoFile);
    if (files.length) openUpload(files);
    if (files.length < all.length) {
      shopify.toast.show(`${all.length - files.length} file${all.length - files.length === 1 ? " isn't a" : "s aren't"} video${all.length - files.length === 1 ? "" : "s"} and ${all.length - files.length === 1 ? "was" : "were"} skipped`, { isError: true });
    }
  };

  useEffect(() => {
    const reset = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
    };
  }, []);

  const hiddenSelected = [...selected].filter((id) => !shown.some((r) => r.id === id)).length;

  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));

  return (
    <s-page heading="Videos" inlineSize="large">
      <s-button slot="primary-action" variant="primary" onClick={() => openUpload()}>
        Upload videos
      </s-button>
      <s-button slot="secondary-actions" onClick={() => shopify.modal.show("import-modal")}>
        Import from link
      </s-button>

      <div
        className={styles.library}
        onDragEnter={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            dragDepth.current += 1;
            setDragging(true);
          }
        }}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={onDrop}
      >
        {dragging && (
          <div className={styles.dropOverlay} aria-hidden="true">
            <UploadIcon />
            <span>Drop videos to upload</span>
          </div>
        )}

        {reels.length === 0 ? (
          <EmptyLibrary onUpload={() => openUpload()} onImport={() => shopify.modal.show("import-modal")} />
        ) : (
          <>
            <div className={styles.toolbar}>
              <div className={styles.filters} role="group" aria-label="Filter videos">
                {FILTERS.filter((f) => f.id === "all" || f.id === filter || counts[f.id] > 0).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={filter === f.id}
                    className={styles.filter}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                    <span className={styles.filterCount}>{counts[f.id]}</span>
                  </button>
                ))}
              </div>
              <div className={styles.toolbarRight}>
                {/* Escape clears the search. The key event bubbles up from the web component. */}
                {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
                <div
                  className={styles.searchField}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && query) {
                      e.preventDefault();
                      setQuery("");
                    }
                  }}
                >
                  <s-search-field
                    ref={searchRef}
                    label="Search videos"
                    labelAccessibilityVisibility="exclusive"
                    placeholder="Search by title"
                    value={query}
                    onInput={(e: Event) => setQuery((e.currentTarget as HTMLInputElement).value)}
                  />
                </div>
                <div className={styles.sortField}>
                  <s-select
                    label="Sort"
                    labelAccessibilityVisibility="exclusive"
                    value={sort}
                    onInput={(e: Event) => setSort((e.currentTarget as HTMLSelectElement).value as Sort)}
                  >
                    <s-option value="newest">Newest</s-option>
                    <s-option value="oldest">Oldest</s-option>
                    <s-option value="views">Most viewed</s-option>
                    <s-option value="title">Title A to Z</s-option>
                  </s-select>
                </div>
                <div /* eslint-disable-line jsx-a11y/interactive-supports-focus -- roving tabindex: the chosen child is the tab stop */
                  className={styles.viewToggle}
                  role="radiogroup"
                  aria-label="Layout"
                  onKeyDown={(e) => handleRovingKeys(e, ["grid", "list"] as const, view, setViewMode)}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={view === "grid"}
                    tabIndex={view === "grid" ? 0 : -1}
                    aria-label="Grid"
                    onClick={() => setViewMode("grid")}
                  >
                    <GridIcon />
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={view === "list"}
                    tabIndex={view === "list" ? 0 : -1}
                    aria-label="List"
                    onClick={() => setViewMode("list")}
                  >
                    <ListIcon />
                  </button>
                </div>
              </div>
            </div>

            {shown.length === 0 ? (
              <div className={styles.noMatch}>
                <p>No videos match.</p>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  Clear search and filters
                </button>
              </div>
            ) : view === "grid" ? (
              <ul className={styles.grid}>
                {shown.map((reel) => (
                  <ReelTile
                    key={reel.id}
                    reel={reel}
                    selected={selected.has(reel.id)}
                    selecting={selected.size > 0}
                    onToggle={() => toggle(reel.id)}
                    onOpen={() => open(reel)}
                  />
                ))}
              </ul>
            ) : (
              <ReelTable
                reels={shown}
                selected={selected}
                allSelected={allShownSelected}
                onToggle={toggle}
                onToggleAll={() =>
                  setSelected(allShownSelected ? new Set() : new Set(shown.map((r) => r.id)))
                }
                onOpen={open}
              />
            )}
          </>
        )}

        {selected.size > 0 && (
          <div className={styles.bulkBar} role="region" aria-label="Bulk actions" aria-busy={bulkBusy}>
            <button type="button" className={styles.bulkClose} aria-label="Clear selection" onClick={() => setSelected(new Set())}>
              <CloseIcon />
            </button>
            <span className={styles.bulkCount} aria-live="polite">
              {bulkBusy ? `Working on ${selected.size}…` : `${selected.size} selected`}
              {!bulkBusy && hiddenSelected > 0 && <span className={styles.bulkHidden}> ({hiddenSelected} not shown)</span>}
            </span>
            {!allShownSelected && shown.length > selected.size && (
              <button type="button" className={styles.bulkLink} onClick={() => setSelected(new Set(shown.map((r) => r.id)))}>
                Select all {shown.length}
              </button>
            )}
            <span className={styles.bulkDivider} aria-hidden="true" />
            <BulkAction
              label="Publish"
              busyLabel="Publishing"
              icon={<EyeIcon />}
              disabled={bulkBusy}
              busy={bulkBusy && bulkFetcher.formData?.get("intent") === "bulk-publish"}
              onClick={() => bulk("bulk-publish")}
            />
            <BulkAction
              label="Unpublish"
              busyLabel="Unpublishing"
              icon={<EyeOffIcon />}
              disabled={bulkBusy}
              busy={bulkBusy && bulkFetcher.formData?.get("intent") === "bulk-unpublish"}
              onClick={() => bulk("bulk-unpublish")}
            />
            <BulkAction
              label="Delete"
              busyLabel="Deleting"
              icon={<TrashIcon />}
              danger
              disabled={bulkBusy}
              busy={bulkBusy && bulkFetcher.formData?.get("intent") === "bulk-delete"}
              onClick={() => {
                setDeleteCount(selected.size);
                shopify.modal.show("bulk-delete-modal");
              }}
            />
          </div>
        )}
      </div>

      <UploadModal initialFiles={pendingFiles} onClear={() => setPendingFiles([])} />
      <ImportModal />
      <s-modal id="bulk-delete-modal" heading={`Delete ${deleteCount} video${deleteCount === 1 ? "" : "s"}?`}>
        <s-paragraph>
          They&rsquo;ll be removed from your store, from any widget showing them, and from their tagged products. This
          can&rsquo;t be undone.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          onClick={() => {
            bulk("bulk-delete");
            shopify.modal.hide("bulk-delete-modal");
          }}
        >
          Delete
        </s-button>
        <s-button slot="secondary-actions" commandFor="bulk-delete-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

/* --------------------------------------------------------------- tiles */

function statusText(reel: LibraryReel) {
  if (reel.status === "failed") return "Upload failed";
  if (reel.status === "draft") return "No video";
  if (reel.status === "processing") return "Processing";
  if (reel.replacing) return "Replacing video";
  return reel.published ? "Live" : "Draft";
}

function StatusPill({ reel }: { reel: LibraryReel }) {
  if (reel.status === "failed") return <span className={styles.pill} data-tone="critical">Failed</span>;
  if (reel.status === "processing" || reel.status === "draft")
    return (
      <span className={styles.pill} data-tone="info">
        {reel.status === "draft" ? "No video" : <><span className={styles.spinner} aria-hidden="true" />Processing</>}
      </span>
    );
  if (reel.replacing)
    return (
      <span className={styles.pill} data-tone="info">
        <span className={styles.spinner} aria-hidden="true" />
        Replacing
      </span>
    );
  return reel.published ? (
    <span className={styles.pill} data-tone="success">Live</span>
  ) : (
    <span className={styles.pill}>Draft</span>
  );
}

function ReelTile({
  reel,
  selected,
  selecting,
  onToggle,
  onOpen,
}: {
  reel: LibraryReel;
  selected: boolean;
  selecting: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const [hovering, setHovering] = useState(false);
  const gif = hovering ? animatedPreviewUrl(reel.posterUrl ?? undefined, reel.coverTime) : null;
  return (
    <li className={styles.tile} data-selected={selected || undefined} data-selecting={selecting || undefined}>
      <button
        type="button"
        className={styles.tileOpen}
        onClick={selecting ? onToggle : onOpen}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
        aria-label={`${selecting ? "Select" : "Edit"} ${reel.title}. ${statusText(reel)}. ${
          reel.productCount === 0 ? "No products" : `${reel.productCount} product${reel.productCount === 1 ? "" : "s"}`
        }. ${reel.views} views.`}
      >
        <span className={styles.poster}>
          {reel.posterUrl ? (
            <img src={reel.posterUrl} alt="" loading="lazy" />
          ) : (
            <span className={styles.posterEmpty}>
              <VideoIcon />
            </span>
          )}
          {gif && <img className={styles.posterGif} src={gif} alt="" />}
          <span className={styles.tileTop}>
            <StatusPill reel={reel} />
          </span>
          {reel.duration > 0 && <span className={styles.duration}>{formatDuration(reel.duration)}</span>}
        </span>
        <span className={styles.tileBody}>
          <span className={styles.tileTitle}>{reel.title}</span>
          <span className={styles.tileMeta}>
            <span data-warn={reel.productCount === 0 || undefined}>
              {reel.productCount === 0 ? "No products" : `${reel.productCount} product${reel.productCount === 1 ? "" : "s"}`}
            </span>
            <span>{compact(reel.views)} views</span>
          </span>
        </span>
      </button>
      <label className={styles.tileCheck}>
        <input type="checkbox" checked={selected} onChange={onToggle} />
        <span className={styles.srOnly}>Select {reel.title}</span>
      </label>
    </li>
  );
}

function ReelTable({
  reels,
  selected,
  allSelected,
  onToggle,
  onToggleAll,
  onOpen,
}: {
  reels: LibraryReel[];
  selected: Set<string>;
  allSelected: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (reel: LibraryReel) => void;
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.checkCell}>
              <input type="checkbox" checked={allSelected} onChange={onToggleAll} aria-label="Select all" />
            </th>
            <th scope="col">Video</th>
            <th scope="col">Status</th>
            <th scope="col">Products</th>
            <th scope="col">Length</th>
            <th scope="col" className={styles.num}>Views</th>
          </tr>
        </thead>
        <tbody>
          {reels.map((reel) => (
            <tr key={reel.id} data-selected={selected.has(reel.id) || undefined}>
              <td className={styles.checkCell}>
                <input
                  type="checkbox"
                  checked={selected.has(reel.id)}
                  onChange={() => onToggle(reel.id)}
                  aria-label={`Select ${reel.title}`}
                />
              </td>
              <th scope="row">
                <button type="button" className={styles.rowOpen} onClick={() => onOpen(reel)}>
                  <span
                    className={styles.rowThumb}
                    style={reel.posterUrl ? { backgroundImage: `url("${reel.posterUrl}")` } : undefined}
                  />
                  <span className={styles.rowTitle}>{reel.title}</span>
                </button>
              </th>
              <td>
                <StatusPill reel={reel} />
              </td>
              <td data-warn={reel.productCount === 0 || undefined}>{reel.productCount || "None"}</td>
              <td>{formatDuration(reel.duration) || "-"}</td>
              <td className={styles.num}>{reel.views.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function compact(n: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function EmptyLibrary({ onUpload, onImport }: { onUpload: () => void; onImport: () => void }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyArt} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h2>Upload your first video</h2>
      <p>Drop video files anywhere on this page, or import one from a link (an Instagram or TikTok post, a video file or a Dropbox share). Tag the products it features and it&rsquo;s ready for any widget.</p>
      <div className={styles.emptyActions}>
        <s-button variant="primary" onClick={onUpload}>
          Upload videos
        </s-button>
        <s-button onClick={onImport}>Import from link</s-button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- upload */

type QueueItem = {
  id: string;
  file: File;
  title: string;
  state: "ready" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
  invalid?: string;
};

type PickedProduct = { id: string; title: string; imageUrl: string | null };

function useProductPicker() {
  const shopify = useAppBridge();
  const [products, setProducts] = useState<PickedProduct[]>([]);
  const pick = async () => {
    const result = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: products.map((p) => ({ id: p.id })),
    });
    if (!result) return;
    setProducts(
      result.map((p) => ({
        id: p.id,
        title: p.title,
        imageUrl: (p as { images?: { originalSrc?: string }[] }).images?.[0]?.originalSrc ?? null,
      })),
    );
  };
  return { products, setProducts, pick };
}

function ProductChips({ products, onPick, onRemove }: { products: PickedProduct[]; onPick: () => void; onRemove: (id: string) => void }) {
  return (
    <div className={styles.fieldBlock}>
      <div className={styles.fieldHead}>
        <span className={styles.fieldLabel}>Tag products</span>
        <button type="button" className={styles.linkButton} onClick={onPick}>
          {products.length ? "Edit" : "Choose products"}
        </button>
      </div>
      {products.length === 0 ? (
        <p className={styles.hint}>Optional. You can tag products later in each video.</p>
      ) : (
        <div className={styles.chips}>
          {products.map((p) => (
            <span key={p.id} className={styles.chip}>
              {p.imageUrl && <img src={p.imageUrl} alt="" />}
              {p.title}
              <button type="button" aria-label={`Remove ${p.title}`} onClick={() => onRemove(p.id)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadModal({ initialFiles, onClear }: { initialFiles: File[]; onClear: () => void }) {
  const shopify = useAppBridge();
  const { revalidate } = useRevalidator();
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [published, setPublished] = useState(true);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const { products, setProducts, pick } = useProductPicker();

  const addFiles = (files: File[]) =>
    setQueue((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        file,
        title: titleFromFilename(file.name),
        state: "ready" as const,
        progress: 0,
        invalid: validateVideoFile(file) ?? undefined,
      })),
    ]);

  useEffect(() => {
    if (initialFiles.length) {
      addFiles(initialFiles);
      onClear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles]);

  const update = (id: string, patch: Partial<QueueItem>) =>
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  // The upload loop reads titles from here so edits made while earlier
  // files upload are still used.
  const queueRef = useRef(queue);
  queueRef.current = queue;

  // Closing the tab mid-upload loses the file; warn first.
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const start = async () => {
    setRunning(true);
    let succeeded = 0;
    for (const { id } of queue) {
      const item = queueRef.current.find((q) => q.id === id);
      if (!item || item.state === "done" || item.invalid) continue;
      update(item.id, { state: "uploading", progress: 0, error: undefined });
      try {
        await uploadNewReel(
          item.file,
          { title: item.title.trim() || titleFromFilename(item.file.name), published, productIds: products.map((p) => p.id) },
          (progress) => update(item.id, { progress }),
        );
        update(item.id, { state: "done", progress: 1 });
        succeeded += 1;
      } catch (error) {
        // A failed upload leaves no half-made video behind (see upload.ts);
        // pressing Upload again retries it from scratch.
        update(item.id, { state: "error", error: error instanceof Error ? error.message : "Upload failed." });
      }
    }
    setRunning(false);
    if (succeeded > 0) {
      revalidate();
      shopify.toast.show(`${succeeded} video${succeeded === 1 ? "" : "s"} uploaded and processing`);
    }
  };

  const pending = queue.filter((q) => q.state !== "done" && !q.invalid).length;
  const allDone = queue.length > 0 && pending === 0 && queue.some((q) => q.state === "done");

  const reset = () => {
    if (running) return;
    setQueue([]);
    setProducts([]);
    setPublished(true);
  };

  return (
    <s-modal id="upload-modal" heading="Upload videos" size="large" onHide={reset}>
      <div className={styles.modalBody}>
        <button
          type="button"
          className={styles.dropzone}
          onClick={() => inputRef.current?.click()}
          data-drag={dragging || undefined}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={() => setDragging(true)}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragging(false);
            addFiles(Array.from(e.dataTransfer.files));
          }}
          disabled={running}
        >
          <span className={styles.dropIcon}>
            <UploadIcon />
          </span>
          <span className={styles.dropTitle}>Drop videos here or click to browse</span>
          <span className={styles.dropSub}>Select as many files as you like. They upload one at a time.</span>
          <span className={styles.dropFormats}>
            <span>MP4</span>
            <span>MOV</span>
            <span>WebM</span>
            <span>Up to 200 MB each</span>
            <span>Vertical 9:16 looks best</span>
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.currentTarget.files ?? []));
            e.currentTarget.value = "";
          }}
        />

        {queue.length > 0 && (
          <ul className={styles.queue}>
            {queue.map((item) => (
              <li key={item.id} className={styles.queueItem} data-state={item.state}>
                <span className={styles.queueIcon}>
                  {item.state === "done" ? <CheckIcon /> : <VideoIcon />}
                </span>
                <span className={styles.queueMain}>
                  <input
                    className={styles.queueTitle}
                    value={item.title}
                    aria-label={`Title for ${item.file.name}`}
                    disabled={item.state !== "ready" && item.state !== "error"}
                    onChange={(e) => update(item.id, { title: e.currentTarget.value })}
                  />
                  <span className={styles.queueMeta}>
                    {item.invalid ? (
                      <span data-error>{item.invalid}</span>
                    ) : item.state === "error" ? (
                      <span data-error>{item.error}</span>
                    ) : item.state === "uploading" ? (
                      `Uploading ${Math.round(item.progress * 100)}%`
                    ) : item.state === "done" ? (
                      "Uploaded and processing"
                    ) : (
                      `${item.file.name} · ${(item.file.size / 1024 / 1024).toFixed(1)} MB`
                    )}
                  </span>
                  {(item.state === "uploading" || item.state === "done") && (
                    <span className={styles.progress}>
                      <span style={{ transform: `scaleX(${item.progress})` }} />
                    </span>
                  )}
                </span>
                {!running && item.state !== "done" && (
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Remove ${item.title}`}
                    onClick={() => setQueue((prev) => prev.filter((q) => q.id !== item.id))}
                  >
                    <CloseIcon />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className={styles.optionsRow}>
          <ProductChips products={products} onPick={pick} onRemove={(id) => setProducts((p) => p.filter((x) => x.id !== id))} />
          <div className={styles.fieldBlock}>
            <label className={styles.switchRow} htmlFor="upload-publish">
              <span className={styles.fieldLabel}>Publish when ready</span>
              <input
                id="upload-publish"
                type="checkbox"
                className={styles.switch}
                checked={published}
                onChange={(e) => setPublished(e.currentTarget.checked)}
              />
            </label>
            <span className={styles.hint}>Live on your store as soon as processing finishes.</span>
          </div>
        </div>
      </div>
      {allDone ? (
        <s-button slot="primary-action" variant="primary" commandFor="upload-modal" command="--hide">
          Done
        </s-button>
      ) : (
        <s-button slot="primary-action" variant="primary" loading={running} disabled={pending === 0} onClick={start}>
          {pending > 1 ? `Upload ${pending} videos` : "Upload"}
        </s-button>
      )}
      <s-button slot="secondary-actions" commandFor="upload-modal" command="--hide" disabled={running}>
        {allDone ? "Close" : "Cancel"}
      </s-button>
    </s-modal>
  );
}

// A readable starting title: the file's name for a file link ("summer-drop
// .mp4" -> "summer drop"), otherwise "Instagram video" / "TikTok video".
function defaultImportTitle(link: ReturnType<typeof classifyImportLink>, platform: string | null) {
  if (link.kind === "file") {
    try {
      const last = decodeURIComponent(new URL(link.url).pathname.split("/").pop() ?? "");
      const name = last.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " ").trim();
      if (name) return name.slice(0, 120);
    } catch {
      // fall through
    }
  }
  return `${platform ?? "Imported"} video`;
}

function ImportModal() {
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [published, setPublished] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rights, setRights] = useState(false);
  const { products, setProducts, pick } = useProductPicker();
  const link = classifyImportLink(url);
  const importable = link.kind === "social" || link.kind === "file";
  const platform = link.kind === "social" ? (link.platform === "instagram" ? "Instagram" : "TikTok") : null;
  const hint =
    link.kind === "social"
      ? `${platform} post detected. It must be public.`
      : link.kind === "file"
        ? link.source === "dropbox"
          ? "Dropbox file detected. The video is downloaded straight from Dropbox."
          : "Video link detected. It must open or download the video file itself."
        : link.kind === "invalid"
          ? link.error
          : "A public Instagram or TikTok post, a link to a video file (MP4, MOV, WebM), or a Dropbox share link.";

  const submit = async () => {
    if (!importable || !rights || busy) return;
    setBusy(true);
    setError(null);
    try {
      const reelId = await importReel({
        sourceUrl: url.trim(),
        // Social posts are titled from their caption on the server.
        title: title.trim() || (link.kind === "file" ? defaultImportTitle(link, platform) : ""),
        published,
        productIds: products.map((p) => p.id),
      });
      shopify.modal.hide("import-modal");
      shopify.toast.show(link.kind === "file" ? "Importing your video. It will be ready shortly." : "Video imported and processing");
      navigate(`/app/reels/${reelId.split("/").pop()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <s-modal
      id="import-modal"
      heading="Import from a link"
      onHide={() => {
        if (busy) return;
        setUrl("");
        setTitle("");
        setError(null);
        setProducts([]);
        setPublished(true);
        setRights(false);
      }}
    >
      <form
        className={styles.modalBody}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error && <s-banner tone="critical">{error}</s-banner>}
        <label className={styles.fieldBlock}>
          <span className={styles.fieldLabel}>Video link</span>
          <input
            className={styles.input}
            type="url"
            placeholder="Instagram, TikTok, Dropbox or video file link"
            value={url}
            aria-invalid={link.kind === "invalid" || undefined}
            aria-describedby="import-link-hint"
            onChange={(e) => setUrl(e.currentTarget.value)}
          />
          <span id="import-link-hint" className={styles.hint} data-error={link.kind === "invalid" || undefined}>
            {hint}
          </span>
        </label>
        <label className={styles.fieldBlock}>
          <span className={styles.fieldLabel}>Title</span>
          <input
            className={styles.input}
            value={title}
            placeholder={link.kind === "social" ? "Leave empty to use the post's caption" : "Shown in the video player"}
            onChange={(e) => setTitle(e.currentTarget.value)}
          />
        </label>
        <ProductChips products={products} onPick={pick} onRemove={(id) => setProducts((p) => p.filter((x) => x.id !== id))} />
        <label className={styles.switchRow} htmlFor="import-publish">
          <span className={styles.fieldLabel}>Publish when ready</span>
          <input
            id="import-publish"
            type="checkbox"
            className={styles.switch}
            checked={published}
            onChange={(e) => setPublished(e.currentTarget.checked)}
          />
        </label>
        <label className={styles.rightsRow} htmlFor="import-rights">
          <input id="import-rights" type="checkbox" checked={rights} onChange={(e) => setRights(e.currentTarget.checked)} />
          <span>I own this video or have permission to use it on my store.</span>
        </label>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
      <s-button slot="primary-action" variant="primary" loading={busy} disabled={!importable || !rights} onClick={submit}>
        Import video
      </s-button>
      <s-button slot="secondary-actions" commandFor="import-modal" command="--hide" disabled={busy}>
        Cancel
      </s-button>
    </s-modal>
  );
}

/* --------------------------------------------------------------- icons */

function BulkAction({
  label,
  busyLabel,
  icon,
  danger,
  disabled,
  busy,
  onClick,
}: {
  label: string;
  busyLabel: string;
  icon: ReactNode;
  danger?: boolean;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.bulkAction} data-danger={danger || undefined} disabled={disabled} onClick={onClick}>
      {busy ? <span className={styles.bulkSpin} aria-hidden="true" /> : icon}
      <span className={styles.bulkLabel}>{busy ? `${busyLabel}…` : label}</span>
    </button>
  );
}

const bulkIcon = {
  width: 16,
  height: 16,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function EyeIcon() {
  return (
    <svg {...bulkIcon}>
      <path d="M1.5 10S4.500 4 10 4s8.500 6 8.500 6-3 6-8.500 6S1.500 10 1.500 10Z" />
      <circle cx="10" cy="10" r="2.500" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg {...bulkIcon}>
      <path d="M1.5 10S4.500 4 10 4s8.500 6 8.500 6-3 6-8.500 6S1.500 10 1.500 10Z" />
      <circle cx="10" cy="10" r="2.500" />
      <path d="M3 3l14 14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg {...bulkIcon}>
      <path d="M4 6h12M8 6V4h4v2M6 6l.700 10h6.600L14 6M8.500 9v4M11.500 9v4" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </svg>
  );
}
function VideoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M4.5 4A1.5 1.5 0 0 0 3 5.5v9A1.5 1.5 0 0 0 4.5 16h8a1.5 1.5 0 0 0 1.5-1.5v-2.2l2.7 1.8a.75.75 0 0 0 1.17-.62V6.52a.75.75 0 0 0-1.17-.62L14 7.7V5.5A1.5 1.5 0 0 0 12.5 4h-8Z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m3.5 8.3 3 2.9 6-6.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M5.72 5.72a.75.75 0 0 1 1.06 0L10 8.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L11.06 10l3.22 3.22a.75.75 0 1 1-1.06 1.06L10 11.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L8.94 10 5.72 6.78a.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="2" y="3" width="12" height="2" rx="1" />
      <rect x="2" y="7" width="12" height="2" rx="1" />
      <rect x="2" y="11" width="12" height="2" rx="1" />
    </svg>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
