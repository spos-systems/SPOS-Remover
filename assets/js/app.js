/* SPOS Remover — application controller (UI, tabs, flows, i18n, PWA). */

import { DICT } from './i18n.js';
import { inspectImage, cleanImage, fmtBytes } from './exif.js';
import { removeBackground, engineCaps, preflight, prewarmTier } from './ai.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  lang: document.documentElement.lang === 'en' ? 'en' : 'ar',
  tool: 'bg',
  tier: '',               // 'fast' | 'balanced' | 'hd' — MUST be chosen explicitly
  pendingFile: null,      // image awaiting a tier choice in the dialog
  bgResult: null,   // { blob, width, height, originalSize, resultSize, originalUrl, resultUrl }
  exifState: null,  // { file, report }
};

const T = () => DICT[state.lang];

/* ================= i18n ================= */

const EXIF_LABELS = {
  ar: {
    gpsLat: 'خط العرض', gpsLon: 'خط الطول', gpsAlt: 'الارتفاع عن سطح البحر',
    gpsDirection: 'اتجاه التصوير', gpsSpeed: 'سرعة الجهاز لحظة التصوير',
    gpsTime: 'زمن GPS', gpsDate: 'تاريخ GPS',
    make: 'الشركة المصنعة', model: 'طراز الكاميرا', lens: 'العدسة', lensMake: 'مصنع العدسة',
    iso: 'حساسية ISO', exposure: 'سرعة الغالق', fnumber: 'فتحة العدسة',
    focal: 'البعد البؤري', focal35: 'البعد المكافئ 35mm', flash: 'الفلاش',
    orientation: 'اتجاه الصورة', software: 'البرمجيات المستخدمة',
    dateTime: 'تاريخ التعديل', dateTimeOriginal: 'تاريخ الالتقاط', dateTimeDigitized: 'تاريخ الترقيم',
    offsetTime: 'المنطقة الزمنية', artist: 'المصور', copyright: 'حقوق النشر',
    description: 'الوصف', userComment: 'تعليق المستخدم', ownerName: 'مالك الكاميرا',
    serial: 'الرقم التسلسلي للكاميرا', lensSerial: 'الرقم التسلسلي للعدسة',
    host: 'الكمبيوتر المستخدم', exifVersion: 'إصدار EXIF',
    exposureProgram: 'برنامج التعريض', meteringMode: 'نظام القياس', exposureMode: 'نمط التعريض',
    sceneCaptureType: 'نوع المشهد', iptc: 'بيانات IPTC', icc: 'ملف ألوان ICC', xmp: 'بيانات XMP',
    jpegComment: 'تعليق مدمج', pngTitle: 'العنوان', pngAuthor: 'المؤلف',
    pngSoftware: 'البرمجيات', pngDescription: 'الوصف', pngComment: 'التعليق',
    pngCopyright: 'حقوق النشر', pngText: 'نص مدمج', pngCompressedText: 'نص مضغوط', pngTime: 'تاريخ آخر تعديل',
    fileName: 'اسم الملف', fileSize: 'حجم الملف', fileType: 'نوع الملف', dimensions: 'الأبعاد',
  },
  en: {
    gpsLat: 'Latitude', gpsLon: 'Longitude', gpsAlt: 'Altitude',
    gpsDirection: 'Shooting direction', gpsSpeed: 'Device speed',
    gpsTime: 'GPS time', gpsDate: 'GPS date',
    make: 'Manufacturer', model: 'Camera model', lens: 'Lens', lensMake: 'Lens maker',
    iso: 'ISO', exposure: 'Shutter speed', fnumber: 'Aperture',
    focal: 'Focal length', focal35: 'Focal (35mm eq.)', flash: 'Flash',
    orientation: 'Orientation', software: 'Software used',
    dateTime: 'Modify date', dateTimeOriginal: 'Capture date', dateTimeDigitized: 'Digitize date',
    offsetTime: 'Time zone', artist: 'Photographer', copyright: 'Copyright',
    description: 'Description', userComment: 'User comment', ownerName: 'Camera owner',
    serial: 'Camera serial number', lensSerial: 'Lens serial number',
    host: 'Host computer', exifVersion: 'EXIF version',
    exposureProgram: 'Exposure program', meteringMode: 'Metering', exposureMode: 'Exposure mode',
    sceneCaptureType: 'Scene type', iptc: 'IPTC data', icc: 'ICC color profile', xmp: 'XMP data',
    jpegComment: 'Embedded comment', pngTitle: 'Title', pngAuthor: 'Author',
    pngSoftware: 'Software', pngDescription: 'Description', pngComment: 'Comment',
    pngCopyright: 'Copyright', pngText: 'Embedded text', pngCompressedText: 'Compressed text', pngTime: 'Last modified',
    fileName: 'File name', fileSize: 'File size', fileType: 'File type', dimensions: 'Dimensions',
  },
};

const GROUPS = {
  gps: ['gpsLat', 'gpsLon', 'gpsAlt', 'gpsDirection', 'gpsSpeed', 'gpsTime', 'gpsDate'],
  camera: ['make', 'model', 'lens', 'lensMake', 'iso', 'exposure', 'fnumber', 'focal', 'focal35', 'flash', 'orientation', 'exposureProgram', 'meteringMode', 'exposureMode', 'sceneCaptureType'],
  meta: ['software', 'dateTime', 'dateTimeOriginal', 'dateTimeDigitized', 'offsetTime', 'artist', 'copyright', 'description', 'userComment', 'ownerName', 'serial', 'lensSerial', 'host', 'exifVersion', 'iptc', 'xmp', 'jpegComment', 'pngTitle', 'pngAuthor', 'pngSoftware', 'pngDescription', 'pngComment', 'pngCopyright', 'pngText', 'pngCompressedText', 'pngTime'],
  file: ['fileName', 'fileSize', 'fileType', 'dimensions'],
};

function applyLang() {
  const d = T();
  document.documentElement.lang = state.lang;
  document.documentElement.dir = d.dir;
  document.title = d.docTitle;
  $$('[data-i18n]').forEach(el => {
    const v = d[el.dataset.i18n];
    if (typeof v === 'string') el.textContent = v;
  });
  $$('[data-i18n-aria]').forEach(el => {
    const v = d[el.dataset.i18nAria];
    if (typeof v === 'string') el.setAttribute('aria-label', v);
  });
  $('#langToggle').textContent = state.lang === 'ar' ? 'EN' : 'عربي';
  if (state.exifState) renderExif(state.exifState);
}

function setLang(lang, save = true) {
  state.lang = DICT[lang] ? lang : 'ar';
  if (save) { try { localStorage.setItem('spos-remover-lang', state.lang); } catch (e) {} }
  applyLang();
}

/* ================= helpers ================= */

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(T().toastSaved);
}

function stamp(ext) {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `spos-remover-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

const fmtMB = (bytes) => {
  if (!bytes || bytes < 1048576) return '';
  return (bytes / 1048576).toFixed(1) + ' م.ب';
};

const SVG = {
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
};

/* ================= tabs ================= */

function setTool(tool) {
  state.tool = tool;
  $$('.seg button').forEach(b => {
    const on = b.dataset.tool === tool;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  $('#panel-bg').classList.toggle('active', tool === 'bg');
  $('#panel-exif').classList.toggle('active', tool === 'exif');
  $$('.dropzone[data-tool]').forEach(dz => dz.setAttribute('aria-hidden', tool !== dz.dataset.tool));
}

/* ================= tier (strength) selection ================= */

/** Called whenever a tier card is picked — stores the choice, kicks off a
 *  REAL progress prewarm of the model, and runs a pending image if any. */
function selectTier(tier, runPending = false) {
  state.tier = tier;
  try { localStorage.setItem('spos-remover-tier', tier); } catch (e) {}
  syncSpeedLabels();
  startPrewarmUI(tier);
  if (runPending && state.pendingFile) {
    const f = state.pendingFile;
    state.pendingFile = null;
    runBackground(f);
  }
}

/** Slim, honest prewarm bar under the tier cards: live byte counters. */
function startPrewarmUI(tier) {
  const row = $('#prewarmRow');
  if (!row) return;
  const bar = $('#pwBar'), pct = $('#pwPct'), txt = $('#pwText');
  const st = prewarmTier(tier);
  if (!st) return;
  row.style.display = 'block';
  row.classList.remove('done', 'error');
  clearInterval(row._timer);
  const fmtMB = (b) => (b / 1048576).toFixed(1);
  const paint = () => {
    if (st.done) {
      clearInterval(row._timer);
      bar.style.width = '100%'; pct.textContent = '100%';
      txt.textContent = T().pwReady;
      row.classList.add('done');
      return;
    }
    if (st.error) {
      clearInterval(row._timer);
      txt.textContent = T().pwFail;
      row.classList.add('error');
      return;
    }
    const total = st.total || 0;
    const have = st.have || 0;
    const p = total ? Math.min(99, Math.round((have / total) * 100)) : 0;
    bar.style.width = p + '%';
    pct.textContent = p + '%';
    txt.textContent = total
      ? T().pwDown.replace('{MB}', `${fmtMB(have)} / ${fmtMB(total)}`)
      : T().pwStart;
  };
  paint();
  row._timer = setInterval(paint, 250);
}

/** Forces the user to pick a strength BEFORE processing starts (either
 *  proactively via the cards, or via this dialog right after an image was
 *  chosen — never silently defaulting to any tier). */
function openTierDialog() {
  const dlg = $('#tierDialog');
  if (!dlg || typeof dlg.showModal !== 'function') {
    // ancient browser without <dialog>: fall back to a plain confirm-style flow
    state.tier = state.tier || 'balanced';
    syncSpeedLabels();
    const f = state.pendingFile; state.pendingFile = null;
    if (f) runBackground(f);
    return;
  }
  dlg.showModal();
}

function wireTierSelection() {
  // cards on the page
  $$('.speed-opts input[name=quality]').forEach(r => r.addEventListener('change', () => {
    if (r.checked) selectTier(r.value);
  }));
  // buttons inside the forced dialog
  let dlgPicked = false;
  $$('#tierDialog [data-tier]').forEach(btn => btn.addEventListener('click', () => {
    const dlg = $('#tierDialog');
    dlgPicked = true;
    if (dlg.open) dlg.close();
    selectTier(btn.dataset.tier, true);
  }));
  // cancel path: drop the pending image (selection path keeps it)
  const dlgEl = $('#tierDialog');
  if (dlgEl) dlgEl.addEventListener('close', () => {
    if (!dlgPicked) state.pendingFile = null;
    dlgPicked = false;
  });
  // restore a remembered choice (still explicit — never silent)
  try {
    const saved = localStorage.getItem('spos-remover-tier');
    if (saved && /^(fast|balanced|hd)$/.test(saved)) {
      const r = $(`input[name=quality][value=${saved}]`);
      if (r) { r.checked = true; selectTier(saved); }
    }
  } catch (e) {}
}

function syncSpeedLabels() {
  $$('.speed-opts label').forEach(l =>
    l.classList.toggle('on', !!(l.querySelector('input') && l.querySelector('input').checked)));
  $$('#tierDialog [data-tier]').forEach(b =>
    b.classList.toggle('on', b.dataset.tier === state.tier));
}

/* ================= background flow ================= */

/** Builds the technical line shown when a job fails, so the REAL reason is
 *  never hidden behind a generic message. */
function buildDiag(err, tier, elapsed) {
  const c = engineCaps();
  const parts = [
    'error: ' + String((err && err.message) || err),
    'tier: ' + tier,
    'elapsed: ' + Math.round(elapsed / 1000) + 's',
    'simd: ' + (c.simd ? 'yes' : 'no'),
    'threads: ' + (c.threads ? 'yes' : 'no'),
    'net: ' + (c.effectiveType || (c.downlink ? c.downlink + 'Mbps' : 'n/a')),
    'ua: ' + (c.ua || '').slice(0, 120),
  ];
  return parts.join('\n');
}

async function runBackground(file) {
  // ---- the strength MUST be explicit before anything starts ----
  if (!state.tier) {
    state.pendingFile = file;
    openTierDialog();
    return;
  }

  const stage = $('#bgStage'), barBox = $('#bgBar') ? $('#bgBar').parentElement : null,
        bar = $('#bgBar'), pct = $('#bgPct'), mb = $('#bgMb'),
        stTitle = $('#bgStageTitle'), stSub = $('#bgStageSub'),
        result = $('#bgResult'), error = $('#bgError'), dzBg = $('#dzBg');

  // ---- preflight: can this browser run the WASM engine at all? ----
  const gate = preflight();
  if (gate) {
    const why = gate.reason === 'no-wasm' ? T().errNoWasm : T().errNoSimd;
    $('#bgErrorText').textContent = why;
    const det = $('#bgErrorDetail');
    if (det) det.textContent = buildDiag(new Error(gate.reason), 'preflight', 0);
    error.style.display = 'block'; error.classList.add('show');
    return;
  }

  [stage, result, error].forEach(el => { el.classList.remove('show'); el.style.display = 'none'; });
  dzBg.style.display = 'none'; // collapse the dropzone while a job is running
  stage.style.display = 'block'; stage.classList.add('show');
  stTitle.textContent = T().stageModel;
  stSub.textContent = T().stageModelSub;
  if (barBox) barBox.classList.remove('indeterminate');
  bar.style.width = '0%'; pct.textContent = '0%'; mb.textContent = '';

  // ---- watchdog: on a slow mobile network the model download can stall for
  //      long seconds; tell the user it is normal instead of looking dead ----
  let lastTick = Date.now();
  let lastBytes = -1;
  const watchdog = setInterval(() => {
    if (stage.style.display === 'none') return;
    if (stTitle.textContent === T().stageModel && Date.now() - lastTick > 20000) {
      stSub.textContent = T().slowNet;
    }
  }, 5000);

  const tier = state.tier;
  const t0 = Date.now();
  try {
    const blob = await removeBackground(file, {
      tier,
      onFallback: () => toast(T().fallbackNote),
      onRetry: () => { toast(T().retryingNote); lastTick = Date.now(); },
      progress: (phase, p, cur, total) => {
        lastTick = Date.now();
        if (phase === 'model') {
          stTitle.textContent = T().stageModel;
          stSub.textContent = T().stageModelSub;
          if (barBox) barBox.classList.remove('indeterminate');
          // REAL byte-accurate counters: these are streamed bytes of a known
          // total — never a per-file percentage that restarts.
          bar.style.width = p + '%';
          pct.textContent = p + '%';
          if (total > 1048576) {
            mb.textContent = `${(cur / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} ${state.lang === 'ar' ? 'م.ب' : 'MB'}`;
          }
          if (cur !== lastBytes) { lastBytes = cur; lastTick = Date.now(); }
        } else if (phase === 'refine') {
          stTitle.textContent = T().stageRefine;
          stSub.textContent = T().stageRefineSub;
          if (barBox) barBox.classList.remove('indeterminate');
          bar.style.width = Math.max(60, p) + '%';
          pct.textContent = p ? p + '%' : '…';
          mb.textContent = '';
        } else {
          stTitle.textContent = T().stageProcess;
          stSub.textContent = T().stageProcessSub;
          if (barBox) barBox.classList.add('indeterminate');
          bar.style.width = '38%';
          pct.textContent = '…'; mb.textContent = '';
        }
      },
    });

    const bmp = await createImageBitmap(blob);
    state.bgResult = {
      blob, width: bmp.width, height: bmp.height,
      originalSize: file.size, resultSize: blob.size,
      originalUrl: URL.createObjectURL(file), resultUrl: URL.createObjectURL(blob),
    };
    bmp.close();

    const cmp = $('#cmp');
    $('#cmpBeforeImg').src = state.bgResult.originalUrl;
    $('#cmpAfterImg').src = state.bgResult.resultUrl;
    cmp.style.setProperty('--pos', 50);
    // Fit the comparison canvas to the real image aspect (no checkerboard side bars)
    const ar = Math.min(Math.max(state.bgResult.width / state.bgResult.height, 0.5), 2.6);
    cmp.style.aspectRatio = String(ar);
    cmp.style.width = `min(100%, calc(560px * ${ar}))`;
    $('#bgMetaDim').textContent = `${state.bgResult.width}×${state.bgResult.height}`;
    $('#bgMetaIn').textContent = fmtBytes(state.bgResult.originalSize);
    $('#bgMetaOut').textContent = fmtBytes(state.bgResult.resultSize);

    clearInterval(watchdog);
    stage.classList.remove('show'); stage.style.display = 'none';
    result.style.display = 'block'; result.classList.add('show');
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    clearInterval(watchdog);
    console.error(e);
    stage.classList.remove('show'); stage.style.display = 'none';
    const isNet = /fetch|network|import|cdn|load|resource metadata|status code|abort|timeout|failed/i.test(String(e && e.message));
    $('#bgErrorText').textContent = isNet ? T().errModel : T().errGeneric;
    // show the REAL error + environment facts (never hide the cause again)
    const det = $('#bgErrorDetail');
    if (det) det.textContent = buildDiag(e, tier, Date.now() - t0);
    const wa = $('#waSupport');
    if (wa) {
      const txt = (state.lang === 'ar' ? 'مرحباً، أبلغ عن مشكلة في SPOS Remover:' : 'Hi, reporting an SPOS Remover issue:') + '\n' + buildDiag(e, tier, Date.now() - t0);
      wa.href = 'https://wa.me/218935535606?text=' + encodeURIComponent(txt);
    }
    error.style.display = 'block'; error.classList.add('show');
  }
}

/* ================= exif flow ================= */

function valueLabel(key, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  switch (key) {
    case 'exposure': return n && n < 1 ? `1/${Math.round(1 / n)} s` : `${value} s`;
    case 'fnumber': return `f/${n % 1 ? n.toFixed(1) : n}`;
    case 'focal': case 'focal35': return `${Math.round(n)} mm`;
    case 'iso': return `ISO ${Math.round(n)}`;
    case 'flash': return (n & 1) ? (state.lang === 'ar' ? 'أُطلق' : 'Fired') : (state.lang === 'ar' ? 'لم يُطلق' : 'Not fired');
    case 'orientation': return { 1: '1 — عادي / normal', 3: '3 — 180°', 6: '6 — 90°', 8: '8 — 270°' }[n] || String(n);
    default: return value;
  }
}

async function runExif(file) {
  const box = $('#exifIntro');
  box.style.display = 'none'; box.classList.remove('show');

  const report = await inspectImage(file);
  state.exifState = { file, report };
  renderExif(state.exifState);
  box.style.display = 'block'; box.classList.add('show');
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderExif({ file, report }) {
  const L = EXIF_LABELS[state.lang];
  const items = [
    ...report.items,
    { key: 'fileName', value: file.name, severity: 'low' },
    { key: 'fileSize', value: fmtBytes(file.size), severity: 'low' },
    { key: 'fileType', value: report.container.toUpperCase(), severity: 'low' },
    ...(report.width ? [{ key: 'dimensions', value: `${report.width}×${report.height}`, severity: 'low' }] : []),
  ];

  $('#exifThumb').src = URL.createObjectURL(file);
  $('#exifFName').textContent = file.name;
  $('#exifFSub').textContent = `${report.container.toUpperCase()} · ${fmtBytes(file.size)}${report.width ? ` · ${report.width}×${report.height}` : ''}`;

  $('#vItems').textContent = items.length;
  const sens = report.sensitive.length;
  $('#vSens').textContent = sens;
  $('#sensStat').classList.toggle('warn', sens > 0);
  $('#vState').textContent = sens ? T().statDirty : T().statOk;

  const banner = $('#gpsBanner');
  banner.classList.toggle('show', !!report.gps);
  if (report.gps) {
    const [la, lo] = report.gps.split(',').map(s => s.trim());
    $('#osmLink').href = `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=17/${la}/${lo}`;
  }

  const groups = { gps: 'gGps', camera: 'gCamera', meta: 'gMeta', file: 'gFile' };
  for (const [g] of Object.entries(groups)) {
    const rows = items.filter(it => GROUPS[g].includes(it.key));
    const holder = $(`#grp-${g}`);
    holder.closest('.exif-group').style.display = rows.length ? '' : 'none';
    holder.innerHTML = rows.map(it =>
      `<div class="exif-row ${it.severity === 'high' ? 'high' : ''}">
         <span class="k"><span class="sev-dot ${it.severity}"></span>${L[it.key] || it.key}</span>
         <span class="v">${escapeHtml(valueLabel(it.key, it.value))}</span>
       </div>`).join('');
  }
  $('#noExifNote').style.display = report.items.length === 0 ? 'block' : 'none';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ================= dropzones ================= */

function wireDropzone(zone, input, handler) {
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) handler(input.files[0]); input.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', e => {
    const f = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/')) || e.dataTransfer?.files?.[0];
    if (f) handler(f);
  });
}

function validateImage(file) {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name)) {
    toast(T().errImg); return false;
  }
  if (file.size > 30 * 1048576) { toast(T().errBig); return false; }
  return true;
}

/* ================= compare slider ================= */

function wireCompare() {
  const cmp = $('#cmp');
  const move = x => {
    const r = cmp.getBoundingClientRect();
    const pos = Math.min(98, Math.max(2, ((x - r.left) / r.width) * 100));
    cmp.style.setProperty('--pos', pos.toFixed(1));
  };
  let dragging = false;
  cmp.addEventListener('pointerdown', e => { dragging = true; cmp.setPointerCapture(e.pointerId); move(e.clientX); });
  cmp.addEventListener('pointermove', e => dragging && move(e.clientX));
  ['pointerup', 'pointercancel'].forEach(ev => cmp.addEventListener(ev, () => { dragging = false; }));
  cmp.addEventListener('keydown', e => {
    const cur = parseFloat(getComputedStyle(cmp).getPropertyValue('--pos')) || 50;
    if (e.key === 'ArrowLeft') { cmp.style.setProperty('--pos', Math.max(2, cur - 4)); e.preventDefault(); }
    if (e.key === 'ArrowRight') { cmp.style.setProperty('--pos', Math.min(98, cur + 4)); e.preventDefault(); }
  });
  $('#cmpKnob').innerHTML = SVG.left + SVG.right;
}

/* ================= PWA ================= */

function wirePWA() {
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    $('#installBtn').classList.add('show');
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    $('#installBtn').classList.remove('show');
  });
  window.addEventListener('appinstalled', () => toast(T().toastInstalled));
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
  }
}

/* ================= boot ================= */

function boot() {
  // language: URL param > saved > browser
  const qLang = new URLSearchParams(location.search).get('lang');
  const saved = (() => { try { return localStorage.getItem('spos-remover-lang'); } catch (e) { return null; } })();
  const initial = qLang || saved || (navigator.language && navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en');
  setLang(initial, false);

  $('#langToggle').addEventListener('click', () => {
    setLang(state.lang === 'ar' ? 'en' : 'ar');
    toast(state.lang === 'ar' ? 'تم التبديل إلى العربية' : 'Switched to English');
  });

  // tabs
  $$('.seg button').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  const qTool = new URLSearchParams(location.search).get('tool');
  setTool(qTool === 'exif' ? 'exif' : 'bg');

  // tier (strength) selection — forced, never a silent default
  wireTierSelection();
  syncSpeedLabels();

  // dropzones
  wireDropzone($('#dzBg'), $('#fileBg'), f => validateImage(f) && runBackground(f));
  wireDropzone($('#dzExif'), $('#fileExif'), f => validateImage(f) && runExif(f));

  // global paste
  document.addEventListener('paste', e => {
    const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (!f) return;
    if (!validateImage(f)) return;
    (state.tool === 'bg' ? runBackground(f) : runExif(f));
  });

  // bg actions
  $('#dlPng').addEventListener('click', () => state.bgResult && saveBlob(state.bgResult.blob, stamp('png')));
  $('#dlJpg').addEventListener('click', async () => {
    if (!state.bgResult) return;
    const bmp = await createImageBitmap(state.bgResult.blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0); bmp.close();
    c.toBlob(b => b && saveBlob(b, stamp('jpg')), 'image/jpeg', 0.92);
  });
  $('#bgAgain').addEventListener('click', () => {
    $('#bgResult').classList.remove('show'); $('#bgResult').style.display = 'none';
    $('#dzBg').style.display = '';
    $('#fileBg').click();
  });
  $('#bgRetry').addEventListener('click', () => { $('#bgError').style.display = 'none'; $('#dzBg').style.display = ''; $('#fileBg').click(); });

  // exif actions
  $('#cleanPng').addEventListener('click', () => cleanCopy('image/png'));
  $('#cleanJpg').addEventListener('click', () => cleanCopy('image/jpeg'));
  async function cleanCopy(fmt) {
    if (!state.exifState) return;
    try {
      const blob = await cleanImage(state.exifState.file, fmt);
      saveBlob(blob, stamp(fmt === 'image/png' ? 'png' : 'jpg'));
      const note = $('#cleanNote');
      note.style.display = 'block';
      note.textContent = `${T().cleanDone} · ${T().originalSize}: ${fmtBytes(state.exifState.file.size)} → ${T().cleanSize}: ${fmtBytes(blob.size)}`;
    } catch (e) { toast(T().errGeneric); }
  }

  wireCompare();
  wirePWA();
  applyLang();
}

document.addEventListener('DOMContentLoaded', boot);
