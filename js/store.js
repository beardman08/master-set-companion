/**
 * ==========================================================
 * Pokémon Master Set Companion
 * store.js
 *
 * Local database (IndexedDB) with three stores:
 *   cards — the card catalog, one row per card × finish × language,
 *           keyed "cardId::finish::lang". Re-downloadable from TCGdex.
 *   tags  — your Cameo / Featured edits, keyed by card id (see tags.js).
 *   meta  — small settings, e.g. the linked tags file.
 *
 * The catalog is kept in memory for fast filtering and written
 * through to IndexedDB on every change.
 * ==========================================================
 */
"use strict";

// Fields every catalog row carries.
const CARD_FIELDS = [
  "id", "cardId", "name", "dex", "set", "setId", "series", "releaseDate", "setIcon",
  "number", "total", "variant", "language", "year", "rarity", "imageUrl", "featuredPokemon"
];

// Order finishes sort in, within the same card.
const VARIANT_ORDER = [
  "Normal", "Holofoil", "Reverse Holofoil", "1st Edition", "1st Edition Holofoil",
  "Shadowless", "Shadowless Holofoil", "Standard"
];


/** Shared IndexedDB connection and transaction helper. */
const Db = (function () {

  const NAME = "master-set-companion";
  const VERSION = 2;
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        const req = indexedDB.open(NAME, VERSION);
        req.onupgradeneeded = function () {
          const db = req.result;
          if (!db.objectStoreNames.contains("cards")) { db.createObjectStore("cards", { keyPath: "id" }); }
          if (!db.objectStoreNames.contains("tags"))  { db.createObjectStore("tags", { keyPath: "cardId" }); }
          if (!db.objectStoreNames.contains("meta"))  { db.createObjectStore("meta"); }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
        req.onblocked = function () {
          reject(new Error("Another tab has an older version of the app open. Close it and reload."));
        };
      });
    }
    return dbPromise;
  }

  /** Runs fn(objectStore) in one transaction; resolves when it commits. */
  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(store, mode);
        const out = fn(t.objectStore(store));
        t.oncomplete = function () {
          resolve(out instanceof IDBRequest ? out.result : out);
        };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  return {
    tx: tx,
    getMeta: function (key) {
      return tx("meta", "readonly", function (s) { return s.get(key); });
    },
    setMeta: function (key, value) {
      return tx("meta", "readwrite", function (s) { s.put(value, key); });
    },
    deleteMeta: function (key) {
      return tx("meta", "readwrite", function (s) { s.delete(key); });
    }
  };

})();


/** The card catalog. */
const Store = (function () {

  const cards = new Map();     // id -> row
  const cardKeys = new Map();  // "cardId::lang" -> [row ids]
  const setCards = new Map();  // "setId::lang" -> Set(cardId)
  const listeners = [];
  let seq = 0;
  let version = 0;             // bumps on every change (for caches)


  function index(row) {
    cards.set(row.id, row);

    const key = row.cardId + "::" + row.language;
    const ids = cardKeys.get(key) || [];
    if (ids.indexOf(row.id) === -1) { ids.push(row.id); }
    cardKeys.set(key, ids);

    const sk = row.setId + "::" + row.language;
    if (!setCards.has(sk)) { setCards.set(sk, new Set()); }
    setCards.get(sk).add(row.cardId);

    seq = Math.max(seq, row.addedAt || 0);
  }


  function unindex(id) {
    const row = cards.get(id);
    if (!row) { return; }
    cards.delete(id);

    const key = row.cardId + "::" + row.language;
    const ids = (cardKeys.get(key) || []).filter(function (x) { return x !== id; });
    if (ids.length) {
      cardKeys.set(key, ids);
    } else {
      cardKeys.delete(key);
      const sk = row.setId + "::" + row.language;
      if (setCards.has(sk)) { setCards.get(sk).delete(row.cardId); }
    }
  }


  function changed() {
    version++;
    listeners.forEach(function (fn) { fn(); });
  }


  /** Normalises a row to known fields, all as text. */
  function clean(raw) {
    const c = {};
    CARD_FIELDS.forEach(function (f) {
      c[f] = raw[f] == null ? "" : String(raw[f]).slice(0, 2000);
    });
    // Images may only be web addresses.
    ["imageUrl", "setIcon"].forEach(function (f) {
      if (c[f] && !/^https:\/\//i.test(c[f])) { c[f] = ""; }
    });
    c.addedAt = Number(raw.addedAt) || 0;
    if (!c.cardId) { c.cardId = c.id.split("::")[0]; }
    if (!c.language) { c.language = c.id.split("::")[2] || ""; }
    return c;
  }


  return {

    /** Loads the saved catalog. Resolves to the raw rows (for migration). */
    load: function () {
      return Db.tx("cards", "readonly", function (s) { return s.getAll(); }).then(function (all) {
        cards.clear();
        cardKeys.clear();
        setCards.clear();
        (all || []).forEach(index);
        changed();
        return all || [];
      });
    },

    onChange: function (fn) { listeners.push(fn); },

    version: function () { return version; },

    all: function () { return Array.from(cards.values()); },

    size: function () { return cards.size; },

    /** True when any finish of this card in this language is saved. */
    hasCard: function (cardId, lang) { return cardKeys.has(cardId + "::" + lang); },

    /** Number of distinct cards saved for a set in a language. */
    countSet: function (setId, lang) {
      const s = setCards.get(setId + "::" + lang);
      return s ? s.size : 0;
    },

    /** Adds rows not already present. Resolves to the number added. */
    addNew: function (rows) {
      const fresh = [];
      rows.forEach(function (r) {
        if (!cards.has(r.id)) {
          const c = clean(r);
          c.addedAt = ++seq;
          index(c);
          fresh.push(c);
        }
      });
      if (!fresh.length) {
        return Promise.resolve(0);
      }
      return Db.tx("cards", "readwrite", function (s) {
        fresh.forEach(function (c) { s.put(c); });
      }).then(function () {
        changed();
        return fresh.length;
      });
    },

    /**
     * Adds an import tag (the dex number or name searched for) to every
     * saved finish of a card, so cards found by a name search stay
     * grouped under it. Returns the changed rows; pass them to saveMany.
     */
    tagFeatured: function (cardId, lang, token) {
      const t = String(token || "").trim();
      const touched = [];
      (cardKeys.get(cardId + "::" + lang) || []).forEach(function (id) {
        const c = cards.get(id);
        if (t && Collection.tokens(c.featuredPokemon).indexOf(t.toLowerCase()) === -1) {
          c.featuredPokemon = c.featuredPokemon ? c.featuredPokemon + ", " + t : t;
          touched.push(c);
        }
      });
      return touched;
    },

    saveMany: function (list) {
      if (!list.length) {
        return Promise.resolve();
      }
      list.forEach(index);
      return Db.tx("cards", "readwrite", function (s) {
        list.forEach(function (c) { s.put(c); });
      }).then(changed);
    },

    remove: function (ids) {
      ids.forEach(unindex);
      return Db.tx("cards", "readwrite", function (s) {
        ids.forEach(function (id) { s.delete(id); });
      }).then(changed);
    },

    clear: function () {
      cards.clear();
      cardKeys.clear();
      setCards.clear();
      return Db.tx("cards", "readwrite", function (s) { s.clear(); }).then(changed);
    }

  };

})();


/**
 * Filtering, sorting and display helpers for catalog rows.
 * Cameo / Featured come from Tags, so they survive re-imports.
 */
const Collection = (function () {

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  let sortedCache = { key: "", list: [] };
  let setNamesCache = { key: "", byLang: {} };

  function tokens(value) {
    return String(value || "").toLowerCase()
      .split(/[;,]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  /** Release order: set release date, then set, number, finish, language. */
  function compare(a, b) {
    return (a.releaseDate || a.year || "9999").localeCompare(b.releaseDate || b.year || "9999") ||
           collator.compare(a.setId, b.setId) ||
           collator.compare(a.number, b.number) ||
           VARIANT_ORDER.indexOf(a.variant) - VARIANT_ORDER.indexOf(b.variant) ||
           LANG_CODES.indexOf(a.language) - LANG_CODES.indexOf(b.language) ||
           a.addedAt - b.addedAt;
  }

  /** Whole catalog, sorted once per change. */
  function sorted() {
    const key = String(Store.version());
    if (sortedCache.key !== key) {
      sortedCache = { key: key, list: Store.all().sort(compare) };
    }
    return sortedCache.list;
  }

  return {

    tokens: tokens,

    /** Your Featured tag if you've set one, else the import's. */
    featured: function (row) {
      const t = Tags.get(row.cardId);
      return t && t.featured != null ? t.featured : row.featuredPokemon;
    },

    cameo: function (row) {
      const t = Tags.get(row.cardId);
      return t ? t.cameo : "";
    },

    /**
     * Whole-token match on dex, Featured or Cameo, so "5" doesn't match
     * "59" and "Team Rocket" stays one token.
     */
    matchesPokemon: function (row, target) {
      const t = String(target || "").trim().toLowerCase();
      if (!t) {
        return true;
      }
      return tokens(row.dex).indexOf(t) !== -1 ||
             tokens(this.featured(row)).indexOf(t) !== -1 ||
             tokens(this.cameo(row)).indexOf(t) !== -1;
    },

    /**
     * Applies the shared filter: { pokemon, set, lang, text }.
     * @return {Object[]}  rows in release order
     */
    filter: function (f) {
      const self = this;
      const text = String(f.text || "").trim().toLowerCase();
      return sorted().filter(function (c) {
        if (f.set && c.set !== f.set) { return false; }
        if (f.lang && c.language !== f.lang) { return false; }
        if (!self.matchesPokemon(c, f.pokemon)) { return false; }
        if (text) {
          const hay = (c.name + " " + c.set + " " + c.number + " " + c.rarity + " " + c.variant + " " +
                       self.featured(c) + " " + self.cameo(c)).toLowerCase();
          if (hay.indexOf(text) === -1) { return false; }
        }
        return true;
      });
    },

    /** "103/132" when both parts exist; special numbers (H2, TG01) as-is. */
    displayNumber: function (row) {
      const n = String(row.number || "");
      return (/^\d+$/.test(n) && row.total) ? n + "/" + row.total : n;
    },

    /** "English · 1999" */
    langYear: function (row) {
      const lang = LANG_NAMES[row.language] ||
                   (row.language ? String(row.language).toUpperCase() : "");
      return [lang, row.year].filter(Boolean).join("  ·  ");
    },

    /** Distinct set names in release order, for the set filter. */
    setNames: function (lang) {
      const key = String(Store.version());
      if (setNamesCache.key !== key) {
        setNamesCache = { key: key, byLang: {} };
      }
      const k = lang || "*";
      if (!setNamesCache.byLang[k]) {
        const seen = new Set();
        const names = [];
        sorted().forEach(function (c) {
          if (c.set && (!lang || c.language === lang) && !seen.has(c.set)) {
            seen.add(c.set);
            names.push(c.set);
          }
        });
        setNamesCache.byLang[k] = names;
      }
      return setNamesCache.byLang[k].slice();
    }

  };

})();
