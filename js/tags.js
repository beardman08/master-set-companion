/**
 * ==========================================================
 * Pokémon Master Set Companion
 * tags.js
 *
 * Your own edits — Cameo and Featured — kept apart from the card
 * catalog so re-importing or clearing cards never touches them.
 *
 * Tags are keyed by TCGdex card id (e.g. "base1-23"), so one tag
 * covers every finish of that card, and every language that TCGdex
 * lists under the same id.
 *
 * Tags are always saved in this browser, and — once you pick a
 * file — also to master-set-tags.json in a folder of your choice
 * (e.g. OneDrive). Every save re-reads the file and merges by
 * newest edit, so two computers sharing it don't wipe each other.
 * ==========================================================
 */
"use strict";

const Tags = (function () {

  const FILE_KIND  = "pokemon-master-set-tags";
  const META_KEY   = "tagsFile";
  const SAVE_DELAY = 700;   // ms after the last edit before writing the file

  const SUPPORTED = typeof window.showSaveFilePicker === "function" &&
                    typeof window.showOpenFilePicker === "function";

  const tags = new Map();   // cardId -> { cardId, cameo, featured, label, updated }
  const listeners = [];

  // status: unsupported | local | reconnect | saving | saved | error
  const state = { status: SUPPORTED ? "local" : "unsupported", fileName: "", error: "" };

  let handle = null;
  let dirty = false;        // edits not yet written to the file
  let saveTimer = null;
  let queue = Promise.resolve();


  /** kind: "data" (tags changed) or "status" (file/save state changed). */
  function emit(kind) {
    listeners.forEach(function (fn) { fn(kind); });
  }

  function setStatus(s, error) {
    state.status = s;
    state.error = error || "";
    emit("status");
  }

  function str(v, max) {
    return v == null ? "" : String(v).slice(0, max || 500);
  }

  function normalize(cardId, raw) {
    return {
      cardId:   str(cardId, 200),
      cameo:    str(raw.cameo).trim(),
      featured: raw.featured == null ? null : str(raw.featured).trim(),
      label:    str(raw.label, 200),
      updated:  Number(raw.updated) || 0
    };
  }

  function persist(list) {
    if (!list.length) { return Promise.resolve(); }
    return Db.tx("tags", "readwrite", function (s) {
      list.forEach(function (t) { s.put(t); });
    });
  }


  // ---- File format ----------------------------------------------------

  function serialize() {
    const out = {};
    Array.from(tags.values())
      .sort(function (a, b) { return a.cardId.localeCompare(b.cardId); })
      .forEach(function (t) {
        out[t.cardId] = { cameo: t.cameo, featured: t.featured, label: t.label, updated: t.updated };
      });
    return JSON.stringify({
      app: FILE_KIND,
      version: 1,
      saved: new Date().toISOString(),
      tags: out
    }, null, 1);
  }

  /** Reads a tags file (or an older full backup). Empty text = new file. */
  function parse(text) {
    if (!String(text).trim()) {
      return [];
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error("That file isn't a Master Set tags file (not valid JSON).");
    }

    // Backups from the first version of the app: card rows with a cameo.
    if (data && Array.isArray(data.cards)) {
      return data.cards
        .filter(function (r) { return r && typeof r.id === "string" && r.cameo; })
        .map(function (r) {
          return normalize(r.cardId || r.id.split("::")[0], { cameo: r.cameo, updated: 1 });
        });
    }

    if (!data || data.app !== FILE_KIND || !data.tags || typeof data.tags !== "object") {
      throw new Error("That file isn't a Master Set tags file.");
    }
    return Object.keys(data.tags).map(function (id) {
      return normalize(id, data.tags[id] || {});
    });
  }

  /**
   * Merges incoming tags: per card, the newest edit wins.
   * @return {Object}  { changed: [tags updated here], localNewer: bool }
   */
  function merge(list) {
    const changed = [];
    const seen = new Set();
    let localNewer = false;

    list.forEach(function (t) {
      if (!t.cardId) { return; }
      seen.add(t.cardId);
      const mine = tags.get(t.cardId);
      if (!mine || t.updated > mine.updated) {
        tags.set(t.cardId, t);
        changed.push(t);
      } else if (mine.updated > t.updated) {
        localNewer = true;
      }
    });
    tags.forEach(function (t, id) {
      if (!seen.has(id)) { localNewer = true; }
    });

    return { changed: changed, localNewer: localNewer };
  }


  // ---- File access ----------------------------------------------------

  async function permission(h, ask) {
    if (typeof h.queryPermission !== "function") {
      return "granted";
    }
    const opts = { mode: "readwrite" };
    let p = await h.queryPermission(opts);
    if (p !== "granted" && ask) {
      p = await h.requestPermission(opts);
    }
    return p;
  }

  /** Re-reads the file, merges, and writes back if this browser has newer edits. */
  async function sync() {
    let text;
    try {
      text = await (await handle.getFile()).text();
    } catch (err) {
      throw new Error("Couldn't read " + handle.name + " (was it moved or deleted?). Choose it again on the Data page.");
    }
    const r = merge(parse(text));
    await persist(r.changed);

    if (r.localNewer || dirty) {
      const w = await handle.createWritable();
      await w.write(serialize());
      await w.close();
    }
    dirty = false;
    if (r.changed.length) { emit("data"); }
  }

  /** Writes pending edits (serialised so saves never overlap). */
  function flush() {
    clearTimeout(saveTimer);
    queue = queue.then(async function () {
      if (!handle || !dirty) { return; }
      try {
        if (await permission(handle, false) !== "granted") {
          setStatus("reconnect");
          return;
        }
        setStatus("saving");
        await sync();
        setStatus("saved");
      } catch (err) {
        setStatus("error", err.message);
      }
    });
    return queue;
  }

  function scheduleSave() {
    dirty = true;
    if (!handle || state.status === "reconnect") {
      emit("status");
      return;
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DELAY);
    if (state.status !== "error") { setStatus("saving"); }
  }

  /** Links a file handle, merges it with this browser's tags and saves. */
  async function useHandle(h) {
    if (await permission(h, true) !== "granted") {
      throw new Error("Permission to save to that file wasn't given.");
    }
    const previous = handle;
    handle = h;
    state.fileName = h.name;
    try {
      setStatus("saving");
      await sync();
    } catch (err) {
      handle = previous;
      state.fileName = previous ? previous.name : "";
      setStatus(previous ? "saved" : (SUPPORTED ? "local" : "unsupported"));
      throw err;
    }
    await Db.setMeta(META_KEY, h);
    setStatus("saved");
  }

  function pickerTypes() {
    return [{ description: "Master Set tags", accept: { "application/json": [".json"] } }];
  }


  // ---- Public ---------------------------------------------------------

  return {

    SUPPORTED: SUPPORTED,

    /** Loads tags from this browser, then reconnects the file if allowed. */
    load: async function () {
      const list = await Db.tx("tags", "readonly", function (s) { return s.getAll(); });
      (list || []).forEach(function (t) { tags.set(t.cardId, t); });

      if (!SUPPORTED) {
        setStatus("unsupported");
        return;
      }
      let h = null;
      try { h = await Db.getMeta(META_KEY); } catch (err) { h = null; }
      if (!h) {
        setStatus("local");
        return;
      }
      handle = h;
      state.fileName = h.name;
      try {
        if (await permission(h, false) === "granted") {
          setStatus("saving");
          await sync();
          setStatus("saved");
        } else {
          setStatus("reconnect");
        }
      } catch (err) {
        setStatus("error", err.message);
      }
    },

    onChange: function (fn) { listeners.push(fn); },

    state: function () { return Object.assign({}, state, { dirty: dirty }); },

    get: function (cardId) { return tags.get(cardId) || null; },

    /** Number of cards with a Cameo or Featured tag. */
    count: function () {
      let n = 0;
      tags.forEach(function (t) { if (t.cameo || t.featured != null) { n++; } });
      return n;
    },

    /**
     * Sets a card's cameo or featured tag. Featured null = use the import's.
     * @param {string} cardId
     * @param {string} field  "cameo" | "featured"
     * @param {string|null} value
     * @param {string} label  human hint stored in the file, e.g. "Arcanine — Base Set 23"
     */
    set: function (cardId, field, value, label) {
      const prev = tags.get(cardId) || { cardId: cardId, cameo: "", featured: null, label: "", updated: 0 };
      const next = Object.assign({}, prev, { updated: Math.max(Date.now(), prev.updated + 1) });
      if (field === "cameo") {
        next.cameo = str(value).trim();
      } else if (field === "featured") {
        next.featured = value == null ? null : str(value).trim();
      } else {
        return;
      }
      if (label) { next.label = str(label, 200); }
      tags.set(cardId, next);
      persist([next]).catch(function (err) { setStatus("error", err.message); });
      emit("data");
      scheduleSave();
    },

    /** Create a new tags file (or overwrite-merge an existing one). */
    connectNew: async function () {
      const h = await window.showSaveFilePicker({
        suggestedName: "master-set-tags.json",
        types: pickerTypes()
      });
      dirty = true;
      await useHandle(h);
    },

    /** Use a tags file you already have (e.g. from another computer). */
    connectExisting: async function () {
      const picked = await window.showOpenFilePicker({ types: pickerTypes(), multiple: false });
      await useHandle(picked[0]);
    },

    /** Re-grant access after a browser restart (needs a click). */
    reconnect: async function () {
      if (!handle) { return; }
      if (await permission(handle, true) !== "granted") {
        setStatus("reconnect");
        return;
      }
      try {
        setStatus("saving");
        await sync();
        setStatus("saved");
      } catch (err) {
        setStatus("error", err.message);
      }
    },

    /** Stop saving to the file (tags stay in this browser). */
    disconnect: async function () {
      await flush();
      handle = null;
      state.fileName = "";
      await Db.deleteMeta(META_KEY);
      setStatus("local");
    },

    flush: flush,

    exportJson: function () { return serialize(); },

    /** Merges a tags file or backup. Resolves to the number of tags read. */
    importJson: async function (text) {
      const list = parse(text);
      const r = merge(list);
      await persist(r.changed);
      if (r.changed.length) {
        emit("data");
        scheduleSave();
      }
      return list.length;
    }

  };

})();
