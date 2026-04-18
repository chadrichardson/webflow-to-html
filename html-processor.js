// Inlined for copy-paste portability — keep in sync with asset-mapper.js if you change it there.
const WF_CDN_DOMAINS = [
  'https://uploads-ssl.webflow.com/',
  'https://assets.website-files.com/',
  'https://assets-global.website-files.com/',
  'https://cdn.prod.website-files.com/',
];

const LEGACY_MEDIA_FOLDERS = [
  '/documents/', 'documents/',
  '/videos/', 'videos/',
  '/images/', 'images/'
];

const MEDIA_EXT = /\.(jpe?g|png|gif|webp|avif|svg|mp4|webm|mov|ogg|mp3|wav|pdf|docx?|zip|pptx?|xlsx?|json|woff2?|ttf|eot)(\?|#|$)/i;

const ANIM_PROPS = new Set([
  "transform", "-webkit-transform", "-moz-transform", "-ms-transform",
  "opacity", "display", "visibility",
  "width", "height", "max-width", "max-height", "min-width", "min-height",
  "top", "right", "bottom", "left",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "color", "background-color",
  "border-color", "border-width", "border-radius",
  "filter", "-webkit-filter",
  "clip-path", "-webkit-clip-path",
  "overflow",
]);

const VENDOR_PREFIX_MAP = {
  "-webkit-transform": "transform",
  "-moz-transform": "transform",
  "-ms-transform": "transform",
  "-webkit-filter": "filter",
  "-webkit-clip-path": "clip-path",
};

export function extractPageId(html) {
  const match = html.match(/data-wf-page="([^"]+)"/);
  return match ? match[1] : null;
}

export function extractHtmlStructure(html, logger = null) {
  const log = logger || (() => {});
  const doc = new DOMParser().parseFromString(html, "text/html");
  const htmlEl = doc.documentElement;
  const htmlLang = htmlEl.getAttribute("lang") || "en";

  if (htmlEl.hasAttribute("data-wf-page")) {
    htmlEl.removeAttribute("data-wf-page");
    log("Removed 1 data-wf-page attribute", "scrub-webflow");
  }
  if (htmlEl.hasAttribute("data-wf-site")) {
    htmlEl.removeAttribute("data-wf-site");
    log("Removed 1 data-wf-site attribute", "scrub-webflow");
  }

  const styleMatches = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
  const cssContent = styleMatches.map(s => s.replace(/<\/?style[^>]*>/gi, "")).join("\n");

  return { doc, htmlLang, cssContent };
}

/**
 * Clean a Webflow-exported document in-place and return animation metadata.
 *
 * @returns {{ initialStateCss: string, gridMap: Record<string,string> }}
 *   `gridMap` maps each original `w-node-*` id to its renamed `grid-item-N` id —
 *   callers MUST apply this to any CSS that references the old ids (pipeline.js does this).
 */
export function cleanupDocument(doc, options = {}, idMap = null, logger = null) {
  const log = logger || (() => {});
  const { scrubSrcset = true, scrubVideo = true, mediaFolder = 'media/' } = options;
  const prefix = mediaFolder.endsWith('/') ? mediaFolder : mediaFolder + '/';

  // 1. Head scripts (w-mod, ontouchstart) — always-on
  let count = 0;
  doc.head.querySelectorAll('script').forEach(el => {
    if ((el.textContent || "").includes('w-mod-') || (el.textContent || "").includes('ontouchstart')) {
      el.remove(); count++;
    }
  });
  if (count > 0) log('Removed webflow on-touch scripts', 'scrub-webflow');

  // 2. Runtime scripts
  const wfScripts = doc.body.querySelectorAll('script[src*="webflow"]');
  const jqScripts = doc.body.querySelectorAll('script[src*="jquery"]');
  if (wfScripts.length > 0) { wfScripts.forEach(s => s.remove()); log('Removed webflow.js', 'scrub-webflow'); }
  if (jqScripts.length > 0) { jqScripts.forEach(s => s.remove()); log('Removed jQuery', 'scrub-webflow'); }

  // 3. Webflow CSS links
  doc.head.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
    const href = link.getAttribute('href') || "";
    if (href.includes('normalize.css')) {
      link.remove(); log('Removed normalize.css', 'scrub-webflow');
    } else if (href.includes('webflow.css')) {
      const filename = href.split('/').pop().split('?')[0];
      link.remove(); log(`Removed ${filename}`, 'scrub-webflow');
    }
  });

  // 4. Condition classes
  const condEls = doc.querySelectorAll('.w-condition-invisible');
  if (condEls.length > 0) {
    condEls.forEach(el => el.classList.remove('w-condition-invisible'));
    log(`Removed ${condEls.length} invisible condition(s)`, 'cleanup');
  }

  // 5. Srcset
  if (scrubSrcset) {
    const imgs = doc.querySelectorAll('img[srcset], img[sizes]');
    if (imgs.length > 0) {
      imgs.forEach(el => { el.removeAttribute('srcset'); el.removeAttribute('sizes'); });
      log(`Removed ${imgs.length} srcset image attributes`, 'srcset');
    }
  }

  // 6. Background video simplification
  if (scrubVideo) {
    let count = 0;
    doc.querySelectorAll('.w-background-video').forEach(el => {
      el.classList.remove('w-background-video-atom');
      const video = el.querySelector('video');
      if (!video) return;

      const sources = video.querySelectorAll('source');
      const hasWebm = Array.from(sources).some(s =>
        s.getAttribute('src')?.includes('.webm') || s.getAttribute('type')?.includes('webm')
      );
      if (!hasWebm && sources.length <= 1) return;

      const mp4Source = video.querySelector('source[src*=".mp4"]');
      const mp4Src = mp4Source ? prefix + mp4Source.getAttribute('src').split('/').pop() : '';

      const posterUrl = el.getAttribute('data-poster-url');
      let posterPath = '';
      if (posterUrl) {
        posterPath = prefix + posterUrl.split('/').pop();
      } else {
        const posterStyle = video.getAttribute('style') || "";
        const m = posterStyle.match(/background-image:url\(&quot;([^&]+)&quot;\)/i)
               || posterStyle.match(/background-image:url\("([^"]+)"\)/i);
        if (m) posterPath = prefix + m[1].split('/').pop();
      }

      ['data-poster-url', 'data-video-urls', 'data-autoplay', 'data-loop', 'data-wf-ignore']
        .forEach(attr => el.removeAttribute(attr));

      video.removeAttribute('style');
      video.removeAttribute('id');
      video.innerHTML = `<source src="${mp4Src}" type="video/mp4">`;
      if (posterPath) video.setAttribute('poster', posterPath);
      video.setAttribute('autoplay', '');
      video.setAttribute('loop', '');
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      count++;
    });
    if (count > 0) log(`Removed ${count} webm video formats`, 'video');
  }

  // 7. CDN and legacy local media URLs
  {
    let cdnCount = 0, localCount = 0;
    doc.querySelectorAll('[src], [href], [poster], [data-src]').forEach(el => {
      ['src', 'href', 'poster', 'data-src'].forEach(attr => {
        const val = el.getAttribute(attr);
        if (!val) return;
        let replaced = false;
        for (const domain of WF_CDN_DOMAINS) {
          if (val.includes(domain)) {
            el.setAttribute(attr, val.replace(domain, prefix));
            cdnCount++; replaced = true; break;
          }
        }
        // Any other https:// media URL not on a known WF domain
        if (!replaced && /^https?:\/\//i.test(val) && MEDIA_EXT.test(val)) {
          const filename = val.split('/').pop().split('?')[0];
          el.setAttribute(attr, prefix + filename);
          cdnCount++; replaced = true;
        }

        if (!replaced) {
          for (const folder of LEGACY_MEDIA_FOLDERS) {
            if (val.startsWith(folder)) {
              el.setAttribute(attr, val.replace(folder, prefix));
              localCount++; break;
            }
          }
        }
      });
    });
    if (localCount > 0) log(`Changed ${localCount} media paths`, 'scrub-webflow');
  }

  // 8. data-w-id → data-ix
  const wIdEls = doc.querySelectorAll('[data-w-id]');
  if (wIdEls.length > 0) {
    wIdEls.forEach(el => {
      const uuid = el.getAttribute('data-w-id');
      const elementId = uuid.includes("|") ? uuid.split("|")[1] : uuid;
      const slug = idMap?.elementToSlug?.get(elementId);
      if (slug) el.setAttribute('data-ix', slug);
      el.removeAttribute('data-w-id');
    });
    log(`Converted ${wIdEls.length} webflow legacy interactions`, 'interactions');
  }

  // 9. Grid node IDs
  const gridMap = {};
  let gridCounter = 0;
  doc.querySelectorAll('[id^="w-node-"]').forEach(el => {
    const oldId = el.getAttribute('id');
    const newId = `grid-item-${++gridCounter}`;
    el.setAttribute('id', newId);
    gridMap[oldId] = newId;
  });
  if (gridCounter > 0) log(`Mapped ${gridCounter} Webflow grid nodes to human IDs`, 'cleanup');

  // 10. Misc Webflow attributes
  ['data-wf-ignore', 'data-object-fit', 'data-node-id'].forEach(attr => {
    const els = doc.querySelectorAll(`[${attr}]`);
    if (els.length > 0) {
      els.forEach(el => el.removeAttribute(attr));
      log(`Removed ${els.length} ${attr} attributes`, 'scrub-webflow');
    }
  });

  // 11. Lottie attributes
  const lottieEls = doc.querySelectorAll('[data-animation-type="lottie"]');
  if (lottieEls.length > 0) {
    lottieEls.forEach(el => {
      el.setAttribute("data-lottie", "");
      ['data-animation-type', 'data-is-ix2-target', 'data-direction', 'data-default-duration', 'data-duration']
        .forEach(a => el.removeAttribute(a));
    });
    log(`Removed ${lottieEls.length} webflow lottie attributes`, 'scrub-webflow');
  }

  // 12. Extract animation initial states from inline styles
  const initialStateCssRules = [];
  let initCounter = 0;
  const usedSelectors = new Set();

  doc.querySelectorAll("[style]").forEach(el => {
    const styleVal = el.getAttribute("style") || "";
    if (![...ANIM_PROPS].some(p => styleVal.includes(p + ":"))) return;

    const decls = styleVal.split(";").map(d => d.trim()).filter(Boolean);
    const animDecls = {};
    const keepDecls = [];

    decls.forEach(d => {
      const colonIdx = d.indexOf(':');
      if (colonIdx === -1) return;
      const prop = d.slice(0, colonIdx).trim().toLowerCase();
      const val = d.slice(colonIdx + 1).trim();
      if (ANIM_PROPS.has(prop)) animDecls[VENDOR_PREFIX_MAP[prop] || prop] = val;
      else keepDecls.push(d);
    });

    if (Object.keys(animDecls).length === 0) return;

    let selector = el.getAttribute("data-ix") ? `[data-ix="${el.getAttribute("data-ix")}"]`
      : el.id ? `#${el.id}`
      : el.classList.length ? `.${el.classList[0]}`
      : null;

    if (!selector || usedSelectors.has(selector)) {
      const tag = `init-${++initCounter}`;
      el.setAttribute("data-init-style", tag);
      selector = `[data-init-style="${tag}"]`;
    }
    usedSelectors.add(selector);

    const cssBody = Object.entries(animDecls).map(([k, v]) => `  ${k}: ${v};`).join("\n");
    initialStateCssRules.push(`${selector} {\n${cssBody}\n}`);

    if (keepDecls.length) el.setAttribute("style", keepDecls.join("; "));
    else el.removeAttribute("style");
  });

  if (initialStateCssRules.length > 0) log(`Added ${initialStateCssRules.length} CSS initial states for interactions`, 'interactions');

  return { initialStateCss: initialStateCssRules.join("\n\n"), gridMap };
}
