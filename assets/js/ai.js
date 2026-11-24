/* SPOS Remover — AI background removal module.
 *
 * Wraps @imgly/background-removal@1.7.0 (AGPL-3.0). Since v1.2.0 the engine
 * is VENDORED at assets/vendor/ (same origin as the page — see
 * assets/vendor/NOTICE.md). Since v1.5.0 the two main models are
 * SELF-HOSTED chunk-by-chunk at assets/models/:
 *   fast     → isnet_quint8 (~44 MB) — smallest, good quality
 *   balanced → isnet_fp16   (~88 MB) — RECOMMENDED, clearly sharper edges
 *   hd       → isnet        (~176 MB) from imgly's data CDN, falls back to
 *              the self-hosted balanced model on network failure.
 *
 * v1.5.0 reliability model (the numbers shown to the user are now REAL):
 *   Before the ONNX engine runs, ensureResources() downloads every needed
 *   byte itself — streamed chunk-by-chunk with true byte counters — into the
 *   service-worker cache the engine also reads from. So the download bar
 *   the user sees counts actual bytes of a known total, and the engine then
 *   starts instantly from cache (no hidden second download).
 *
 * v1.5.0 quality model (edge refinement pass, runs after the engine):
 *   1. Guided-filter refinement — alpha edges are snapped to the real
 *      edges of the ORIGINAL photo (hair, limbs, product outlines).
 *   2. Connected-component debris removal — floating specks and leftover
 *      background fragments are cut, small holes inside the subject filled.
 *   3. A gentle S-curve crushes mushy semi-transparent areas while
 *      keeping a soft band for genuinely soft edges (hair).
 */

const LIB_VERSION = '1.7.0';

const SOURCES = [
  // 1) vendored, same-origin — the default and the only path that matters
  () => new URL('assets/vendor/background-removal.mjs', document.baseURI).toString(),
  // 2) last-resort public CDNs (for exotic mirrors of this repo)
  () => `https://cdn.jsdelivr.net/npm/@imgly/background-removal@${LIB_VERSION}/+esm`,
  () => `https://esm.sh/@imgly/background-removal@${LIB_VERSION}`,
];

const IMGLY_DATA = `https://staticimgly.com/@imgly/background-removal-data/${LIB_VERSION}/dist/`;

const TIERS = {
  fast: { model: 'isnet_quint8', selfHosted: true },
  balanced: { model: 'isnet_fp16', selfHosted: true },
  hd: { model: 'isnet', selfHosted: false },
};

/** MUST stay in sync with sw.js VERSION (the SW and this module share one cache). */
const SW_CACHE = 'sposremover-v1.5.0';

let modulePromise = null;

function loadLibrary() {
  if (!modulePromise) {
    modulePromise = (async () => {
      let lastErr = null;
      for (const mk of SOURCES) {
        try {
          return await import(/* @vite-ignore */ mk());
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('ENGINE_LOAD_FAILED');
    })();
    // allow retry after a total failure
    modulePromise.catch(() => { modulePromise = null; });
  }
  return modulePromise;
}

/** Base URL of the self-hosted model chunks (works under any sub-path). */
function selfHostedPath() {
  try {
    return new URL('assets/models/', document.baseURI).toString();
  } catch (e) {
    return './assets/models/';
  }
}

function tierPath(tier) {
  return TIERS[tier].selfHosted ? selfHostedPath() : IMGLY_DATA;
}

function isNetworkError(e) {
  const s = String((e && e.message) || e);
  return /fetch|network|load|import|cdn|resource metadata|status code|failed/i.test(s);
}

/* ==================================================================== *
 *  REAL-byte preloader — the heart of the honest progress numbers.    *
 * ==================================================================== */

const prewarm = new Map(); // tier → { promise, have, total, done }

/** Bytes of every resource the CPU engine needs for a tier. */
async function tierResources(tier) {
  const base = tierPath(tier);
  const manifestUrl = new URL('resources.json', base).toString();
  const res = await fetch(manifestUrl, { cache: 'no-cache' });
  if (!res.ok) throw new Error('MANIFEST_' + res.status);
  const manifest = await res.json();
  const keys = [
    '/onnxruntime-web/ort-wasm-simd-threaded.wasm',
    '/onnxruntime-web/ort-wasm-simd-threaded.mjs',
    `/models/${TIERS[tier].model}`,
  ];
  const out = [];
  for (const key of keys) {
    const entry = manifest[key];
    if (!entry) throw new Error('MISSING_RESOURCE_' + key);
    out.push({ key, chunks: entry.chunks, size: entry.size });
  }
  return { base, out };
}

/**
 * Ensure every byte the engine will request is already in the shared
 * service-worker cache. Reports TRUE byte counts: (have/total) counts
 * both already-cached bytes and bytes streamed during this call.
 * @returns {Promise<{have:number,total:number}>}
 */
async function ensureResources(tier, onProgress) {
  const { base, out } = await tierResources(tier);
  const total = out.reduce((s, r) => s + r.size, 0);
  let have = 0;

  let cache = null;
  try { cache = await caches.open(SW_CACHE); } catch (e) { /* no SW / private mode */ }

  const report = () => {
    if (typeof onProgress === 'function') {
      onProgress(Math.min(100, Math.round((have / total) * 100)), have, total);
    }
  };

  // pass 1: count what is already cached (progress reflects reality instantly)
  const missing = [];
  for (const r of out) {
    for (const ch of r.chunks) {
      const url = new URL(ch.name, base).toString();
      const hit = cache ? await cache.match(url) : null;
      if (hit) {
        have += ch.offsets[1] - ch.offsets[0];
      } else {
        missing.push({ url, size: ch.offsets[1] - ch.offsets[0] });
      }
    }
  }
  report();

  // pass 2: stream what is missing, byte by byte, into the same cache
  for (const m of missing) {
    const res = await fetch(m.url, { cache: 'force-cache' });
    if (!res.ok) throw new Error('HTTP_' + res.status + ' ' + m.url.split('/').pop());
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.byteLength;
        have += value.byteLength;
        report();
      }
      if (got !== m.size) throw new Error('SIZE_MISMATCH ' + m.url.split('/').pop());
      const copy = new Response(new Blob(parts), res);
      if (cache) { try { await cache.put(m.url, copy); } catch (e) {} }
    } else {
      // no streaming API: fall back to whole-body download, report at end
      const blob = await res.blob();
      if (blob.size !== m.size) throw new Error('SIZE_MISMATCH ' + m.url.split('/').pop());
      have += blob.size;
      report();
      if (cache) { try { await cache.put(m.url, new Response(blob, res)); } catch (e) {} }
    }
  }
  return { have, total };
}

/** Kick off (or join) a background prewarm after the user picks a tier.
 *  onProgress subscribers are notified with (pct, have, total) live bytes —
 *  the same state object also feeds the slim UI bar under the tier cards. */
export function prewarmTier(tier, onProgress) {
  if (!TIERS[tier]) return null;
  let st = prewarm.get(tier);
  if (!st) {
    st = { have: 0, total: 0, done: false, error: null, subs: [] };
    st.promise = ensureResources(tier, (pct, have, total) => {
      st.have = have; st.total = total;
      st.subs.forEach((fn) => fn(pct, have, total));
    }).then((r) => {
      st.done = true; Object.assign(st, r);
      st.subs.forEach((fn) => fn(100, r.have, r.total));
    }).catch((e) => { st.error = e; });
    prewarm.set(tier, st);
  }
  if (typeof onProgress === 'function') st.subs.push(onProgress);
  return st;
}

export function engineCaps() {
  const SIMD_BODY = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1,
    8, 0, 65, 0, 253, 15, 253, 98, 11,
  ]);
  let simd = false;
  try { simd = WebAssembly.validate(SIMD_BODY); } catch (e) { /* old engine */ }
  const conn = (typeof navigator !== 'undefined' && navigator.connection) || null;
  return {
    wasm: typeof WebAssembly === 'object',
    simd,
    threads: typeof SharedArrayBuffer !== 'undefined',
    isolated: typeof crossOriginIsolated !== 'undefined' ? !!self.crossOriginIsolated : false,
    mem: navigator.deviceMemory || (navigator.deviceMemoryGB) || null,
    downlink: conn && conn.downlink != null ? conn.downlink : null,
    effectiveType: conn && conn.effectiveType ? conn.effectiveType : null,
    ua: navigator.userAgent || '',
  };
}

/** Preflight check — returns null when the browser can run the engine. */
export function preflight() {
  const c = engineCaps();
  if (!c.wasm) return { reason: 'no-wasm' };
  if (!c.simd) return { reason: 'no-simd', caps: c };
  return null;
}

/* ==================================================================== *
 *  Edge refinement — the quality pass (v1.5.0).                       *
 *  Ported from the Python-validated prototype: guided filter +        *
 *  debris removal + hole filling + gentle S-curve.                    *
 * ==================================================================== */

const REFINE_MAX_SIDE = 2560; // working-res cap (memory bound for phones)

/** Separable box blur, Float32, replicate-padding, divisor 2r+1.
 *  boxBlur(src, out, tmp): horizontal src→tmp, vertical tmp→out.
 *  `src` is never written; `out` may alias `src` but must differ from `tmp`. */
function boxBlur(src, out, tmp, w, h, r) {
  if (r <= 0) { out.set(src); return; }
  const div = 2 * r + 1;
  // horizontal: src → tmp
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / div;
      const outv = src[row + Math.max(0, x - r)];
      const inn = src[row + Math.min(w - 1, x + r + 1)];
      acc += inn - outv;
    }
  }
  // vertical: tmp → out
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += tmp[Math.max(0, Math.min(h - 1, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / div;
      const outv = tmp[Math.max(0, y - r) * w + x];
      const inn = tmp[Math.min(h - 1, y + r + 1) * w + x];
      acc += inn - outv;
    }
  }
}

function guidedFilterLuma(guide, src, w, h, r, eps, bufs) {
  // bufs: [mg, mp, prod, buf4, tmp] — five scratch Float32Arrays
  const [B0, B1, B2, B3, TMP] = bufs;
  const n = w * h;
  boxBlur(guide, B0, TMP, w, h, r);        // mg
  boxBlur(src, B1, TMP, w, h, r);           // mp
  for (let i = 0; i < n; i++) B2[i] = guide[i] * src[i];
  boxBlur(B2, B2, TMP, w, h, r);            // mgp (in place: reads only TMP)
  for (let i = 0; i < n; i++) B3[i] = guide[i] * guide[i];
  boxBlur(B3, B3, TMP, w, h, r);            // mgg (in place)
  // coefficients a and b per pixel — B2/B3 no longer needed as means
  const a = B2, b = B3;
  for (let i = 0; i < n; i++) {
    const cov = B2[i] - B0[i] * B1[i];
    const varr = B3[i] - B0[i] * B0[i];
    a[i] = cov / (varr + eps);
    b[i] = B1[i] - a[i] * B0[i];
  }
  boxBlur(a, B0, TMP, w, h, r);             // mean_a (B0 free now)
  boxBlur(b, B1, TMP, w, h, r);             // mean_b (B1 free now)
  const q = src; // write output over input
  for (let i = 0; i < n; i++) {
    q[i] = B0[i] * guide[i] + B1[i];
  }
  return q;
}

/** 4-connectivity connected components on a Uint8 mask (1 = fg). */
function connectedCleanup(hard, w, h) {
  const n = w * h;
  const labels = new Int32Array(n); // 0 = unlabeled/bg, else component id
  const stack = new Int32Array(n);
  let components = [];
  let label = 0;
  for (let i = 0; i < n; i++) {
    if (!hard[i] || labels[i]) continue;
    label++;
    let sp = 0, size = 0;
    stack[sp++] = i;
    labels[i] = label;
    while (sp) {
      const p = stack[--sp];
      size++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && hard[p - 1] && !labels[p - 1]) { labels[p - 1] = label; stack[sp++] = p - 1; }
      if (x < w - 1 && hard[p + 1] && !labels[p + 1]) { labels[p + 1] = label; stack[sp++] = p + 1; }
      if (y > 0 && hard[p - w] && !labels[p - w]) { labels[p - w] = label; stack[sp++] = p - w; }
      if (y < h - 1 && hard[p + w] && !labels[p + w]) { labels[p + w] = label; stack[sp++] = p + w; }
    }
    components.push({ label, size });
  }
  return { labels, components };
}

/** Flood the background from the borders; unreached bg = holes. */
function findHoles(solid, w, h) {
  const n = w * h;
  const reach = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const push = (i) => { if (!solid[i] && !reach[i]) { reach[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const p = stack[--sp];
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  return reach;
}

/**
 * Full refinement pipeline on RGBA pixels.
 * @param origData Uint8ClampedArray RGBA of the original photo (work res)
 * @param alpha Float32Array 0..1 (work res), modified in place
 */
function refineAlpha(origData, alpha, w, h, doGuided) {
  const n = w * h;
  const r = Math.max(2, Math.round(Math.min(w, h) * 0.010));
  const eps = 1e-3;

  if (doGuided) {
    const luma = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      luma[i] = (0.299 * origData[p] + 0.587 * origData[p + 1] + 0.114 * origData[p + 2]) / 255;
    }
    const bufs = [new Float32Array(n), new Float32Array(n), new Float32Array(n),
                  new Float32Array(n), new Float32Array(n)];
    guidedFilterLuma(luma, alpha, w, h, r, eps, bufs);
    for (let i = 0; i < n; i++) {
      alpha[i] = alpha[i] < 0 ? 0 : (alpha[i] > 1 ? 1 : alpha[i]);
    }
  }

  // debris removal on the hard mask
  const hard = new Uint8Array(n);
  for (let i = 0; i < n; i++) hard[i] = alpha[i] > 0.5 ? 1 : 0;
  {
    const { labels, components } = connectedCleanup(hard, w, h);
    if (components.length) {
      let biggest = 0;
      for (const c of components) biggest = Math.max(biggest, c.size);
      const minKeep = Math.max(0.10 * biggest, 250);
      const killFlags = new Map();
      for (const c of components) killFlags.set(c.label, c.size < minKeep);
      const killMask = new Uint8Array(n);
      let any = false;
      for (let i = 0; i < n; i++) {
        const lab = labels[i];
        if (lab && killFlags.get(lab)) { killMask[i] = 1; any = true; }
      }
      if (any) {
        // dilate the killed set by 2px (OUT-OF-PLACE passes — in-place
        // dilation cascades unboundedly) to clear each blob's halo
        const dilate = (m) => {
          const out = new Uint8Array(n);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (!m[i]) continue;
            out[i] = 1;
            if (x > 0) out[i - 1] = 1;
            if (x < w - 1) out[i + 1] = 1;
            if (y > 0) out[i - w] = 1;
            if (y < h - 1) out[i + w] = 1;
          }
          return out;
        };
        const killD = dilate(dilate(killMask));
        for (let i = 0; i < n; i++) {
          if (killD[i]) alpha[i] = Math.min(alpha[i], 0.02);
        }
      }
    }
  }

  // hole filling
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = alpha[i] > 0.5 ? 1 : 0;
  const reach = findHoles(solid, w, h);
  {
    // group unreached bg pixels into holes, fill the small ones
    const holes = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (!solid[i] && !reach[i]) holes[i] = 1;
    const { labels: hl, components: hcomps } = connectedCleanup(holes, w, h);
    const maxHole = 0.0003 * n + 60;
    for (const c of hcomps) {
      if (c.size <= maxHole) {
        for (let i = 0; i < n; i++) if (hl[i] === c.label) alpha[i] = Math.max(alpha[i], 0.97);
      }
    }
  }

  // gentle S-curve
  const LO = 0.28, HI = 0.62;
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    if (a <= LO) alpha[i] = 0;
    else if (a >= HI) alpha[i] = 1;
    else {
      const t = (a - LO) / (HI - LO);
      alpha[i] = t * t * (3 - 2 * t);
    }
  }

  // second debris pass at a lower threshold — kills soft specks the
  // S-curve left alive (validated against real model output)
  {
    const hard2 = new Uint8Array(n);
    for (let i = 0; i < n; i++) hard2[i] = alpha[i] > 0.35 ? 1 : 0;
    const { labels: l2, components: c2 } = connectedCleanup(hard2, w, h);
    if (c2.length) {
      let biggest = 0;
      for (const c of c2) biggest = Math.max(biggest, c.size);
      const minKeep = Math.max(0.10 * biggest, 250);
      const killFlags = new Map();
      for (const c of c2) killFlags.set(c.label, c.size < minKeep);
      for (let i = 0; i < n; i++) {
        const lab = l2[i];
        if (lab && killFlags.get(lab)) alpha[i] = 0;
      }
    }
  }
  return alpha;
}

/**
 * Applies the refinement pipeline to an engine result.
 * @param {Blob} originalBlob the original image file
 * @param {Blob} resultBlob engine output PNG (same dimensions)
 * @returns {Promise<Blob>} refined PNG at the ORIGINAL dimensions
 */
export async function refineResult(originalBlob, resultBlob, onStage) {
  if (typeof createImageBitmap !== 'function') return resultBlob;
  let bmpOrig, bmpRes;
  try {
    bmpOrig = await createImageBitmap(originalBlob);
    bmpRes = await createImageBitmap(resultBlob);
  } catch (e) { return resultBlob; }
  const W = bmpOrig.width, H = bmpOrig.height;
  if (bmpRes.width !== W || bmpRes.height !== H) { bmpOrig.close(); bmpRes.close(); return resultBlob; }

  const scale = Math.min(1, REFINE_MAX_SIDE / Math.max(W, H));
  const w = Math.max(8, Math.round(W * scale)), h = Math.max(8, Math.round(H * scale));
  const doGuided = w * h <= 6.5e6; // guided filter only within the memory budget

  const co = document.createElement('canvas'); co.width = w; co.height = h;
  const ctxo = co.getContext('2d', { willReadFrequently: true });
  ctxo.drawImage(bmpOrig, 0, 0, w, h);
  const origData = ctxo.getImageData(0, 0, w, h).data;

  const cr = document.createElement('canvas'); cr.width = w; cr.height = h;
  const ctxr = cr.getContext('2d', { willReadFrequently: true });
  ctxr.drawImage(bmpRes, 0, 0, w, h);
  const resData = ctxr.getImageData(0, 0, w, h).data;

  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = resData[i * 4 + 3] / 255;

  refineAlpha(origData, alpha, w, h, doGuided);

  // upscale the refined alpha back to FULL resolution
  const cm = document.createElement('canvas'); cm.width = w; cm.height = h;
  const ctxm = cm.getContext('2d');
  const img = ctxm.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(255, Math.round(alpha[i] * 255)));
    img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = v;
  }
  ctxm.putImageData(img, 0, 0);

  const cf = document.createElement('canvas'); cf.width = W; cf.height = H;
  const ctxf = cf.getContext('2d');
  ctxf.imageSmoothingEnabled = true;
  ctxf.imageSmoothingQuality = 'high';
  ctxf.drawImage(bmpOrig, 0, 0, W, H);           // full-res original RGB
  ctxf.globalCompositeOperation = 'destination-in';
  ctxf.drawImage(cm, 0, 0, W, H);                // full-res refined alpha
  ctxf.globalCompositeOperation = 'source-over';
  bmpOrig.close(); bmpRes.close();

  return await new Promise((resolve) => cf.toBlob(resolve, 'image/png'));
}

/* ==================================================================== *
 *  Public API                                                         *
 * ==================================================================== */

/**
 * @param {File|Blob} file
 * @param {{tier?:'fast'|'balanced'|'hd', progress?:(phase:'model'|'process'|'refine', pct:number, cur?:number, total?:number)=>void, onFallback?:()=>void, onRetry?:(n:number)=>void, skipRefine?:boolean}} opts
 * @returns {Promise<Blob>} refined PNG (transparent background) at the ORIGINAL image dimensions.
 */
export async function removeBackground(file, opts = {}) {
  const tier = TIERS[opts.tier] ? opts.tier : 'balanced';

  // 1) make sure every byte is local BEFORE the engine starts — with
  //    REAL byte counters (this is the number the user sees).
  const pw = prewarmTier(tier, (pct, have, total) => {
    if (typeof opts.progress === 'function' && total) {
      opts.progress('model', pct, have, total);
    }
  });
  let prewarmed = false;
  if (pw) {
    await pw.promise; // resolves even on failure (error lands in pw.error)
    if (pw.error) {
      // prewarm failed for this tier — clear it so a retry can start fresh;
      // the engine attempt below fetches on its own and applies fallbacks.
      prewarm.delete(tier);
    } else {
      prewarmed = true;
      if (pw.total && typeof opts.progress === 'function') {
        opts.progress('model', 100, pw.total, pw.total);
      }
    }
  }

  // 2) run the engine (reads everything from the cache — instant)
  const lib = await loadLibrary();
  const fn = lib.removeBackground || lib.default;

  const attempt = (t) => {
    const cfg = TIERS[t];
    return fn(file, {
      model: cfg.model,
      device: 'cpu',
      publicPath: tierPath(t),
      output: { format: 'image/png', quality: 0.9, type: 'foreground' },
      progress: (key, current, total) => {
        // When every byte was pre-cached, the engine's fetch events describe
        // cache-served reads, not network progress — surfacing them would make
        // the bar jump backwards (the exact bug this version fixes). Only
        // report the engine's own fetches when the prewarm could NOT cache
        // them (fallback path); keep the display monotonic.
        if (typeof opts.progress !== 'function') return;
        if (key.startsWith('fetch:')) {
          if (prewarmed) return;
          if (!attempt._max) attempt._max = 0;
          attempt._max = Math.max(attempt._max, current);
          const pct = total ? Math.min(99, Math.round((current / total) * 100)) : 0;
          opts.progress('model', Math.max(pct, attempt._pctSeen || 0), current, total);
          attempt._pctSeen = Math.max(attempt._pctSeen || 0, pct);
        } else {
          opts.progress('process', 0, key);
        }
      },
    });
  };

  const MAX_TRIES = TIERS[tier].selfHosted ? 3 : 1;
  let lastErr = null;
  let raw = null;
  for (let i = 0; i < MAX_TRIES; i++) {
    try {
      if (i > 0 && typeof opts.onRetry === 'function') opts.onRetry(i);
      raw = await attempt(tier);
      break;
    } catch (e) {
      lastErr = e;
      if (!isNetworkError(e)) break;
      await new Promise((res) => setTimeout(res, 600 * (i + 1)));
    }
  }
  if (!raw) {
    // network failure on the CDN (hd) tier → self-hosted balanced fallback
    if (tier !== 'balanced' && tier !== 'fast' && isNetworkError(lastErr)) {
      try {
        if (typeof opts.onFallback === 'function') opts.onFallback();
        await ensureResources('balanced');
        raw = await attempt('balanced');
      } catch (e2) {
        throw e2;
      }
    } else {
      throw lastErr || new Error('ENGINE_FAILED');
    }
  }

  // 3) edge refinement pass (unless explicitly disabled)
  if (opts.skipRefine) return raw;
  if (typeof opts.progress === 'function') opts.progress('refine', 0);
  try {
    const refined = await refineResult(file, raw);
    if (typeof opts.progress === 'function') opts.progress('refine', 100);
    return refined || raw;
  } catch (e) {
    console.warn('refine failed, returning engine output', e);
    return raw;
  }
}
