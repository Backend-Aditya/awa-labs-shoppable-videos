# Storefront Widget: Product Page Reels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the storefront its first real shoppable-video widget — a Product page reels block that a merchant adds via the theme editor, which renders every published, ready reel tagged to that product, playing directly from Cloudflare Stream via a custom lightweight player (no iframe embed).

**Architecture:** A Shopify Theme App Extension (Liquid + vanilla JS + CSS, deployed alongside the app, separate from the React Router admin). The block reads the product's tagged reels directly via a metaobject-reference metafield — resolved entirely server-side by Shopify's own Liquid engine at page-render time, zero runtime API calls, exactly the architecture the Foundation plan's schema was built for. Video playback uses a native `<video>` element pointed at Cloudflare's HLS manifest URL, with `hls.js` loaded only for browsers lacking native HLS support (Safari doesn't need it) — a deliberate choice over Cloudflare's iframe embed, matching this project's "actually fast, not just claims it" positioning from the original competitive analysis.

**Tech Stack:** Shopify Theme App Extension (`shopify app generate extension --template theme_app_extension`), Liquid, vanilla JS (no framework — theme app extensions don't get the main app's Vite/React toolchain), `hls.js` (vendored as a static asset, not CDN-loaded), IntersectionObserver for lazy playback.

## Global Constraints

**Everything below marked "confirmed live" was verified empirically against the actual running app and a real product during planning — not assumed from documentation, which turned out to have gaps/conflicting community reports on exactly this mechanism.**

- **Metafield access (confirmed live):** the working Liquid access pattern is `product.metafields['app--404281098241'].reels`, NOT `$app`, NOT `app`, NOT any bracket-combined `$app:reels` string. `app--404281098241` is this specific app's resolved numeric Partner-app ID (matches the ID seen in earlier Admin GraphQL "no metaobject definition" errors) — it is a magic number tied to this one app installation, not something computed or portable. Define it ONCE as a Liquid variable at the top of a shared snippet; never repeat the literal string in more than one place.
- **Metaobject field access (confirmed live):** `reel.title.value`, `reel.published.value`, `reel.config.value` (the JSON config, with nested keys directly accessible, e.g. `reel.config.value.cloudflareStreamUid`) — NOT `reel.fields.title.value`. `reel.system.type` / `reel.system.handle` give the metaobject's type/handle if needed.
- **Product context in a theme-app-extension block:** there is no bare global `product` object automatically available. The block's `{% schema %}` must declare `{ "type": "product", "id": "product", "label": "...", "autofill": true }`, and the block accesses it as `block.settings.product`.
- **Only render reels where `published.value == true` AND `config.value.cloudflareStreamUid` is present** (i.e., the Cloudflare upload actually completed) — skip drafts and in-progress uploads.
- **Cloudflare playback URL (confirmed via Cloudflare's own API reference):** `GET /accounts/{account_id}/stream/{uid}`'s response includes `result.playback.hls` — a complete, ready-to-use HLS manifest URL that already includes Cloudflare's customer-specific subdomain (`https://customer-<code>.cloudflarestream.com/<uid>/manifest/video.m3u8`). Use this returned URL directly; never hand-construct it, since the customer subdomain code isn't derivable from the account ID or UID alone.
- **Player approach — deliberate, considered exception to the general "don't reference external libraries" default:** native `<video>` + `hls.js`, vendored as a static file in the extension's own `assets/` folder (not loaded from a public CDN, to avoid an external network dependency and match this project's performance stance). `hls.js` is loaded conditionally — only for browsers without native HLS support (`video.canPlayType('application/vnd.apple.mpegurl')` is falsy). This is a genuine technical requirement (implementing HLS/MSE parsing from scratch is out of all proportion to this task), not a casual dependency pull.
- **Liquid/JS boundary:** `{% javascript %}`/`{% stylesheet %}` tags do not render Liquid inside them — any per-reel data (HLS URL, poster URL, product/reel IDs) must be passed to JS via `data-*` attributes on the HTML, read by plain JS at runtime.
- **No analytics/event tracking in this plan** — pure rendering only. View/click tracking is a dedicated later plan covering all widget types at once.
- **No feature work beyond spec:** one widget type (Product page reels), no carousel/grid/stories/pop variants, no A/B testing, no merchant-configurable styling options beyond what's in the task list below.

---

## File Structure

- `app/models/cloudflare-stream.server.ts` — modify: add `playback: { hls: string | null; dash: string | null }` to `VideoDetails`.
- `app/models/cloudflare-stream.server.test.ts` — modify: extend the `getVideoDetails` test to cover the new field.
- `app/models/reel.server.ts` — modify: add `hlsManifestUrl?: string` and `dashManifestUrl?: string` to `ReelConfig`.
- `app/routes/webhooks.cloudflare-stream.tsx` — modify: pass the new playback URLs into `updateReelConfig`.
- `extensions/shoppable-video-widgets/shopify.extension.toml` — create: via CLI scaffold.
- `extensions/shoppable-video-widgets/blocks/product-page-reels.liquid` — create: the app block (schema, markup, `{% stylesheet %}`).
- `extensions/shoppable-video-widgets/assets/product-page-reels.js` — create: vanilla JS player (lazy-load, hls.js conditional load, playback control).
- `extensions/shoppable-video-widgets/assets/hls.min.js` — create: vendored `hls.js` distribution file.
- `extensions/shoppable-video-widgets/snippets/reel-namespace.liquid` — create: the shared one-line constant for the app namespace, per the Global Constraints note above.
- `extensions/shoppable-video-widgets/locales/en.default.json` — modify: replace demo strings with this widget's own.

---

### Task 1: Capture Cloudflare's playback URLs through the existing ingestion pipeline

**Files:**
- Modify: `app/models/cloudflare-stream.server.ts`
- Modify: `app/models/cloudflare-stream.server.test.ts`
- Modify: `app/models/reel.server.ts`
- Modify: `app/routes/webhooks.cloudflare-stream.tsx`

**Interfaces:**
- Modifies: `VideoDetails` (adds `playback` field), `ReelConfig` (adds `hlsManifestUrl`/`dashManifestUrl`) — both already exported from their respective files, consumed downstream by the theme extension (via the metaobject's `config` JSON, not directly — Liquid never imports TS types, this just documents the shape that ends up in the stored JSON).

- [ ] **Step 1: Write the failing test**

In `app/models/cloudflare-stream.server.test.ts`, update the existing `"fetches video details and normalizes the response shape"` test to include the new field:

```ts
  it("fetches video details and normalizes the response shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe(
          "https://api.cloudflare.com/client/v4/accounts/acct123/stream/abc123",
        );
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          "Bearer token123",
        );
        return {
          json: async () => ({
            success: true,
            errors: [],
            messages: [],
            result: {
              uid: "abc123",
              status: { state: "ready" },
              readyToStream: true,
              duration: 12.5,
              thumbnail: "https://videodelivery.net/abc123/thumbnails/thumbnail.jpg",
              meta: { reelId: "gid://shopify/Metaobject/1" },
              playback: {
                hls: "https://customer-abc.cloudflarestream.com/abc123/manifest/video.m3u8",
                dash: "https://customer-abc.cloudflarestream.com/abc123/manifest/video.mpd",
              },
            },
          }),
        };
      }),
    );

    const details = await getVideoDetails(config, "abc123");
    expect(details).toEqual({
      uid: "abc123",
      state: "ready",
      readyToStream: true,
      duration: 12.5,
      thumbnail: "https://videodelivery.net/abc123/thumbnails/thumbnail.jpg",
      meta: { reelId: "gid://shopify/Metaobject/1" },
      playback: {
        hls: "https://customer-abc.cloudflarestream.com/abc123/manifest/video.m3u8",
        dash: "https://customer-abc.cloudflarestream.com/abc123/manifest/video.mpd",
      },
    });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — the actual `details` object won't have a `playback` key yet.

- [ ] **Step 3: Write the implementation**

In `app/models/cloudflare-stream.server.ts`, update the `VideoDetails` interface:

```ts
export interface VideoDetails {
  uid: string;
  state:
    | "pendingupload"
    | "downloading"
    | "queued"
    | "inprogress"
    | "ready"
    | "error";
  readyToStream: boolean;
  duration: number | null;
  thumbnail: string | null;
  meta: Record<string, string>;
  playback: { hls: string | null; dash: string | null };
}
```

Update `getVideoDetails`'s response-parsing type and return value:

```ts
export async function getVideoDetails(
  config: CloudflareStreamConfig,
  uid: string,
): Promise<VideoDetails> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/stream/${uid}`,
    {
      headers: { Authorization: `Bearer ${config.apiToken}` },
    },
  );

  const json = (await response.json()) as CloudflareApiResponse<{
    uid: string;
    status: { state: VideoDetails["state"] };
    readyToStream: boolean;
    duration: number;
    thumbnail: string;
    meta: Record<string, string>;
    playback?: { hls?: string; dash?: string };
  }>;
  throwOnCloudflareErrors(json);

  return {
    uid: json.result.uid,
    state: json.result.status.state,
    readyToStream: json.result.readyToStream,
    duration: json.result.duration >= 0 ? json.result.duration : null,
    thumbnail: json.result.thumbnail ?? null,
    meta: json.result.meta ?? {},
    playback: {
      hls: json.result.playback?.hls ?? null,
      dash: json.result.playback?.dash ?? null,
    },
  };
}
```

In `app/models/reel.server.ts`, update `ReelConfig`:

```ts
export interface ReelConfig {
  cloudflareStreamUid?: string;
  posterUrl?: string;
  durationSeconds?: number;
  hlsManifestUrl?: string;
  dashManifestUrl?: string;
  productIds: string[];
  interactions: { ctaLabel?: string; ctaUrl?: string };
  source: { type: "upload" | "instagram" | "tiktok"; originalUrl?: string };
}
```

In `app/routes/webhooks.cloudflare-stream.tsx`, update the `updateReelConfig` call to also pass the playback URLs:

```ts
    await updateReelConfig(admin, reelId, {
      cloudflareStreamUid: payload.uid,
      posterUrl: details.thumbnail ?? undefined,
      durationSeconds: details.duration ?? undefined,
      hlsManifestUrl: details.playback.hls ?? undefined,
      dashManifestUrl: details.playback.dash ?? undefined,
    });
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS — all tests across all 4 model test files green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 6: Commit**

```bash
git add app/models/cloudflare-stream.server.ts app/models/cloudflare-stream.server.test.ts app/models/reel.server.ts app/routes/webhooks.cloudflare-stream.tsx
git commit -m "feat(storefront): capture Cloudflare playback URLs through the ingestion pipeline"
```

---

### Task 2: Scaffold the theme app extension and build the block markup

**Files:**
- Create: `extensions/shoppable-video-widgets/` (via CLI)
- Create: `extensions/shoppable-video-widgets/snippets/reel-namespace.liquid`
- Create: `extensions/shoppable-video-widgets/blocks/product-page-reels.liquid`
- Modify: `extensions/shoppable-video-widgets/locales/en.default.json`
- Delete: the generated demo files not needed (`blocks/star_rating.liquid`'s demo content gets replaced, not deleted — see below; `snippets/stars.liquid` and `assets/thumbs-up.png` get deleted since nothing uses them)

**Interfaces:**
- Produces: the `reel-namespace.liquid` snippet, rendered via `{% render 'reel-namespace' %}` at the top of the block, which `{% assign %}`s a variable holding the app namespace string — every other file that needs the namespace renders this snippet rather than repeating the literal string.

- [ ] **Step 1: Scaffold the extension**

Run: `shopify app generate extension --template theme_app_extension --name shoppable-video-widgets --path .`

Expected: creates `extensions/shoppable-video-widgets/` with `shopify.extension.toml`, `blocks/star_rating.liquid`, `snippets/stars.liquid`, `assets/thumbs-up.png`, `locales/en.default.json`.

- [ ] **Step 2: Remove the unused demo files**

```bash
rm extensions/shoppable-video-widgets/snippets/stars.liquid
rm extensions/shoppable-video-widgets/assets/thumbs-up.png
```

- [ ] **Step 3: Create the namespace snippet**

Create `extensions/shoppable-video-widgets/snippets/reel-namespace.liquid`:

```liquid
{% doc %}
Assigns `reel_namespace` to this app's resolved metafield namespace for the
reel metaobject reference. This is the ONE place this magic string appears —
every block/snippet that needs to read the product's tagged reels renders
this snippet first, rather than repeating the literal namespace string.

Confirmed empirically against a live product on the real storefront during
planning: product.metafields['app--404281098241'].reels is the working
access pattern. $app, plain "app", and combined "$app:reels" bracket forms
were all tried and do NOT resolve — this is not a guess.

@example
{% render 'reel-namespace' %}
{{ product.metafields[reel_namespace].reels.value }}
{% enddoc %}

{% assign reel_namespace = 'app--404281098241' %}
```

- [ ] **Step 4: Replace the demo block with the real Product page reels block**

Replace the full contents of `extensions/shoppable-video-widgets/blocks/star_rating.liquid` — actually, rename this file to `product-page-reels.liquid` (delete the old file, create the new one) since "star_rating" is meaningless for what this block does:

```bash
rm extensions/shoppable-video-widgets/blocks/star_rating.liquid
```

Create `extensions/shoppable-video-widgets/blocks/product-page-reels.liquid`:

```liquid
{% doc %}
Renders every published, ready reel tagged to the current product as a
lightweight, lazily-loaded video player. Reads the product's tagged reels
via the app-owned metaobject reference metafield — resolved entirely by
Liquid at render time, no runtime API call.
@example
{% content_for 'block', type: 'product-page-reels', id: 'reels' %}
{% enddoc %}

{% render 'reel-namespace' %}
{% assign reels_field = block.settings.product.metafields[reel_namespace].reels %}

{% assign visible_reels = '' | split: '' %}
{% for reel in reels_field.value %}
  {% if reel.published.value and reel.config.value.cloudflareStreamUid != blank and reel.config.value.hlsManifestUrl != blank %}
    {% assign visible_reels = visible_reels | concat: reel %}
  {% endif %}
{% endfor %}

{% if visible_reels.size > 0 %}
  <div class="reelup-product-reels" {{ block.shopify_attributes }}>
    {% for reel in visible_reels %}
      <div
        class="reelup-reel"
        style="--reelup-aspect-ratio: 9 / 16;"
        data-reelup-reel
        data-hls-src="{{ reel.config.value.hlsManifestUrl }}"
        data-poster="{{ reel.config.value.posterUrl }}"
      >
        <div class="reelup-reel__frame">
          {% if reel.config.value.posterUrl != blank %}
            <img
              class="reelup-reel__poster"
              src="{{ reel.config.value.posterUrl }}"
              alt="{{ reel.title.value | escape }}"
              loading="lazy"
              width="360"
              height="640"
            >
          {% endif %}
          <button
            type="button"
            class="reelup-reel__play"
            aria-label="{{ 'reels.play_label' | t }}"
          >
            <span class="reelup-reel__play-icon" aria-hidden="true"></span>
          </button>
          <video
            class="reelup-reel__video"
            playsinline
            muted
            loop
            preload="none"
          ></video>
        </div>
      </div>
    {% endfor %}
  </div>
{% endif %}

{% stylesheet %}
.reelup-product-reels {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-block: 12px;
}

.reelup-reel {
  flex: 0 0 auto;
  width: 200px;
}

.reelup-reel__frame {
  position: relative;
  width: 100%;
  aspect-ratio: var(--reelup-aspect-ratio);
  background: #111;
  border-radius: 12px;
  overflow: hidden;
}

.reelup-reel__poster,
.reelup-reel__video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.reelup-reel__video {
  display: none;
}

.reelup-reel[data-playing] .reelup-reel__poster,
.reelup-reel[data-playing] .reelup-reel__play {
  display: none;
}

.reelup-reel[data-playing] .reelup-reel__video {
  display: block;
}

.reelup-reel__play {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.reelup-reel__play-icon {
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 8px 0 8px 14px;
  border-color: transparent transparent transparent #fff;
  margin-left: 3px;
}
{% endstylesheet %}

{% schema %}
{
  "name": "Product page reels",
  "target": "section",
  "settings": [
    { "type": "product", "id": "product", "label": "Product", "autofill": true }
  ]
}
{% endschema %}
```

Note: this task deliberately ships with NO `{% javascript %}`/script tag yet — the play button renders but does nothing until Task 3 wires up the player. This keeps this task's markup/CSS independently reviewable before the JS lands. The reserved `aspect-ratio` on `.reelup-reel__frame` guarantees zero layout shift regardless of when the video/poster loads, matching the CLS constraint from the original performance roadmap.

- [ ] **Step 5: Update locale strings**

Replace the contents of `extensions/shoppable-video-widgets/locales/en.default.json` with:

```json
{
  "reels": {
    "play_label": "Play video"
  }
}
```

- [ ] **Step 6: Verify the extension is recognized**

Run: `shopify app config validate --json` (or `shopify app config validate --json --config awalabs-shoppable-videos` — check which config is active per the note in the Foundation plan's final review; whichever you've been using for `shopify app dev`).
Expected: no errors related to the new extension's TOML/schema. If the CLI in this environment can't authenticate to the Partner org, note that as a known limitation and defer live validation to the human, same pattern as every previous plan's Shopify-CLI-dependent step.

- [ ] **Step 7: Commit**

```bash
git add extensions/shoppable-video-widgets
git commit -m "feat(storefront): scaffold theme app extension with Product page reels block markup"
```

---

### Task 3: The player — lazy load, conditional hls.js, playback control

**Files:**
- Create: `extensions/shoppable-video-widgets/assets/hls.min.js`
- Create: `extensions/shoppable-video-widgets/assets/product-page-reels.js`
- Modify: `extensions/shoppable-video-widgets/blocks/product-page-reels.liquid`

- [ ] **Step 1: Vendor hls.js**

Download a pinned, current stable release of `hls.js`'s minified UMD distribution and save it to `extensions/shoppable-video-widgets/assets/hls.min.js`:

```bash
curl -L https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js -o extensions/shoppable-video-widgets/assets/hls.min.js
```

Verify the file downloaded correctly (non-empty, starts with a JS comment/UMD wrapper, not an HTML error page):

```bash
head -c 200 extensions/shoppable-video-widgets/assets/hls.min.js
```

If this fails or the environment has no network access to jsdelivr, report BLOCKED — do not fabricate a placeholder file. This is a one-time vendoring step; the file itself is a static asset checked into the extension, not re-fetched at runtime.

- [ ] **Step 2: Write the player script**

Create `extensions/shoppable-video-widgets/assets/product-page-reels.js`:

```js
(function () {
  function supportsNativeHls(video) {
    return video.canPlayType("application/vnd.apple.mpegurl") !== "";
  }

  function attachSource(video, hlsSrc) {
    if (supportsNativeHls(video)) {
      video.src = hlsSrc;
      return Promise.resolve();
    }

    if (!window.Hls || !window.Hls.isSupported()) {
      return Promise.reject(new Error("HLS not supported"));
    }

    return new Promise(function (resolve, reject) {
      var hls = new window.Hls();
      hls.loadSource(hlsSrc);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
        resolve();
      });
      hls.on(window.Hls.Events.ERROR, function (_event, data) {
        if (data.fatal) reject(new Error(data.type));
      });
    });
  }

  function loadHlsJsIfNeeded() {
    if (window.Hls || document.querySelector("script[data-reelup-hlsjs]")) {
      return Promise.resolve();
    }

    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = document.currentScript
        ? document.currentScript.src.replace(
            "product-page-reels.js",
            "hls.min.js",
          )
        : "";
      script.dataset.reelupHlsjs = "true";
      script.onload = function () {
        resolve();
      };
      script.onerror = function () {
        reject(new Error("Failed to load hls.js"));
      };
      document.head.appendChild(script);
    });
  }

  function activateReel(reelEl) {
    if (reelEl.dataset.reelupActivated) return;
    reelEl.dataset.reelupActivated = "true";

    var video = reelEl.querySelector(".reelup-reel__video");
    var playButton = reelEl.querySelector(".reelup-reel__play");
    var hlsSrc = reelEl.dataset.hlsSrc;

    if (!video || !hlsSrc) return;

    playButton.addEventListener("click", function () {
      var ready = supportsNativeHls(video)
        ? Promise.resolve()
        : loadHlsJsIfNeeded();

      ready
        .then(function () {
          return attachSource(video, hlsSrc);
        })
        .then(function () {
          reelEl.setAttribute("data-playing", "true");
          video.play();
        })
        .catch(function () {
          // Playback failed to initialize; leave the poster/play button visible.
        });
    });
  }

  function observeReels() {
    var reelEls = document.querySelectorAll("[data-reelup-reel]");
    if (reelEls.length === 0) return;

    if (!window.IntersectionObserver) {
      reelEls.forEach(function (el) {
        activateReel(el);
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            activateReel(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "200px" },
    );

    reelEls.forEach(function (el) {
      observer.observe(el);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeReels);
  } else {
    observeReels();
  }
})();
```

Design notes for whoever reviews this: `activateReel` only wires up the click handler and lazily loads `hls.js` — it does NOT eagerly load the video or `hls.js` for every reel on the page. The `IntersectionObserver` with a 200px `rootMargin` means the click-handler wiring happens once a reel scrolls near the viewport, not on page load; the actual video byte transfer only starts on the user's play-button click. This is the "don't preload video nobody watches" principle from the original performance roadmap.

- [ ] **Step 3: Wire the script into the block**

Add this line to `extensions/shoppable-video-widgets/blocks/product-page-reels.liquid`, immediately after the closing `{% endif %}` of the `visible_reels.size > 0` block (i.e., only load the script at all if there's something to render):

```liquid
{% if visible_reels.size > 0 %}
  <script src="{{ 'product-page-reels.js' | asset_url }}" defer></script>
{% endif %}
```

- [ ] **Step 4: Typecheck / lint the main app (confirm nothing else broke)**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean — this task only touches extension files, which aren't part of the main app's TS/test surface, so this should be an unaffected no-op confirmation, not a real gate for this task's own code. (There is no test runner for theme app extension Liquid/JS in this project; this step exists to catch an accidental cross-contamination, not to validate the extension itself.)

- [ ] **Step 5: Note on verification**

Neither this task's JS nor the Liquid from Task 2 can be verified by an automated test — there's no test harness for theme app extensions in this project, and this environment's Shopify CLI can't necessarily deploy/preview live (same recurring limitation as prior plans). The metafield-access mechanism itself (Global Constraints section) IS already empirically verified — that was done live, by hand, before this plan was written, and should NOT be re-verified as if it were still in doubt. What remains genuinely unverified is: whether the block actually renders correctly end-to-end with the JS attached, whether `hls.js` actually initializes and plays a real Cloudflare-hosted video, and whether the lazy-load timing behaves as designed. State this plainly in your report.

- [ ] **Step 6: Commit**

```bash
git add extensions/shoppable-video-widgets
git commit -m "feat(storefront): add lazy-loaded player with conditional hls.js to Product page reels block"
```

---

## Self-Review

**Spec coverage:** Cloudflare playback URL capture ✓ Task 1. Theme app extension scaffold + block markup, product-autofill, reel filtering (published + has a completed upload) ✓ Task 2. Lazy-loaded, zero-iframe custom player with conditional `hls.js` ✓ Task 3. Analytics explicitly out of scope, not silently dropped.

**Placeholder scan:** none. The empirically-verified metafield access pattern is documented with its verification method inline (in the `reel-namespace.liquid` doc comment) rather than asserted as an unexamined fact.

**Type consistency:** `VideoDetails.playback` (Task 1) matches exactly what `webhooks.cloudflare-stream.tsx` reads (`details.playback.hls`/`details.playback.dash`). `ReelConfig.hlsManifestUrl` (Task 1) matches exactly the key name read in Task 2's Liquid (`reel.config.value.hlsManifestUrl`) — this is the one place a naming mismatch between the TypeScript side and the Liquid side would silently break the entire feature (JSON key names must match character-for-character since Liquid has no compile-time check against the TS interface), so it's called out explicitly here as the thing to double-check first if the widget ever renders with no video.

**Known limitations carried forward, not re-litigated:** live `shopify app dev`/`config validate` may not be runnable in a given sandbox (same CLI-org-auth issue as every prior plan) — the human runs these themselves, same pattern established since the Foundation plan.
