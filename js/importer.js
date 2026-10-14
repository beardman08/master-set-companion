/**
 * ==========================================================
 * Pokémon Master Set Companion
 * importer.js
 *
 * Imports cards from TCGdex into the catalog:
 *   - by Pokédex number or name, in one or every language
 *   - one whole set, in one language
 *   - every set for one or every language, in release order
 *
 * Cards already saved (any finish, same language) are skipped
 * without re-fetching, so re-running an import only adds what's
 * new. Rows are saved as they arrive, so stopping keeps progress
 * and the next run picks up where it left off.
 * ==========================================================
 */
"use strict";

const Importer = (function () {

  // A working dex/name filter returns one species' cards (dozens, at most
  // a few hundred). Thousands means the filter was ignored — stop.
  const MAX_RESULTS = 1500;

  // Parallel card requests. Polite to the API, much faster than one at a time.
  const CONCURRENCY = 4;

  // Save to the catalog every this many fetched cards.
  const FLUSH_EVERY = 25;

  // TCGdex series id for Pokémon TCG Pocket (digital-only cards).
  const POCKET_SERIES = "tcgp";


  /** Runs worker over items, CONCURRENCY at a time. Stops on abort. */
  async function pool(items, signal, worker) {
    let next = 0;
    const runners = [];
    for (let r = 0; r < Math.min(CONCURRENCY, items.length); r++) {
      runners.push((async function () {
        while (next < items.length && !signal.aborted) {
          await worker(items[next++]);
        }
      })());
    }
    await Promise.all(runners);
  }


  /** Fetches a card; null if it fails (one bad card shouldn't stop the run). */
  async function safeCard(id, lang, signal) {
    try {
      return await Api.card(id, lang, signal);
    } catch (err) {
      if (isAbort(err)) { throw err; }
      return null;
    }
  }


  /** One catalog row per finish. */
  function rowsForCard(card, lang, meta, featured) {
    return Api.finishesFor(card).map(function (finish) {
      return {
        id:              card.id + "::" + finish + "::" + lang,
        cardId:          card.id,
        name:            card.name || "",
        dex:             (card.dexId || []).join(", "),
        set:             meta.setName,
        setId:           meta.setId,
        series:          meta.series,
        releaseDate:     meta.releaseDate,
        setIcon:         meta.symbol,
        number:          card.localId != null ? card.localId : "",
        total:           meta.total,
        variant:         finish,
        language:        lang,
        year:            meta.releaseDate.slice(0, 4),
        rarity:          card.rarity && card.rarity !== "None" ? card.rarity : "",
        imageUrl:        card.image ? card.image + "/high.png" : "",
        featuredPokemon: featured || ""
      };
    });
  }


  function setMeta(set) {
    return {
      setName:     set && set.name ? set.name : "",
      setId:       set && set.id ? set.id : "",
      series:      set && set.serie && set.serie.id ? set.serie.id : "",
      releaseDate: set && set.releaseDate ? String(set.releaseDate).slice(0, 10) : "",
      symbol:      set && set.symbol ? set.symbol + ".png" : "",
      total:       set && set.cardCount && set.cardCount.official != null ? set.cardCount.official : ""
    };
  }


  /** Batches rows and saves them every FLUSH_EVERY cards. */
  function saver() {
    let buffer = [];
    let added = 0;
    return {
      push: function (rows) { buffer = buffer.concat(rows); },
      flushIfFull: async function (count) {
        if (count % FLUSH_EVERY === 0) { await this.flush(); }
      },
      flush: async function () {
        const rows = buffer;
        buffer = [];
        added += await Store.addNew(rows);
      },
      added: function () { return added; }
    };
  }


  /**
   * Imports every card for a species. A numeric query is a National
   * Pokédex number (works in every language); anything else is a name
   * search in that language.
   *
   * @param {string} query   e.g. "59" or "Misty"
   * @param {string[]} langs
   * @param {Object} opts    { signal, onProgress(text, fraction), includePocket }
   * @return {Object}        { found, added, tagged, pocketSkipped, skippedLangs, cancelled }
   */
  async function byPokemon(query, langs, opts) {
    const signal = opts.signal;
    const progress = opts.onProgress || function () {};
    const isDex = /^\d+$/.test(query);
    const save = saver();
    const setCache = new Map(); // "lang/setId" -> Promise<set meta>
    const skippedLangs = [];
    let tagged = 0;
    let pocketSkipped = 0;
    let found = 0;

    function metaFor(card, lang) {
      const setId = card.set && card.set.id;
      if (!setId) {
        return Promise.resolve(setMeta(card.set));
      }
      const key = lang + "/" + setId;
      if (!setCache.has(key)) {
        // Card data lacks the release date, so fetch the set once.
        setCache.set(key, Api.set(setId, lang, signal)
          .then(function (full) { return setMeta(full || card.set); })
          .catch(function (err) {
            if (isAbort(err)) { throw err; }
            return setMeta(card.set);
          }));
      }
      return setCache.get(key);
    }

    try {
      for (let li = 0; li < langs.length && !signal.aborted; li++) {

        const lang = langs[li];
        const langName = LANG_NAMES[lang] || lang;
        const base = li / langs.length;
        const span = 1 / langs.length;

        progress("Searching " + langName + "…", base);

        let briefs;
        try {
          briefs = isDex
            ? await Api.searchByDex(query, lang, signal)
            : await Api.searchByName(query, lang, signal);
        } catch (err) {
          if (isAbort(err)) { throw err; }
          skippedLangs.push(langName);
          continue;
        }

        if (briefs.length > MAX_RESULTS) {
          throw new Error(
            "Got " + briefs.length + " results for \"" + query + "\" in " + langName +
            " — far too many for one species, so this language was stopped."
          );
        }

        found += briefs.length;

        // Already saved: just make sure it's tagged with this query.
        const touched = [];
        const todo = briefs.filter(function (b) {
          if (Store.hasCard(b.id, lang)) {
            touched.push.apply(touched, Store.tagFeatured(b.id, lang, query));
            return false;
          }
          return true;
        });
        tagged += touched.length;
        await Store.saveMany(touched);

        let done = 0;
        await pool(todo, signal, async function (brief) {
          const card = await safeCard(brief.id, lang, signal);
          if (card) {
            const meta = await metaFor(card, lang);
            if (meta.series === POCKET_SERIES && !opts.includePocket) {
              pocketSkipped++;
            } else {
              save.push(rowsForCard(card, lang, meta, query));
            }
          }
          done++;
          progress(langName + ": " + done + " of " + todo.length + " new cards",
                   base + span * (done / Math.max(1, todo.length)));
          await save.flushIfFull(done);
        });

        await save.flush();
      }
    } catch (err) {
      await save.flush();
      if (!isAbort(err)) { throw err; }
    }

    await save.flush();
    return {
      found: found,
      added: save.added(),
      tagged: tagged,
      pocketSkipped: pocketSkipped,
      skippedLangs: skippedLangs,
      cancelled: signal.aborted
    };
  }


  /**
   * Saves every missing card of one set (already fetched with its card
   * list). English uses one bulk request; anything it misses — and every
   * other language — is fetched card by card.
   *
   * @return {number}  rows added
   */
  async function fillSet(set, lang, signal, onCard) {
    const meta = setMeta(set);
    const save = saver();
    const todo = (set.cards || []).filter(function (b) { return !Store.hasCard(b.id, lang); });
    if (!todo.length) {
      return 0;
    }

    let bulk = new Map();
    if (lang === "en") {
      try {
        (await Api.setCardsEnglish(set.id, signal)).forEach(function (c) { bulk.set(c.id, c); });
      } catch (err) {
        if (isAbort(err)) { throw err; }
        bulk = new Map(); // fall back to card-by-card
      }
    }

    const missing = [];
    todo.forEach(function (b) {
      if (bulk.has(b.id)) {
        save.push(rowsForCard(bulk.get(b.id), lang, meta, ""));
      } else {
        missing.push(b);
      }
    });
    if (bulk.size) {
      onCard(todo.length - missing.length);
      await save.flush();
    }

    let done = 0;
    try {
      await pool(missing, signal, async function (brief) {
        const card = await safeCard(brief.id, lang, signal);
        if (card) {
          save.push(rowsForCard(card, lang, meta, ""));
        }
        done++;
        onCard(1);
        await save.flushIfFull(done);
      });
    } finally {
      await save.flush();
    }
    return save.added();
  }


  /**
   * Imports every card of one set in one language.
   *
   * @param {string} setId
   * @param {string} lang
   * @param {Object} opts  { signal, onProgress(text, fraction) }
   * @return {Object}      { added, setName, cancelled }
   */
  async function bySet(setId, lang, opts) {
    const signal = opts.signal;
    const progress = opts.onProgress || function () {};

    progress("Loading set…", 0);
    const set = await Api.set(setId, lang, signal);
    if (!set || !set.id) {
      throw new Error("TCGdex has no set \"" + setId + "\" in " + (LANG_NAMES[lang] || lang) + ".");
    }

    const todoCount = (set.cards || []).filter(function (b) { return !Store.hasCard(b.id, lang); }).length;
    let done = 0;
    let added = 0;
    try {
      added = await fillSet(set, lang, signal, function (n) {
        done += n;
        progress(set.name + ": " + done + " of " + todoCount + " new cards", done / Math.max(1, todoCount));
      });
    } catch (err) {
      if (!isAbort(err)) { throw err; }
    }
    return { added: added, setName: set.name, cancelled: signal.aborted };
  }


  /**
   * Imports every set for each language, oldest set first (TCGdex lists
   * sets in release order). Sets already complete are skipped without
   * any requests, so re-running resumes where it stopped.
   *
   * @param {string[]} langs
   * @param {Object} opts  { signal, onProgress(text, fraction), includePocket }
   * @return {Object}      { added, setsImported, setsComplete, pocketSets, failedSets, failedLangs, cancelled }
   */
  async function allSets(langs, opts) {
    const signal = opts.signal;
    const progress = opts.onProgress || function () {};
    const out = {
      added: 0, setsImported: 0, setsComplete: 0, pocketSets: 0,
      failedSets: [], failedLangs: [], cancelled: false
    };

    try {
      for (let li = 0; li < langs.length && !signal.aborted; li++) {

        const lang = langs[li];
        const langName = LANG_NAMES[lang] || lang;
        const langBase = li / langs.length;
        const langSpan = 1 / langs.length;

        progress(langName + ": loading the set list…", langBase);

        let sets;
        try {
          sets = await Api.sets(lang, signal);
        } catch (err) {
          if (isAbort(err)) { throw err; }
          out.failedLangs.push(langName);
          continue;
        }

        for (let si = 0; si < sets.length && !signal.aborted; si++) {

          const brief = sets[si];
          const where = langName + " · set " + (si + 1) + " of " + sets.length + " · " + brief.name;
          const frac = langBase + langSpan * (si / Math.max(1, sets.length));

          // Already have every card? Skip without asking TCGdex.
          const total = brief.cardCount && brief.cardCount.total;
          if (total && Store.countSet(brief.id, lang) >= total) {
            out.setsComplete++;
            continue;
          }

          progress(where, frac);

          let set;
          try {
            set = await Api.set(brief.id, lang, signal);
          } catch (err) {
            if (isAbort(err)) { throw err; }
            out.failedSets.push(langName + " " + brief.name);
            continue;
          }
          if (!set || !set.id) {
            continue;
          }
          if (set.serie && set.serie.id === POCKET_SERIES && !opts.includePocket) {
            out.pocketSets++;
            continue;
          }

          const todoCount = (set.cards || []).filter(function (b) { return !Store.hasCard(b.id, lang); }).length;
          let done = 0;
          const added = await fillSet(set, lang, signal, function (n) {
            done += n;
            progress(where + " · " + done + " of " + todoCount + " cards",
                     frac + (langSpan / Math.max(1, sets.length)) * (done / Math.max(1, todoCount)));
          });
          out.added += added;
          if (added) { out.setsImported++; } else { out.setsComplete++; }
        }
      }
    } catch (err) {
      if (!isAbort(err)) { throw err; }
    }

    out.cancelled = signal.aborted;
    return out;
  }


  return { byPokemon: byPokemon, bySet: bySet, allSets: allSets };

})();
