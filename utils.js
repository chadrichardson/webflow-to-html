export const LOG_SECTIONS = {
  'scrub-webflow': { label: 'Core cleanup',      icon: 'cleaning_services' },
  'srcset':        { label: 'Responsive images', icon: 'image' },
  'video':         { label: 'Video format',      icon: 'videocam' },
  'treeshake':     { label: 'CSS tree shake',    icon: 'account_tree' },
  'interactions':  { label: 'Interactions',      icon: 'ads_click' },
  'cleanup':       { label: 'Page clean up',     icon: 'auto_fix_high' },
};

export let logSections = Object.fromEntries(Object.keys(LOG_SECTIONS).map(k => [k, []]));

export function resetLog() {
  logSections = Object.fromEntries(Object.keys(LOG_SECTIONS).map(k => [k, []]));
}

export function logItem(msg, section) {
  if (!logSections[section]) return;
  logSections[section].push(msg);
  document.dispatchEvent(new CustomEvent('log:entry', { detail: { section, msg } }));
}

let _statusTimer = null;

export function dismissStatus(el) {
  clearTimeout(_statusTimer);
  el.classList.add('dismissing');
  _statusTimer = setTimeout(() => {
    if (el.classList.contains('dismissing')) {
      el.className = 'status';
      el.textContent = '';
    }
  }, 220);
}

export function showStatus(elementId, type, message) {
  const el = document.getElementById(elementId);
  if (!el) return;
  clearTimeout(_statusTimer);
  el.className = 'status';
  void el.offsetWidth;
  el.textContent = message;
  el.className = `status ${type}`;
  _statusTimer = setTimeout(() => dismissStatus(el), type === 'error' ? 4000 : 3000);
}
