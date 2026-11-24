/* SPOS Remover — zero-dependency image metadata inspector.
 * Parses JPEG (APP1 EXIF, APP2 ICC, APP13 IPTC, COM), PNG (tEXt, iTXt, zTXt,
 * eXIf, tIME), WebP (EXIF, XMP, ICCP) and returns a language-neutral item
 * list; labels live in i18n.js. Runs entirely on the user's device.
 */

/* ---------- TIFF/EXIF core ---------- */

const IFD0_TAGS = {
  0x010e: ['description', 'low'], 0x010f: ['make', 'low'], 0x0110: ['model', 'low'],
  0x0112: ['orientation', 'low'], 0x0131: ['software', 'med'], 0x0132: ['dateTime', 'med'],
  0x013b: ['artist', 'med'], 0x013c: ['host', 'med'], 0x8298: ['copyright', 'med'],
  0xa430: ['ownerName', 'med'], 0xa431: ['serial', 'high'], 0xc62f: ['serial', 'high'],
  0xa433: ['lensMake', 'low'], 0xa434: ['lens', 'low'], 0xa435: ['lensSerial', 'high'],
};
const EXIF_TAGS = {
  0x9000: ['exifVersion', 'low'], 0x9003: ['dateTimeOriginal', 'med'],
  0x9004: ['dateTimeDigitized', 'med'], 0x9010: ['offsetTime', 'med'],
  0x9286: ['userComment', 'med'], 0x829a: ['exposure', 'low'], 0x829d: ['fnumber', 'low'],
  0x8827: ['iso', 'low'], 0x8833: ['iso', 'low'], 0x920a: ['focal', 'low'], 0xa405: ['focal35', 'low'],
  0x9209: ['flash', 'low'], 0x9204: ['exposureProgram', 'low'], 0x9207: ['meteringMode', 'low'],
  0xa402: ['exposureMode', 'low'], 0xa406: ['sceneCaptureType', 'low'],
  0xa433: ['lensMake', 'low'], 0xa434: ['lens', 'low'], 0xa435: ['lensSerial', 'high'],
};
const GPS_TAGS = {
  0x0001: 'latRef', 0x0002: 'lat', 0x0003: 'lonRef', 0x0004: 'lon',
  0x0005: 'altRef', 0x0006: 'alt', 0x0007: 'gpsTime', 0x000d: 'gpsSpeed',
  0x0011: 'dirRef', 0x0012: 'direction', 0x001d: 'gpsDate',
};

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function readValues(dv, entryOff, le, base) {
  const type = dv.getUint16(entryOff + 2, le);
  const count = dv.getUint32(entryOff + 4, le);
  const size = (TYPE_SIZE[type] || 1) * count;
  const valOff = size <= 4 ? entryOff + 8 : base + dv.getUint32(entryOff + 8, le);
  const out = [];
  try {
    for (let i = 0; i < count && i < 64; i++) {
      const o = valOff + i * (TYPE_SIZE[type] || 1);
      if (type === 2) { // ASCII
        let s = '';
        for (let j = o; j < dv.byteLength && dv.getUint8(j) !== 0 && s.length < 256; j++) s += String.fromCharCode(dv.getUint8(j));
        return [s.trim()];
      } else if (type === 3) out.push(dv.getUint16(o, le));
      else if (type === 4) out.push(dv.getUint32(o, le));
      else if (type === 5) { const n = dv.getUint32(o, le), d = dv.getUint32(o + 4, le); out.push(d ? n / d : 0); }
      else if (type === 10) { const n = dv.getInt32(o, le), d = dv.getInt32(o + 4, le); out.push(d ? n / d : 0); }
      else if (type === 1) out.push(dv.getUint8(o));
      else out.push(dv.getUint8(o));
    }
  } catch (e) { /* truncated */ }
  return out;
}

function dms(vals, ref) {
  if (!vals || vals.length < 3) return null;
  const d = vals[0] + vals[1] / 60 + vals[2] / 3600;
  const v = ref === 'S' || ref === 'W' ? -d : d;
  return Math.abs(v) < 0.00001 ? null : v.toFixed(6);
}

function parseTiff(dv, base, items) {
  const bom = dv.getUint16(base);
  const le = bom === 0x4949;
  if (!le && bom !== 0x4d4d) return;
  const ifd0 = base + dv.getUint32(base + 4, le);
  let exifIfd = 0, gpsIfd = 0;
  const n = dv.getUint16(ifd0, le);
  for (let i = 0; i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    const tag = dv.getUint16(e, le);
    if (tag === 0x8769) exifIfd = base + dv.getUint32(e + 8, le);
    else if (tag === 0x8825) gpsIfd = base + dv.getUint32(e + 8, le);
    else if (IFD0_TAGS[tag]) {
      const v = readValues(dv, e, le, base);
      if (v.length && v[0] !== '' && v[0] !== undefined) items.push({ key: IFD0_TAGS[tag][0], value: v.join(', '), severity: IFD0_TAGS[tag][1] });
    }
  }
  const walk = (ifd, map) => {
    if (!ifd) return;
    try {
      const c = dv.getUint16(ifd, le);
      for (let i = 0; i < c; i++) {
        const e = ifd + 2 + i * 12;
        const tag = dv.getUint16(e, le);
        if (map[tag]) {
          const v = readValues(dv, e, le, base);
          if (v.length && v[0] !== '' && v[0] !== undefined) items.push({ key: map[tag][0], value: v.join(', '), severity: map[tag][1] });
        }
      }
    } catch (err) { /* ignore */ }
  };
  walk(exifIfd, EXIF_TAGS);
  if (gpsIfd) {
    const gps = {};
    try {
      const c = dv.getUint16(gpsIfd, le);
      for (let i = 0; i < c; i++) {
        const e = gpsIfd + 2 + i * 12;
        const tag = dv.getUint16(e, le);
        if (GPS_TAGS[tag]) gps[GPS_TAGS[tag]] = readValues(dv, e, le, base);
      }
    } catch (err) { /* ignore */ }
    const lat = dms(gps.lat, (gps.latRef || [''])[0]), lon = dms(gps.lon, (gps.lonRef || [''])[0]);
    if (lat) items.push({ key: 'gpsLat', value: lat, severity: 'high' });
    if (lon) items.push({ key: 'gpsLon', value: lon, severity: 'high' });
    if (lat && lon) items.push({ key: 'gpsCoords', value: `${lat}, ${lon}`, severity: 'high', hidden: true });
    if (gps.alt && gps.alt[0]) items.push({ key: 'gpsAlt', value: gps.alt[0].toFixed(1) + ' m', severity: 'med' });
    if (gps.direction && gps.direction[0]) items.push({ key: 'gpsDirection', value: gps.direction[0].toFixed(1) + '°', severity: 'low' });
    if (gps.gpsSpeed && gps.gpsSpeed[0]) items.push({ key: 'gpsSpeed', value: gps.gpsSpeed[0].toFixed(1) + ' km/h', severity: 'low' });
    if (gps.gpsTime) items.push({ key: 'gpsTime', value: gps.gpsTime.map(x => String(Math.floor(x)).padStart(2, '0')).join(':'), severity: 'med' });
    if (gps.gpsDate && gps.gpsDate[0]) items.push({ key: 'gpsDate', value: gps.gpsDate[0], severity: 'med' });
  }
}

/* ---------- container parsers ---------- */

function parseJPEG(buf, items) {
  const dv = new DataView(buf);
  let i = 2;
  while (i < dv.byteLength - 4) {
    if (dv.getUint8(i) !== 0xff) break;
    const marker = dv.getUint8(i + 1);
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xda || marker === 0xd9) break;
    const len = dv.getUint16(i + 2);
    const seg = i + 4;
    if (marker === 0xe1 && dv.getUint32(seg) === 0x45786966 && dv.getUint8(seg + 4) === 0) {
      parseTiff(dv, seg + 6, items);
    } else if (marker === 0xe2) {
      items.push({ key: 'icc', value: 'ICC profile', severity: 'low' });
    } else if (marker === 0xed) {
      let s = '';
      for (let j = seg; j < seg + 12; j++) s += String.fromCharCode(dv.getUint8(j));
      if (s.startsWith('Photoshop 3.0')) items.push({ key: 'iptc', value: 'IPTC (Photoshop)', severity: 'med' });
    } else if (marker === 0xfe) {
      let s = '';
      for (let j = seg; j < seg + len - 2; j++) s += String.fromCharCode(dv.getUint8(j));
      if (s.trim()) items.push({ key: 'jpegComment', value: s.trim().slice(0, 200), severity: 'med' });
    }
    i += 2 + len;
  }
}

const PNG_TXT_KEYS = { Title: 'pngTitle', Author: 'pngAuthor', Description: 'pngDescription', Software: 'pngSoftware', Comment: 'pngComment', Copyright: 'pngCopyright' };

function parsePNG(buf, items) {
  const dv = new DataView(buf);
  let i = 8;
  const dec = new TextDecoder('utf-8', { fatal: false });
  while (i < dv.byteLength - 8) {
    const len = dv.getUint32(i);
    const type = String.fromCharCode(dv.getUint8(i + 4), dv.getUint8(i + 5), dv.getUint8(i + 6), dv.getUint8(i + 7));
    const data = i + 8;
    if (type === 'tEXt') {
      const bytes = new Uint8Array(buf, data, Math.min(len, 4096));
      const z = bytes.indexOf(0);
      if (z > 0) {
        const key = dec.decode(bytes.subarray(0, z));
        const val = dec.decode(bytes.subarray(z + 1)).slice(0, 200);
        if (PNG_TXT_KEYS[key] && val) items.push({ key: PNG_TXT_KEYS[key], value: val, severity: 'med' });
        else if (val) items.push({ key: 'pngText', value: `${key}: ${val}`, severity: 'low' });
      }
    } else if (type === 'iTXt') {
      const bytes = new Uint8Array(buf, data, Math.min(len, 64));
      const z = bytes.indexOf(0);
      const key = z > 0 ? dec.decode(bytes.subarray(0, z)) : '';
      if (key) items.push({ key: 'pngText', value: key + ' (iTXt)', severity: 'low' });
    } else if (type === 'zTXt') {
      items.push({ key: 'pngCompressedText', value: 'zTXt', severity: 'med' });
    } else if (type === 'eXIf') {
      parseTiff(dv, data, items);
    } else if (type === 'tIME') {
      const y = dv.getUint16(data);
      items.push({ key: 'pngTime', value: `${y}-${dv.getUint8(data + 2)}-${dv.getUint8(data + 3)}`, severity: 'med' });
    }
    i += 12 + len;
    if (len < 0 || len > dv.byteLength) break;
  }
}

function parseWebP(buf, items) {
  const dv = new DataView(buf);
  if (dv.byteLength < 16) return;
  let i = 12;
  while (i < dv.byteLength - 8) {
    const tag = String.fromCharCode(dv.getUint8(i), dv.getUint8(i + 1), dv.getUint8(i + 2), dv.getUint8(i + 3));
    const len = dv.getUint32(i + 4, true);
    const data = i + 8;
    if (tag === 'EXIF') {
      let off = data;
      // payload may or may not start with "Exif\0\0"
      if (dv.getUint32(off) === 0x45786966) off += 6;
      parseTiff(dv, off, items);
    } else if (tag === 'XMP ') {
      items.push({ key: 'xmp', value: 'XMP', severity: 'med' });
    } else if (tag === 'ICCP') {
      items.push({ key: 'icc', value: 'ICC profile', severity: 'low' });
    }
    i += 8 + len + (len & 1);
  }
}

/* ---------- public API ---------- */

export async function inspectImage(file) {
  const buf = await file.arrayBuffer();
  const b = new Uint8Array(buf);
  const items = [];
  let container = 'unknown';
  if (b[0] === 0xff && b[1] === 0xd8) { container = 'jpeg'; parseJPEG(buf, items); }
  else if (b[0] === 0x89 && b[1] === 0x50) { container = 'png'; parsePNG(buf, items); }
  else if (b[0] === 0x52 && b[8] === 0x57 && b[9] === 0x45) { container = 'webp'; parseWebP(buf, items); }
  else if (b[0] === 0x47 && b[1] === 0x49) container = 'gif';
  else if (b[0] === 0x42 && b[1] === 0x4d) container = 'bmp';

  // visible-file facts (always shown, not sensitive)
  let w = 0, h = 0;
  try {
    const bmp = await createImageBitmap(file);
    w = bmp.width; h = bmp.height; bmp.close();
  } catch (e) { /* ignore */ }

  const meta = items.filter(it => !it.hidden);
  const sensitive = meta.filter(it => it.severity === 'high' || it.severity === 'med');
  const gpsCoords = items.find(it => it.key === 'gpsCoords');
  return { container, items: meta, sensitive, gps: gpsCoords ? gpsCoords.value : null, width: w, height: h };
}

/** Re-encode locally: pixels survive, every metadata byte is dropped. */
export async function cleanImage(file, format = 'image/png', quality = 0.92) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d');
  if (format === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise((res, rej) =>
    c.toBlob(b => b ? res(b) : rej(new Error('encode failed')), format, quality));
}

export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return Math.round(n / 1024) + ' KB';
  if (n < 1073741824) {
    const v = n / 1048576;
    return (v >= 10 ? Math.round(v) : v.toFixed(1)) + ' MB';
  }
  return (n / 1073741824).toFixed(2) + ' GB';
}
