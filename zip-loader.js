import { showStatus } from './utils.js';

// ── Project Configuration ──────────────────────────────────────────────
// Edit this section per project. Engine below is project-agnostic.

const EXTRACT_CONFIG = {
  html:   { match: p => p.endsWith('.html') && !p.includes('__MACOSX'), type: 'text', multiple: true, required: true },
  js:     { match: p => /js\/webflow\.js$/.test(p), type: 'text', required: false },
  css:    { match: p => /css\/.*\.webflow\.css$/.test(p), type: 'text', required: false },
  assets: { match: p => /\.(jpg|jpeg|png|gif|svg|webp|mp4|woff2?|json)$/i.test(p), type: 'blob', multiple: true, required: false },
};

// ── Core Loader (project-agnostic below this line) ─────────────────────

export async function loadZip(file) {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    showStatus('outputStatus', 'error', 'Please upload a ZIP file.');
    throw new Error('Not a ZIP');
  }

  let zip;
  try {
    zip = await window.JSZip.loadAsync(file);
  } catch (err) {
    showStatus('outputStatus', 'error', 'Failed to parse ZIP file.');
    throw err;
  }

  const pages = [];
  zip.forEach((path, entry) => {
    if (!entry.dir && EXTRACT_CONFIG.html.match(path)) pages.push(path);
  });

  if (pages.length === 0) {
    showStatus('outputStatus', 'error', 'No HTML pages found in ZIP.');
    throw new Error('No HTML found');
  }

  const firstHtml = await zip.file(pages[0]).async('text');
  if (!/data-wf-page|data-wf-site/.test(firstHtml)) {
    showStatus('outputStatus', 'warn', 'This doesn\'t look like a Webflow export — data-wf-page not found.');
  }

  return {
    pages,
    async extract(pageName) {
      const result = { html: '', js: '', css: '', assets: new Map() };

      const htmlEntry = zip.file(pageName);
      if (!htmlEntry) throw new Error(`Page not found in ZIP: ${pageName}`);
      result.html = await htmlEntry.async('text');

      for (const [path, entry] of Object.entries(zip.files)) {
        if (!entry.dir && EXTRACT_CONFIG.js.match(path)) {
          result.js = await entry.async('text');
          break;
        }
      }

      for (const [path, entry] of Object.entries(zip.files)) {
        if (!entry.dir && EXTRACT_CONFIG.css.match(path)) {
          result.css = await entry.async('text');
          break;
        }
      }

      for (const [path, entry] of Object.entries(zip.files)) {
        if (!entry.dir && EXTRACT_CONFIG.assets.match(path)) {
          const blob = await entry.async('blob');
          result.assets.set(path, blob);
        }
      }

      return result;
    }
  };
}
