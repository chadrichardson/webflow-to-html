import { resetLog, logItem } from './utils.js';
import { extractPageId, extractHtmlStructure, cleanupDocument } from './html-processor.js';
import { extractIX2Data, filterForPage, buildIdMap } from './ix2-parser.js';
import { analyzePageData, generateGsapScript } from './gsap-generator.js';
import { WF_BASE_CSS, stripUnusedCss, beautifyCss } from './css-processor.js';
import { parseLinks, generateChecklist, WF_CDN_DOMAINS } from './asset-mapper.js';

function rewriteCdnUrlsInText(text, domains, prefix) {
  let count = 0;
  for (const domain of domains) {
    const parts = text.split(domain);
    count += parts.length - 1;
    text = parts.join(prefix);
  }
  return { text, count };
}

function generateCompleteHtml(doc, analysis, gsapScript, initialStateCss) {
  const { needsScrollTrigger, needsLottie } = analysis;
  const hasInteractions = !!(gsapScript?.trim());

  if (initialStateCss) {
    const styleTag = doc.createElement('style');
    styleTag.id = 'ix-initial-states';
    styleTag.textContent = '/* Interaction initial states — set by GSAP on init */\n' + initialStateCss;
    doc.head.appendChild(styleTag);
  }

  let libTags = '';
  if (hasInteractions) {
    libTags += '  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>\n';
    logItem('Injected GSAP <script>', 'interactions');
    if (needsScrollTrigger) {
      libTags += '  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>\n';
      logItem('Injected ScrollTrigger <script>', 'interactions');
    }
  }
  if (needsLottie) {
    libTags += '  <script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>\n';
    logItem('Injected Lottie <script>', 'interactions');
  }

  const interactionsTag = hasInteractions ? '  <script src="interactions.js" defer></script>\n' : '';

  const scriptContainer = doc.createElement('div');
  scriptContainer.innerHTML = libTags + interactionsTag;
  while (scriptContainer.firstChild) doc.body.appendChild(scriptContainer.firstChild);

  if (!doc.head.querySelector('link[href="styles.css"]')) {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'styles.css';
    doc.head.appendChild(link);
  }

  const html = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
  return window.html_beautify ? window.html_beautify(html, { indent_size: 2, inline: [] }) : html;
}

export async function runPipeline(fileHtml, fileJs, fileCss, options) {
  resetLog();

  const { doc, htmlLang, cssContent } = extractHtmlStructure(fileHtml, logItem);
  const ix2Data = extractIX2Data(fileJs);
  const pageId = extractPageId(fileHtml);

  const pageElementIds = new Set();
  doc.querySelectorAll('[data-w-id]').forEach(el => {
    const wid = el.getAttribute('data-w-id');
    if (wid) pageElementIds.add(wid.includes('|') ? wid.split('|')[1] : wid);
  });

  const pageData = filterForPage(ix2Data, pageId, pageElementIds);
  const analysis = analyzePageData(pageData, doc);
  const idMap = buildIdMap(pageData.events, pageData.actionLists);
  const cleaned = cleanupDocument(doc, options, idMap, logItem);
  const { js: gsapScript, customEaseFailed } = await generateGsapScript(pageData, idMap, analysis);
  const warnings = [];
  if (customEaseFailed) {
    logItem('CustomEase fetch failed — add a <script src> for CustomEase or inline it manually', 'interactions');
    warnings.push({ type: 'customEaseFetchFailed' });
  }

  let finalCss = WF_BASE_CSS + '\n' + fileCss + '\n' + (cssContent || '');

  // Apply the gridMap contract from cleanupDocument: its renamed ids must be mirrored into CSS.
  for (const [oldId, newId] of Object.entries(cleaned.gridMap)) {
    finalCss = finalCss.split(`#${oldId}`).join(`#${newId}`);
  }

  if (options.treeShake) {
    const stripped = stripUnusedCss(finalCss, doc.documentElement.outerHTML);
    finalCss = stripped.css;
    logItem(`Removed ${stripped.strippedCount} unused CSS rules`, 'treeshake');
  }

  // Rewrite WF CDN URLs in CSS (scrubber only handles HTML attributes).
  const mediaFolder = options.mediaFolder || 'media/';
  const prefix = mediaFolder.endsWith('/') ? mediaFolder : mediaFolder + '/';
  {
    const { text, count } = rewriteCdnUrlsInText(finalCss, WF_CDN_DOMAINS, prefix);
    finalCss = text;
    if (count > 0) logItem(`Removed ${count} cloud path${count !== 1 ? 's' : ''} in CSS`, 'scrub-webflow');
  }

  const html = generateCompleteHtml(doc, analysis, gsapScript, cleaned.initialStateCss);
  const css = beautifyCss(finalCss);

  // Parse links from original HTML so online URLs are captured before rewriting
  const manifest = parseLinks(fileHtml, fileCss, { includeSrcset: !options.scrubSrcset });
  const checklist = generateChecklist(html, css, mediaFolder);

  return { html, js: gsapScript, css, manifest, checklist, warnings };
}
