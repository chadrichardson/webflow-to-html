export const WF_CDN_DOMAINS = [
  'https://uploads-ssl.webflow.com/',
  'https://assets.website-files.com/',
  'https://assets-global.website-files.com/',
  'https://cdn.prod.website-files.com/',
];

const MEDIA_EXT = /\.(jpe?g|png|gif|webp|avif|svg|mp4|webm|mov|ogg|mp3|wav|pdf|docx?|zip|pptx?|xlsx?|json|woff2?|ttf|eot)(\?|#|$)/i;

export function parseLinks(html, fileCss, { includeSrcset = true } = {}, logger = null) {
  const log = logger || (() => {});
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const onlineSet = new Set();

  const classifyUrl = (url) => {
    if (!url || url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('#')) return;
    if (/^https?:\/\//i.test(url) && MEDIA_EXT.test(url)) onlineSet.add(url);
  };

  doc.querySelectorAll('img').forEach(el => {
    const src = el.getAttribute('src');
    if (src) classifyUrl(src);
    if (includeSrcset) {
      const srcset = el.getAttribute('srcset');
      if (srcset) srcset.split(',').forEach(entry => {
        const url = entry.trim().split(/\s+/)[0];
        if (url) classifyUrl(url);
      });
    }
  });

  doc.querySelectorAll('[src], [href], [poster], [data-src], [data-poster-url]').forEach(el => {
    ['src', 'href', 'poster', 'data-src', 'data-poster-url'].forEach(attr => {
      const url = el.getAttribute(attr);
      if (url) classifyUrl(url);
    });
  });

  doc.querySelectorAll('[style]').forEach(el => {
    const style = el.getAttribute('style');
    const urlRe = /url\(["']?([^"')]+)["']?\)/g;
    let m;
    while ((m = urlRe.exec(style)) !== null) classifyUrl(m[1]);
  });

  if (fileCss) {
    const urlRe = /url\(["']?([^"')]+)["']?\)/g;
    let m;
    while ((m = urlRe.exec(fileCss)) !== null) classifyUrl(m[1]);
  }

  const online = [...onlineSet];
  if (online.length > 0) log(`Removed ${online.length} cloud path${online.length !== 1 ? 's' : ''} in HTML`, 'scrub-webflow');

  return { online };
}

export function generateChecklist(outputHtml, outputCss, mediaFolder) {
  const prefix = mediaFolder.endsWith('/') ? mediaFolder : mediaFolder + '/';
  const files = new Set();

  const attrRe = /(?:src|href|poster|data-src)=["']([^"']*)/g;
  let m;
  while ((m = attrRe.exec(outputHtml)) !== null) {
    if (m[1].startsWith(prefix)) files.add(m[1].slice(prefix.length));
  }

  if (outputCss) {
    const urlRe = /url\(["']?([^"')]+)["']?\)/g;
    while ((m = urlRe.exec(outputCss)) !== null) {
      if (m[1].startsWith(prefix)) files.add(m[1].slice(prefix.length));
    }
  }

  return [...files].sort();
}
