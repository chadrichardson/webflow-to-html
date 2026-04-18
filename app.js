import { showStatus } from './utils.js';
import { runPipeline } from './pipeline.js';
import { loadZip } from './zip-loader.js';
import { generateChecklist } from './asset-mapper.js';

// ─────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────

let fileHtml = '', fileJs = '', fileCss = '';
let htmlUploadFilename = '';
let zipAssets = new Map();

let lastOutputHtml = '', lastOutputJs = '', lastOutputCss = '';
let lastOnlineAssets = [];

let _pendingLoader = null;

// ─────────────────────────────────────────────────────────────────────────
// REAL-TIME LOG STREAMING
// ─────────────────────────────────────────────────────────────────────────

document.addEventListener('log:entry', ({ detail: { section, msg } }) => {
  const zone = document.getElementById(`log-${section}`);
  if (!zone) return;
  if (zone.hidden) zone.hidden = false;
  const standalone = zone.closest('.standalone-log-zone');
  if (standalone?.hidden) standalone.hidden = false;
  document.getElementById('logEmptyState')?.remove();
  const item = document.createElement('div');
  item.className = 'change-item';
  item.textContent = msg;
  zone.appendChild(item);
});

function clearLogZones() {
  document.querySelectorAll('.toggle-log-zone').forEach(zone => {
    zone.innerHTML = '';
    zone.hidden = true;
  });
  document.querySelectorAll('.standalone-log-zone').forEach(zone => {
    if (zone.id !== 'zone-settings') zone.hidden = true;
  });
  const empty = document.getElementById('logEmptyState');
  if (!empty) {
    const p = document.createElement('p');
    p.className = 'log-empty-state';
    p.id = 'logEmptyState';
    p.textContent = 'No conversion run yet.';
    document.querySelector('.log-modal-body')?.appendChild(p);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// UI UPDATES
// ─────────────────────────────────────────────────────────────────────────

function updateSaveState() {
  const btn = document.getElementById('btnSave');
  btn.disabled = !lastOutputHtml;
}

function setSettingsEnabled(enabled) {
  document.querySelectorAll('.pref-checkbox input[type="checkbox"], #mediaFolderInput')
    .forEach(el => { el.disabled = !enabled; });
}

function setZipInfo(file) {
  const info = document.getElementById('zipFileInfo');
  const zone = document.getElementById('zipDropZone');
  if (!info) return;
  const kb = file.size < 1024 * 1024
    ? `${(file.size / 1024).toFixed(1)} KB`
    : `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
  info.innerHTML = `
    <span class="material-symbols-outlined zip-info-icon">folder_zip</span>
    <span class="zip-filename">${file.name}</span>
    <span class="zip-filesize">${kb}</span>
  `;
  info.classList.add('visible');
  zone?.classList.add('loaded');
}

function resetZipState() {
  fileHtml = ''; fileJs = ''; fileCss = '';
  htmlUploadFilename = '';
  zipAssets = new Map();
  lastOutputHtml = ''; lastOutputJs = ''; lastOutputCss = '';

  const info = document.getElementById('zipFileInfo');
  if (info) { info.innerHTML = ''; info.classList.remove('visible'); }
  document.getElementById('zipDropZone')?.classList.remove('loaded');
  setSettingsEnabled(false);
  updateSaveState();
  document.getElementById('btnOpenLog').disabled = true;
}

// ─────────────────────────────────────────────────────────────────────────
// ZIP HANDLING
// ─────────────────────────────────────────────────────────────────────────

async function handleZipFile(file) {
  if (!file) return;
  resetZipState();

  let loader;
  try {
    loader = await loadZip(file);
  } catch {
    return;
  }

  setZipInfo(file);
  setSettingsEnabled(true);

  if (loader.pages.length === 1) {
    await extractAndConvert(loader, loader.pages[0]);
  } else {
    showPagePicker(loader, loader.pages);
  }
}

async function extractAndConvert(loader, pageName) {
  showStatus('outputStatus', 'info', 'Extracting…');
  try {
    const extracted = await loader.extract(pageName);
    fileHtml = extracted.html;
    fileJs   = extracted.js;
    fileCss  = extracted.css;
    zipAssets = extracted.assets;
    htmlUploadFilename = pageName.replace(/\.(html|htm)$/i, '').split('/').pop();
    runConversion();
  } catch (err) {
    showStatus('outputStatus', 'error', `Extraction failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PAGE PICKER
// ─────────────────────────────────────────────────────────────────────────

function showPagePicker(loader, pages) {
  _pendingLoader = loader;
  const select = document.getElementById('pagePickerSelect');
  select.innerHTML = pages.map(p => `<option value="${p}">${p}</option>`).join('');
  document.getElementById('pagePickerModal').classList.add('open');
}

function closePagePicker() {
  document.getElementById('pagePickerModal').classList.remove('open');
}

// ─────────────────────────────────────────────────────────────────────────
// CONVERSION
// ─────────────────────────────────────────────────────────────────────────

async function runConversion() {
  if (!fileHtml) return;
  clearLogZones();

  const options = {
    scrubSrcset:  document.getElementById('prefSrcset').checked,
    scrubVideo:   document.getElementById('prefVideo').checked,
    treeShake:    document.getElementById('prefTreeShake').checked,
mediaFolder:  document.getElementById('mediaFolderInput').value.trim() || 'media/'
  };

  try {
    const result = await runPipeline(fileHtml, fileJs, fileCss, options);
    lastOutputHtml    = result.html;
    lastOutputJs      = result.js;
    lastOutputCss     = result.css;
    lastOnlineAssets  = result.manifest.online;

    updateSaveState();
    document.getElementById('btnOpenLog').disabled = false;
    const customEaseWarning = result.warnings?.find(w => w.type === 'customEaseFetchFailed');
    if (customEaseWarning) {
      showStatus('outputStatus', 'error', 'Conversion complete — CustomEase fetch failed; add a <script src> for CustomEase or inline it manually');
    } else {
      showStatus('outputStatus', 'success', 'Conversion complete');
    }
  } catch (err) {
    showStatus('outputStatus', 'error', `Conversion failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// DOWNLOAD
// ─────────────────────────────────────────────────────────────────────────

async function downloadZip() {
  const zip = new window.JSZip();
  const fname = htmlUploadFilename || 'page';
  const mediaFolder = document.getElementById('mediaFolderInput').value.trim() || 'media/';
  const prefix = mediaFolder.endsWith('/') ? mediaFolder : mediaFolder + '/';

  zip.file(`${fname}.html`, lastOutputHtml);
  if (lastOutputJs) zip.file('interactions.js', lastOutputJs);
  zip.file('styles.css', lastOutputCss);

  const needed = new Set(generateChecklist(lastOutputHtml, lastOutputCss, mediaFolder));
  for (const [path, blob] of zipAssets) {
    const filename = path.split('/').pop();
    if (needed.has(filename)) zip.file(`${prefix}${filename}`, blob);
  }

  const failed = [];
  await Promise.all(lastOnlineAssets.map(async url => {
    const filename = url.split('?')[0].split('/').pop();
    if (!needed.has(filename)) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      zip.file(`${prefix}${filename}`, await res.blob());
    } catch (err) {
      failed.push({ filename, url, reason: err.message });
    }
  }));

  if (failed.length > 0) {
    const names = failed.map(f => f.filename).join(', ');
    showStatus('outputStatus', 'error', `${failed.length} CDN asset${failed.length > 1 ? 's' : ''} could not be fetched — download manually: ${names}`);
    console.warn('[export] CDN fetch failures:', failed);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${fname}_clean.zip`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────

const dropZone = document.getElementById('zipDropZone');
const zipInput = document.getElementById('zipInput');

if (dropZone && zipInput) {
  zipInput.addEventListener('change', e => {
    if (e.target.files[0]) handleZipFile(e.target.files[0]);
    zipInput.value = '';
  });

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', e => {
    if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleZipFile(file);
  });
}

document.addEventListener('click', e => {
  if (e.target.id === 'logModal') document.getElementById('logModal').classList.remove('open');

  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.id === 'btnSave') downloadZip();

  if (btn.id === 'btnOpenLog') document.getElementById('logModal').classList.add('open');
  if (btn.id === 'btnCloseLog') document.getElementById('logModal').classList.remove('open');

  if (btn.id === 'btnPickerConfirm') {
    const pageName = document.getElementById('pagePickerSelect').value;
    closePagePicker();
    extractAndConvert(_pendingLoader, pageName);
  }

  if (btn.id === 'btnPickerCancel') {
    closePagePicker();
    resetZipState();
  }
});

document.addEventListener('DOMContentLoaded', updateSaveState);

document.querySelectorAll('.pref-checkbox input[type="checkbox"]').forEach(el => {
  el.addEventListener('change', () => { if (fileHtml) runConversion(); });
});

let _mediaFolderDebounce = null;
document.getElementById('mediaFolderInput')?.addEventListener('input', () => {
  clearTimeout(_mediaFolderDebounce);
  _mediaFolderDebounce = setTimeout(() => { if (fileHtml) runConversion(); }, 400);
});
