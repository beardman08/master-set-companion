/**
 * ==========================================================
 * Pokémon Master Set Companion
 * api.js
 *
 * TCGdex (tcgdex.dev) access — free, open-source, multilingual,
 * no API key. Replaces UrlFetchApp with fetch() and keeps the same
 * retry behaviour for rate limits and hiccups.
 * ==========================================================
 */
"use strict";

const Api = (function () {

  const BASE = "https://api.tcgdex.net/v2/";

  // GraphQL returns full card details for a whole set in one request.
  // It only serves English, so other languages fetch card by card.
  const GRAPHQL = "https://api.tcgdex.net/v2/graphql";
  const SET_CARDS_QUERY =
    "query ($id: ID) { cards(filters: {id: $id}) { id localId name dexId rarity image " +
    "variants { normal reverse holo firstEdition } set { id } } }";

  // Sets that also exist in a Shadowless printing. TCGdex doesn't flag
  // Shadowless, so we add it for these set ids. (base1 = English Base Set.)
  const SHADOWLESS_SETS = ["base1"];

  const enc = encodeURIComponent;


  /**
   * GET with retries. Resolves to parsed JSON, or null on 404.
   *
   * @param {string} path  e.g. "en/cards/base1-4"
   * @param {AbortSignal} signal
   */
  function getJson(path, signal) {
    return request(BASE + path, { signal: signal, credentials: "omit" });
  }

  function postGraphql(query, variables, signal) {
    return request(GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, variables: variables }),
      signal: signal,
      credentials: "omit"
    });
  }

  async function request(url, init) {
    const maxAttempts = 4;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {

      let res;
      try {
        res = await fetch(url, init);
      } catch (err) {
        if (isAbort(err)) { throw err; }
        if (attempt === maxAttempts) {
          throw new Error("Couldn't reach TCGdex. Check your internet connection.");
        }
        await sleep(1000 * Math.pow(2, attempt - 1));
        continue;
      }

      if (res.ok) {
        return res.json();
      }
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 429 && res.status < 500) {
        throw new Error("TCGdex returned HTTP " + res.status + ".");
      }
      if (attempt === maxAttempts) {
        throw new Error("TCGdex is busy (HTTP " + res.status + "). Try again in a minute.");
      }
      await sleep(1000 * Math.pow(2, attempt - 1));
    }
  }


  function asArray(json) {
    return Array.isArray(json) ? json : [];
  }


  return {

    /**
     * Every card of a species by National Pokédex number. "eq:" forces
     * an exact match — without it, dexId=3 also matches 13, 30, 130…
     */
    searchByDex: async function (dexId, lang, signal) {
      return asArray(await getJson(lang + "/cards?dexId=eq:" + enc(dexId), signal));
    },

    /** Cards whose name contains the query (case-insensitive). */
    searchByName: async function (name, lang, signal) {
      return asArray(await getJson(lang + "/cards?name=" + enc(name), signal));
    },

    card: function (id, lang, signal) {
      return getJson(lang + "/cards/" + enc(id), signal);
    },

    /** All sets for a language, oldest first (TCGdex's default order). */
    sets: async function (lang, signal) {
      return asArray(await getJson(lang + "/sets", signal));
    },

    /** Full set (with its cards array), or null. */
    set: function (id, lang, signal) {
      return getJson(lang + "/sets/" + enc(id), signal);
    },

    /**
     * English only: full details for every card in a set, in one request.
     * The id filter is a "contains" match, so results are checked against
     * the set id. Cards it misses are fetched one by one by the caller.
     *
     * @return {Object[]}  card objects shaped like Api.card()
     */
    setCardsEnglish: async function (setId, signal) {
      const json = await postGraphql(SET_CARDS_QUERY, { id: setId + "-" }, signal);
      const list = json && json.data && Array.isArray(json.data.cards) ? json.data.cards : [];
      return list.filter(function (c) {
        return c && c.id && c.set && c.set.id === setId;
      });
    },

    /**
     * The finishes a card was printed in, from TCGdex's variant flags.
     * A card's base printing is Holofoil (holo rare) or Normal; Reverse
     * Holofoil and 1st Edition are added when present; Shadowless is
     * added for SHADOWLESS_SETS.
     *
     * @param {Object} card
     * @return {string[]}
     */
    finishesFor: function (card) {
      const v = card.variants || {};
      const finishes = [];

      if (v.holo) {
        finishes.push("Holofoil");
      } else if (v.normal) {
        finishes.push("Normal");
      }
      if (v.reverse) {
        finishes.push("Reverse Holofoil");
      }
      if (v.firstEdition) {
        finishes.push(v.holo ? "1st Edition Holofoil" : "1st Edition");
      }

      const setId = card.set && card.set.id ? card.set.id : "";
      if (SHADOWLESS_SETS.indexOf(setId) !== -1) {
        finishes.push(v.holo ? "Shadowless Holofoil" : "Shadowless");
      }

      return finishes.length ? finishes : ["Standard"];
    }

  };

})();
