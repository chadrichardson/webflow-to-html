# CLAUDE.md

## Project Overview

A browser-based tool that converts Webflow site exports into clean, standard HTML — removing all Webflow-specific markup, attributes, CDN links, and runtime dependencies. The output is human-readable, self-contained HTML/CSS/JS with no traces of Webflow.

There is no build system, server, or package manager. Open `index.html` directly in a browser.

## File Structure

| File | Purpose |
|---|---|
| `index.html` | UI shell — ZIP drop zone, settings panel, log modal, page picker modal |
| `app.js` | Orchestration — ZIP loading, page selection, conversion, UI state, download |
| `pipeline.js` | Conversion pipeline — imports and sequences all tools, assembles output |
| `html-processor.js` | Tool: HTML parsing, DOM cleanup, CDN rewriting, initial-state CSS extraction |
| `ix2-parser.js` | Tool: IX2 data extraction, page filtering, interaction ID mapping |
| `gsap-generator.js` | Tool: GSAP plugin detection, IX2 → GSAP 3 timeline code generation |
| `css-processor.js` | Tool: CSS tree-shaking, beautification, Webflow base CSS constant |
| `asset-mapper.js` | Tool: CDN domain constants, media asset manifest parsing, output asset checklist |
| `zip-loader.js` | Tool: ZIP parsing, multi-page detection, per-page asset extraction |
| `utils.js` | Logging system and status toast helpers |
| `styles.css` | App UI styles only (not output styles) |

All JS files use ES modules (`type="module"`). `app.js` imports from `pipeline.js`, `utils.js`, `zip-loader.js`, and `asset-mapper.js`.

## Tool Architecture

Each tool module:
- Has a clear, narrow responsibility
- Is self-contained for copy-paste portability into other projects — no cross-tool imports, constants like `WF_CDN_DOMAINS` are inlined in each tool that uses them (kept in sync manually)
- Accepts an optional `logger` param (defaults to a no-op) so callers can opt into logging without the tool depending on this project's `utils.js`
- Exports pure functions with explicit inputs and outputs
- Can be replaced or extended independently (e.g. swap `css-processor` for a Tailwind converter)

`pipeline.js` is the one non-portable orchestration layer — it imports every tool and passes `logItem` from `utils.js` as the logger so the UI log panel populates.

Adding a new tool: create the file, accept an optional `logger` param, add it to `pipeline.js` and pass `logItem` at the call site.

## Input Flow

The UI accepts a single Webflow export ZIP. `loadZip()` in `zip-loader.js` parses it and returns a loader object with a `pages` array and an `extract(pageName)` method. If the ZIP contains multiple HTML pages, `app.js` shows a page picker modal before converting. Extraction yields `{ html, js, css, assets }` where `assets` is a `Map<path, blob>` of all media files in the ZIP.

## Conversion Pipeline (`pipeline.js`)

`runPipeline(fileHtml, fileJs, fileCss, options)` is called by `app.js` after a page is extracted. Returns `{ html, js, css, manifest, checklist, warnings }`.

`warnings` is an array of `{ type }` objects for non-fatal issues the user should see (e.g. `customEaseFetchFailed`). `app.js` surfaces these via the `showStatus` toast after a successful conversion.

Steps:
1. **`extractHtmlStructure`** — parse HTML via DOMParser, strip `data-wf-page`/`data-wf-site`, extract inline `<style>` content
2. **`extractPageId`** — read `data-wf-page` from raw HTML for IX2 page scoping
3. **`extractIX2Data`** — extract IX2 blob from `Webflow.require("ix2").init(...)` in webflow.js
4. **`filterForPage`** — scope IX2 events/actionLists to elements present on this page
5. **`analyzePageData`** — detect which GSAP plugins (ScrollTrigger, CustomEase) and Lottie are needed
6. **`buildIdMap`** — map Webflow UUIDs (`data-w-id`) to human-readable slugs (`click-1`, `scroll-2`)
7. **`cleanupDocument`** — strip Webflow scripts/CSS, rewrite CDN URLs, convert `data-w-id` → `data-ix`, rename grid IDs, extract animation initial states
8. **`generateGsapScript`** — translate IX2 action lists into GSAP 3 timeline code
9. **`generateCompleteHtml`** *(private to pipeline)* — assemble final HTML with stylesheet link, GSAP tags, and `interactions.js`
10. **`parseLinks`** — build asset manifest from **original** HTML (before CDN rewriting) so real CDN URLs are preserved for export fetching
11. **`generateChecklist`** — scan output HTML/CSS for `media/`-prefixed references; returns the list of filenames the page actually needs

## What Gets Scrubbed

- `data-wf-page`, `data-wf-site`, `data-wf-ignore`, `data-object-fit`, `data-node-id` attributes
- Webflow runtime scripts (`webflow.js`, jQuery)
- Webflow CSS links (`normalize.css`, `webflow.css`, `[page].webflow.css`)
- `w-mod-*` / `ontouchstart` head scripts
- `w-condition-invisible` classes
- CDN URLs (`uploads-ssl.webflow.com`, `assets.website-files.com`, `cdn.prod.website-files.com`, etc.) → rewritten to local `media/` folder (also applied to CSS)
- `w-node-*` grid IDs → renamed `grid-item-1`, `grid-item-2`, etc.
- Lottie `data-animation-type` → replaced with `data-lottie`
- WebM video sources → stripped, MP4 kept, poster extracted

## Settings (checkboxes in UI)

| ID | Effect |
|---|---|
| `prefSrcset` | Remove `srcset` / `sizes` from images |
| `prefVideo` | Simplify background videos to single MP4 |
| `prefTreeShake` | Remove unused CSS rules via `stripUnusedCss()` |
| `mediaFolderInput` | Local folder prefix for rewritten media URLs (default: `media/`) |

Note: `prefScrubWebflow` (strip Webflow head scripts) was removed — this cleanup is now always-on.

## Key Details

**CSS output**: `WF_BASE_CSS` (in `css-processor.js`) + uploaded project CSS + extracted inline styles. Grid ID renames are applied to CSS via string replace. CDN URLs in CSS are also rewritten to `media/`. Tree-shake uses `WF_DYNAMIC_SAFELIST` to protect runtime classes like `w--open`, `w--current`.

**GSAP injection**: GSAP `<script>` tags are only added to the output if `interactions.js` is non-empty. Pages with no animations get no GSAP dependency.

**Initial-state CSS**: Webflow sets inline `style` attributes on animated elements for their starting state. `cleanupDocument` extracts these into a `<style id="ix-initial-states">` block so GSAP can animate from them.

**ZIP export** (`downloadZip()` in `app.js`): Assembles the output zip in three layers:
1. **Converted files** — `<page>.html`, `interactions.js` (if non-empty), `styles.css`
2. **Zip-sourced assets** — blobs extracted from the uploaded Webflow zip; only files whose basename appears in the `generateChecklist` output are included, remapped to `media/<filename>`
3. **CDN-fetched assets** — online assets from `manifest.online` are fetched at export time and added to `media/<filename>`; any fetch failure (403, 404, network error) is reported to the user via a status toast with the affected filenames, and logged to the console with full URLs for manual recovery

The `needed` set from `generateChecklist` is applied to both layers, so only assets actually referenced in the output HTML/CSS are included.

**Multi-page ZIPs**: `loadZip()` detects all `.html` files and returns them as `pages`. If more than one page is found, `app.js` renders a page picker modal (`pagePickerModal`) and waits for user selection before running `extractAndConvert()`.

## External Dependencies (CDN, loaded at runtime)

- **JSZip** 3.10.1 — zip parsing and packaging
- **js-beautify** 1.15.1 — HTML formatting in output
- **Material Symbols Outlined** — icons throughout UI
- **GSAP** 3.12.5 + ScrollTrigger + CustomEase — referenced in output HTML; CustomEase inlined if needed
- **Lottie Web** 5.12.2 — referenced in output HTML if Lottie detected

## Adding Future Tools

**Tailwind converter**: Create `tailwind-converter.js` with the same interface as `css-processor.js`. Add a settings toggle. In `pipeline.js`, branch on the option:
```js
const css = options.tailwind
  ? await convertToTailwind(doc, finalCss)
  : beautifyCss(finalCss);
```

**New Webflow GSAP format**: Create `wf-gsap-parser.js` alongside `ix2-parser.js`. Detect the format in `pipeline.js` and route to the appropriate parser. Both parsers should return the same `{ events, actionLists }` shape so `gsap-generator.js` is unchanged.
