/**
 * ==========================================================
 * Pokémon Master Set Companion
 * util.js
 *
 * Shared helpers: language list, safe DOM building, saved
 * preferences, downloads, CRC32, a tiny ZIP writer, and PNG
 * DPI tagging. No outside libraries.
 * ==========================================================
 */
"use strict";

// Every language TCGdex currently offers.
const LANGS = [
  ["en", "English"], ["ja", "Japanese"], ["fr", "French"], ["de", "German"],
  ["es", "Spanish"], ["it", "Italian"], ["pt-br", "Portuguese (BR)"],
  ["zh-tw", "Chinese (TW)"], ["id", "Indonesian"], ["th", "Thai"]
];
const LANG_CODES = LANGS.map(function (l) { return l[0]; });
const LANG_NAMES = Object.fromEntries(LANGS);


/**
 * Builds an element. Text is always set as text (never parsed as
 * HTML), so card data from the API can't inject markup or scripts.
 *
 * @param {string} tag
 * @param {Object} props  class, text, on<event>, value/checked/…, or attributes
 * @param {...(Node|string)} children
 * @return {HTMLElement}
 */
function el(tag, props) {
  const node = document.createElement(tag);
  const PROPS = ["value", "checked", "disabled", "selected", "hidden"];

  if (props) {
    Object.keys(props).forEach(function (k) {
      const v = props[k];
      if (v == null || v === false) {
        return;
      }
      if (k === "class") {
        node.className = v;
      } else if (k === "text") {
        node.textContent = v;
      } else if (k.indexOf("on") === 0 && typeof v === "function") {
        node.addEventListener(k.slice(2), v);
      } else if (PROPS.indexOf(k) !== -1) {
        node[k] = v;
      } else {
        node.setAttribute(k, v === true ? "" : String(v));
      }
    });
  }

  for (let i = 2; i < arguments.length; i++) {
    [].concat(arguments[i]).forEach(function (c) {
      if (c == null || c === false) {
        return;
      }
      node.append(c instanceof Node ? c : String(c));
    });
  }

  return node;
}


/** Replaces a node's children, skipping null/false entries. */
function setChildren(node) {
  const kids = [];
  for (let i = 1; i < arguments.length; i++) {
    [].concat(arguments[i]).forEach(function (c) {
      if (c != null && c !== false) { kids.push(c); }
    });
  }
  node.replaceChildren.apply(node, kids);
}


/** "1 card", "3 cards"; pass pluralWord for irregulars ("entry", "entries"). */
function plural(n, word, pluralWord) {
  return Number(n).toLocaleString() + " " + (n === 1 ? word : (pluralWord || word + "s"));
}


/** Builds an <option> list for a <select>. */
function options(pairs, selected) {
  return pairs.map(function (p) {
    return el("option", { value: p[0], selected: p[0] === selected, text: p[1] });
  });
}


/** Saved preferences (per browser). Fails quietly if storage is blocked. */
const Prefs = {
  get: function (key, fallback) {
    try {
      const v = localStorage.getItem("msc." + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (err) {
      return fallback;
    }
  },
  set: function (key, value) {
    try {
      localStorage.setItem("msc." + key, JSON.stringify(value));
    } catch (err) { /* storage unavailable — fine */ }
  }
};


function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}


function isAbort(err) {
  return err && err.name === "AbortError";
}


/** Safe filename fragment: letters and digits joined by "_". */
function fileSafe(text, fallback) {
  const s = String(text || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s || fallback || "file";
}


/** Saves a Blob to the user's Downloads folder. */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
}


// ---- CRC32 (used by ZIP and PNG) ------------------------------------

const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}


/**
 * Builds an uncompressed ("stored") ZIP. PNGs are already compressed,
 * so storing them costs almost nothing and keeps this tiny.
 *
 * @param {Object[]} files  [{ name, data: Uint8Array }]
 * @return {Blob}
 */
function makeZip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const parts = [];
  const central = [];
  let offset = 0;

  files.forEach(function (f) {
    const name = enc.encode(f.name);
    const crc  = crc32(f.data);
    const size = f.data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);      // UTF-8 names
    local.setUint16(8, 0, true);           // stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local, name, f.data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, dosTime, true);
    cen.setUint16(14, dosDate, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, size, true);
    cen.setUint32(24, size, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(cen, name);

    offset += 30 + name.length + size;
  });

  const cenSize = central.reduce(function (s, p) { return s + p.byteLength; }, 0);

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);

  return new Blob(parts.concat(central, [end]), { type: "application/zip" });
}


/**
 * Tags a PNG with its print resolution (pHYs chunk) so programs that
 * honour it open the sheet at the right physical size.
 *
 * @param {Uint8Array} bytes  a PNG straight from canvas.toBlob
 * @param {number} dpi
 * @return {Uint8Array}
 */
function pngWithDpi(bytes, dpi) {
  // Already tagged? Leave it alone.
  for (let i = 8; i + 8 < bytes.length && i < 4096; ) {
    const len  = new DataView(bytes.buffer, bytes.byteOffset + i, 4).getUint32(0);
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    if (type === "pHYs") {
      return bytes;
    }
    if (type === "IDAT") {
      break;
    }
    i += 12 + len;
  }

  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1;                          // unit: metre
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));

  // Signature (8) + IHDR chunk (25) = 33 bytes; pHYs goes right after.
  const out = new Uint8Array(bytes.length + 21);
  out.set(bytes.subarray(0, 33), 0);
  out.set(chunk, 33);
  out.set(bytes.subarray(33), 54);
  return out;
}
