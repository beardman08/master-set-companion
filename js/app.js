/**
 * ==========================================================
 * Pokémon Master Set Companion
 * app.js
 *
 * The interface: Import, Collection, Print, Cricut export and Data
 * views, a shared filter (Pokémon / set / language / search), a job
 * panel for long imports and exports, and the tags-file status.
 * ==========================================================
 */
"use strict";

(function () {

  const LIVE_SITE = "https://beardman08.github.io/master-set-companion/";
  const PAGE_SIZE = 200;           // collection rows shown per "Show more"
  const PRINT_PER_PAGE = 9;        // 3×3 cards on Letter
  const MAX_PRINT_CARDS = 900;     // 100 pages — more than that, filter first
  const MAX_CRICUT_SHEETS = 100;   // per export (each sheet is a few MB)

  const VIEWS = [
    ["import", "Import"],
    ["collection", "Collection"],
    ["print", "Print"],
    ["cricut", "Cricut export"],
    ["data", "Data"]
  ];

  const state = {
    view:   Prefs.get("view", "import"),
    filter: Object.assign({ pokemon: "", set: "", lang: "", text: "" }, Prefs.get("filter", {})),
    limit:  PAGE_SIZE,
    job:    null,        // { kind, label, controller }
    quiet:  false,       // true while saving an inline edit (don't redraw the table)
    sets:   new Map(),   // lang -> [{ id, name }]
    cricut: { files: [], label: "", sheets: 0 }
  };

  if (!VIEWS.some(function (v) { return v[0] === state.view; })) {
    state.view = "import";
  }

  const $ = function (id) { return document.getElementById(id); };
  let refreshResults = null;     // current view's results redraw (filtered views)
  let refreshSetOptions = null;
  let refreshDataView = null;


  // ---- Navigation ---------------------------------------------------

  function renderNav() {
    setChildren($("nav"), VIEWS.map(function (v) {
      return el("button", {
        class: "tab" + (state.view === v[0] ? " active" : ""),
        "aria-current": state.view === v[0] ? "page" : null,
        text: v[1],
        onclick: function () { show(v[0]); }
      });
    }));
  }

  function show(view) {
    state.view = view;
    state.limit = PAGE_SIZE;
    Prefs.set("view", view);
    renderNav();
    renderView();
    renderTagsStatus();
    window.scrollTo(0, 0);
  }

  function renderView() {
    refreshResults = null;
    refreshSetOptions = null;
    refreshDataView = null;
    const builders = {
      import: viewImport, collection: viewCollection, print: viewPrint,
      cricut: viewCricut, data: viewData
    };
    setChildren($("view"), builders[state.view]());
    if (refreshResults) { refreshResults(); }
    updateBusy();
  }

  function updateCount() {
    $("count").textContent = plural(Store.size(), "card") + " · " + Tags.count() + " tagged";
  }


  // ---- Where tags are saved (header button + banner) ----------------

  function cloudTrouble() {
    const c = Cloud.state();
    return c.status === "denied" || (c.status === "error" && Cloud.AVAILABLE);
  }

  function renderTagsStatus() {
    const s = Tags.state();
    const c = Cloud.state();
    const pill = $("tagsPill");

    let label;
    if (Cloud.signedIn() || cloudTrouble() || c.status === "signing-in") {
      const CLOUD = {
        "signing-in": ["Signing in…", ""],
        syncing:      ["Syncing…", ""],
        synced:       ["Synced ✓", "ok"],
        offline:      ["Offline — will sync", "warn"],
        denied:       ["Sync not allowed", "error"],
        error:        ["Sync problem", "error"]
      };
      label = CLOUD[c.status] || CLOUD.synced;
      pill.title = c.email ? "Tags sync to the cloud as " + c.email : "Cloud sync of your tags";
    } else {
      const FILE = {
        unsupported: ["Tags: this browser only", "warn"],
        local:       ["Tags: not saved to a file", "warn"],
        reconnect:   ["Tags: click to reconnect", "warn"],
        saving:      ["Tags: saving…", ""],
        saved:       ["Tags saved ✓", "ok"],
        error:       ["Tags: save problem", "error"]
      };
      label = FILE[s.status] || FILE.local;
      pill.title = s.fileName ? "Tags file: " + s.fileName : "Where your Cameo and Featured tags are saved";
    }
    pill.textContent = label[0];
    pill.className = "pill " + label[1];

    // Banner: one nudge at a time, most important first.
    const banner = $("tagsBanner");
    let content = null;
    let aboutTags = true;   // tag banners are hidden on the Data page, which shows the same choices

    if (cloudTrouble()) {
      content = [
        el("span", { text: c.error || "Cloud sync stopped." }),
        Cloud.signedIn() ? el("button", { class: "primary", text: "Try again", onclick: function () { Cloud.retry(); } }) : null,
        el("button", { text: "Data page", onclick: function () { show("data"); } })
      ];
    } else if (Cloud.AVAILABLE && c.status === "signed-out" && !Prefs.get("cloudBannerDismissed", false)) {
      content = [
        el("span", { text: "Sign in with Google to keep your Cameo and Featured tags in the cloud and see them on all your devices." }),
        el("button", { class: "primary", text: "Sign in with Google", onclick: signIn }),
        el("button", {
          text: "Not now",
          onclick: function () { Prefs.set("cloudBannerDismissed", true); renderTagsStatus(); }
        })
      ];
    } else if (Cloud.signedIn() || (Cloud.AVAILABLE && c.status === "loading")) {
      content = null;   // tags are safe in the cloud (or sign-in is still being restored)
    } else if (s.status === "local") {
      content = [
        el("span", { text: "Your Cameo and Featured tags are only saved in this browser. Choose a file to keep them permanently — a OneDrive folder is a good spot." }),
        el("button", { class: "primary", text: "Create tags file…", onclick: connectNew }),
        el("button", { text: "Use an existing file…", onclick: connectExisting })
      ];
    } else if (s.status === "reconnect") {
      content = [
        el("span", { text: "The browser needs your OK to keep saving tags to " + s.fileName + " (it asks again after a restart)." }),
        el("button", { class: "primary", text: "Reconnect", onclick: function () { Tags.reconnect(); } })
      ];
    } else if (s.status === "error") {
      content = [
        el("span", { text: "Tags couldn't be saved to the file: " + s.error }),
        el("button", { class: "primary", text: "Try again", onclick: function () { Tags.reconnect(); } }),
        el("button", { text: "Data page", onclick: function () { show("data"); } })
      ];
    } else if (s.status === "unsupported" && Tags.count()) {
      content = [
        el("span", { text: "This browser can't save tags to a file, so they're kept in this browser only. Open the app in Edge or Chrome, or download a backup from the Data page." })
      ];
    }

    // Nothing to say about tags? Offer the card list on an empty device.
    if (!content && !Store.size() && !state.job) {
      aboutTags = false;
      content = [
        el("span", { text: "There are no cards on this device yet. Import the English card list? It takes about a minute." }),
        el("button", { class: "primary needs-idle", text: "Import English cards", onclick: function () {
          importAllSets(["en"], Prefs.get("includePocket", false));
        } })
      ];
    }

    banner.hidden = !content || (aboutTags && state.view === "data");
    if (content) { setChildren(banner, content); }

    updateCount();
    if (refreshDataView) { refreshDataView(); }
  }

  $("tagsPill").addEventListener("click", function () {
    if (!Cloud.signedIn() && Tags.state().status === "reconnect") {
      Tags.reconnect();
    } else {
      show("data");
    }
  });

  function signIn() {
    Cloud.signIn().catch(function (err) { alert(err.message); });
  }

  function pickerError(err) {
    if (err && err.name === "AbortError") { return; } // picker cancelled
    alert(err && err.message ? err.message : String(err));
  }

  function connectNew() { Tags.connectNew().catch(pickerError); }
  function connectExisting() { Tags.connectExisting().catch(pickerError); }


  // ---- Job panel (import / export progress) ------------------------

  function startJob(kind, label) {
    const controller = new AbortController();
    state.job = { kind: kind, label: label, controller: controller };
    $("jobLabel").textContent = label;
    $("jobText").textContent = "Starting…";
    $("jobText").className = "job-text";
    $("jobFill").style.width = "0%";
    $("jobBar").hidden = false;
    $("jobCancel").hidden = false;
    $("jobDismiss").hidden = true;
    $("job").hidden = false;
    updateBusy();
    return controller.signal;
  }

  function progress(text, fraction) {
    $("jobText").textContent = text;
    $("jobFill").style.width = Math.round(Math.min(1, Math.max(0, fraction)) * 100) + "%";
  }

  function endJob(message, isError) {
    state.job = null;
    $("jobText").textContent = message;
    $("jobText").className = "job-text" + (isError ? " error" : " ok");
    $("jobBar").hidden = true;
    $("jobCancel").hidden = true;
    $("jobDismiss").hidden = false;
    updateBusy();
    if (refreshResults) { refreshResults(); }
    renderTagsStatus();
  }

  /** Imports every set for the given languages, oldest first. */
  async function importAllSets(langs, includePocket) {
    if (state.job) { return; }
    const label = langs.length > 1 ? "all languages" : LANG_NAMES[langs[0]];

    askPersistence();
    const signal = startJob("import", "Importing every set — " + label);
    renderTagsStatus();
    try {
      const r = await Importer.allSets(langs, {
        signal: signal, onProgress: progress, includePocket: includePocket
      });
      let msg = plural(r.added, "new entry", "new entries") + " added from " + plural(r.setsImported, "set");
      if (r.setsComplete) { msg += "; " + r.setsComplete + " already up to date"; }
      if (r.pocketSets) { msg += "; " + r.pocketSets + " TCG Pocket set(s) skipped"; }
      msg += r.cancelled ? ". Stopped — run it again to continue where it left off." : ".";
      if (r.failedLangs.length) { msg += " Couldn't load: " + r.failedLangs.join(", ") + "."; }
      if (r.failedSets.length) {
        msg += " " + plural(r.failedSets.length, "set") + " failed (run again to retry): " +
               r.failedSets.slice(0, 5).join(", ") + (r.failedSets.length > 5 ? "…" : "") + ".";
      }
      endJob(msg, false);
    } catch (err) {
      endJob("Import stopped: " + err.message + " Run it again to continue.", true);
    }
  }

  /** Buttons marked .needs-idle are disabled while a job runs. */
  function updateBusy() {
    document.querySelectorAll(".needs-idle").forEach(function (b) {
      b.disabled = !!state.job || b.dataset.ready === "no";
    });
  }

  $("jobCancel").addEventListener("click", function () {
    if (state.job) {
      state.job.controller.abort();
      $("jobText").textContent = "Stopping…";
    }
  });

  $("jobDismiss").addEventListener("click", function () { $("job").hidden = true; });

  window.addEventListener("beforeunload", function (e) {
    const t = Tags.state();
    // Cloud writes need no warning: every edit is already saved in this
    // browser and is re-sent on the next visit if it didn't reach the cloud.
    if (state.job || (t.dirty && (t.status === "saving" || t.status === "saved"))) {
      Tags.flush();
      e.preventDefault();
      e.returnValue = "";
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { Tags.flush(); }
  });


  // ---- Shared filter bar --------------------------------------------

  function filterBar(onChange) {
    const f = state.filter;

    function changed() {
      Prefs.set("filter", f);
      state.limit = PAGE_SIZE;
      onChange();
    }

    const pokemon = el("input", {
      type: "text", value: f.pokemon, placeholder: "e.g. 59 or Misty", autocomplete: "off",
      oninput: debounce(function () { f.pokemon = pokemon.value.trim(); changed(); }, 250)
    });

    const set = el("select", {
      onchange: function () { f.set = set.value; changed(); }
    });

    const lang = el("select", {
      onchange: function () { f.lang = lang.value; fillSets(); changed(); }
    }, options([["", "All languages"]].concat(LANGS), f.lang));

    const text = el("input", {
      type: "search", value: f.text, placeholder: "name, rarity, number…", autocomplete: "off",
      oninput: debounce(function () { f.text = text.value.trim(); changed(); }, 250)
    });

    function fillSets() {
      const names = Collection.setNames(f.lang);
      if (f.set && names.indexOf(f.set) === -1) {
        names.unshift(f.set); // keep the current choice visible
      }
      setChildren(set, options(
        [["", "All sets (release order)"]].concat(names.map(function (n) { return [n, n]; })), f.set));
    }
    fillSets();
    refreshSetOptions = fillSets;

    const clear = el("button", {
      class: "link", type: "button", text: "Clear filters",
      onclick: function () {
        f.pokemon = f.set = f.lang = f.text = "";
        pokemon.value = text.value = "";
        lang.value = "";
        fillSets();
        changed();
      }
    });

    return el("div", { class: "filters" },
      field("Pokémon (dex # or name)", pokemon),
      field("Set", set),
      field("Language", lang),
      field("Search", text),
      el("div", { class: "filters-clear" }, clear)
    );
  }

  function field(label, control, hint) {
    return el("label", { class: "field" },
      el("span", { class: "field-label", text: label }),
      control,
      hint ? el("span", { class: "hint", text: hint }) : null);
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, typeof ms === "function" ? ms() : ms);
    };
  }

  function filterLabel() {
    const f = state.filter;
    const bits = [f.pokemon, f.set, f.lang ? LANG_NAMES[f.lang] : "", f.text]
      .filter(Boolean);
    return bits.length ? bits.join(" · ") : "all cards";
  }

  function emptyMessage() {
    if (!Store.size()) {
      return el("div", { class: "empty" },
        el("p", { text: "Your collection is empty." }),
        el("button", { class: "primary", text: "Import cards", onclick: function () { show("import"); } }));
    }
    return el("div", { class: "empty" },
      el("p", { text: "No cards match " + filterLabel() + "." }),
      el("p", { class: "hint", text: "Import that Pokémon or set first, or tag cards with it in the Cameo column." }));
  }

  function pocketBox() {
    const box = el("input", {
      type: "checkbox", checked: Prefs.get("includePocket", false),
      onchange: function () { Prefs.set("includePocket", box.checked); }
    });
    return box;
  }


  // ---- Import view --------------------------------------------------

  function viewImport() {

    // ---- Every set, release order.
    const aLang = el("select", {},
      options([["all", "All languages"]].concat(LANGS), Prefs.get("aLang", "en")));
    const aPocket = pocketBox();
    const goAll = el("button", { class: "primary needs-idle", text: "Import all sets", onclick: runAll });

    function runAll() {
      Prefs.set("aLang", aLang.value);
      importAllSets(aLang.value === "all" ? LANG_CODES.slice() : [aLang.value], aPocket.checked);
    }

    // ---- One Pokémon.
    const q = el("input", {
      type: "text", placeholder: "59  or  Misty", autocomplete: "off",
      value: Prefs.get("lastQuery", ""),
      onkeydown: function (e) { if (e.key === "Enter") { runDex(); } }
    });
    const qLang = el("select", {},
      options([["all", "All languages"]].concat(LANGS), Prefs.get("qLang", "all")));
    const qPocket = pocketBox();
    const goDex = el("button", { class: "primary needs-idle", text: "Import", onclick: runDex });

    async function runDex() {
      if (state.job) { return; }
      const query = q.value.trim();
      if (!query) { q.focus(); return; }
      Prefs.set("lastQuery", query);
      Prefs.set("qLang", qLang.value);
      const langs = qLang.value === "all" ? LANG_CODES.slice() : [qLang.value];

      askPersistence();
      const signal = startJob("import", "Importing “" + query + "”");
      try {
        const r = await Importer.byPokemon(query, langs, {
          signal: signal, onProgress: progress, includePocket: qPocket.checked
        });
        if (!r.found && !r.cancelled) {
          endJob("No cards found for “" + query + "”" +
                 (/^\d+$/.test(query) ? " — check the Pokédex number." : " — check the spelling, or try its Pokédex number."), true);
          return;
        }
        let msg = "“" + query + "”: " + plural(r.found, "card") + " found; " +
                  r.added + " new added (one per finish)";
        if (r.tagged) { msg += ", " + r.tagged + " existing tagged"; }
        if (r.pocketSkipped) { msg += ", " + r.pocketSkipped + " TCG Pocket card(s) skipped"; }
        msg += r.cancelled ? ". Stopped — run it again to continue." : ".";
        if (r.skippedLangs.length) { msg += " Skipped (unavailable): " + r.skippedLangs.join(", ") + "."; }
        endJob(msg, false);
      } catch (err) {
        endJob("Import stopped: " + err.message, true);
      }
    }

    // ---- One set.
    const sLang = el("select", {
      onchange: function () { Prefs.set("sLang", sLang.value); loadSets(); }
    }, options(LANGS, Prefs.get("sLang", "en")));
    const sSet = el("select", {
      onchange: function () { Prefs.set("sSet." + sLang.value, sSet.value); }
    });
    const goSet = el("button", { class: "primary needs-idle", text: "Import set", onclick: runSet });
    goSet.dataset.ready = "no";
    const setNote = el("span", { class: "hint" });

    async function loadSets() {
      const lang = sLang.value;
      goSet.dataset.ready = "no";
      updateBusy();
      setChildren(sSet, el("option", { text: "Loading sets…" }));
      setNote.textContent = "";

      try {
        if (!state.sets.has(lang)) {
          const list = await Api.sets(lang);
          state.sets.set(lang, list.map(function (s) { return { id: s.id, name: s.name }; }));
        }
      } catch (err) {
        setNote.textContent = "Couldn't load sets: " + err.message;
        setChildren(sSet, el("option", { text: "(unavailable)" }));
        return;
      }
      if (sLang.value !== lang) { return; } // changed while loading

      const sets = state.sets.get(lang);
      if (!sets.length) {
        setChildren(sSet, el("option", { text: "(no sets)" }));
        setNote.textContent = "No sets found for this language.";
        return;
      }
      const saved = Prefs.get("sSet." + lang, sets[sets.length - 1].id);
      setChildren(sSet, options(sets.map(function (s) { return [s.id, s.name]; }), saved));
      setNote.textContent = sets.length + " sets in release order — newest at the bottom.";
      goSet.dataset.ready = "yes";
      updateBusy();
    }

    async function runSet() {
      if (state.job || goSet.dataset.ready !== "yes") { return; }
      const lang = sLang.value;
      const setId = sSet.value;
      const setName = sSet.options[sSet.selectedIndex].textContent;

      askPersistence();
      const signal = startJob("import", "Importing " + setName + " (" + LANG_NAMES[lang] + ")");
      try {
        const r = await Importer.bySet(setId, lang, { signal: signal, onProgress: progress });
        endJob(r.setName + ": " + r.added + " new added (one per finish)" +
               (r.cancelled ? ". Stopped — run it again to continue." : "."), false);
      } catch (err) {
        endJob("Import stopped: " + err.message, true);
      }
    }

    loadSets();

    return el("div", { class: "stack" },
      el("section", { class: "panel" },
        el("h2", { text: "Import every set" }),
        el("p", { class: "lead", text: "The full catalog, set by set from oldest to newest. English takes a few minutes; other languages are fetched card by card and take longer (roughly 10–40 minutes each). Stop any time — running it again skips finished sets and carries on." }),
        el("div", { class: "row" },
          el("div", {}, field("Language", aLang)),
          el("div", { class: "row-end" }, goAll)),
        el("label", { class: "check" }, aPocket,
          el("span", { text: "Include Pokémon TCG Pocket sets (digital only)" }))),
      el("section", { class: "panel" },
        el("h2", { text: "Import a Pokémon" }),
        el("p", { class: "lead", text: "Every card for one Pokémon, in every finish. A Pokédex number works in every language; a name (e.g. Misty, Team Rocket) searches that language only." }),
        el("div", { class: "row" },
          el("div", { class: "grow" }, field("Pokédex number or name", q)),
          el("div", {}, field("Language", qLang)),
          el("div", { class: "row-end" }, goDex)),
        el("label", { class: "check" }, qPocket,
          el("span", { text: "Include Pokémon TCG Pocket cards (digital only)" }))),
      el("section", { class: "panel" },
        el("h2", { text: "Import one set" }),
        el("p", { class: "lead", text: "Every card in one set and language." }),
        el("div", { class: "row" },
          el("div", {}, field("Language", sLang)),
          el("div", { class: "grow" }, field("Set", sSet)),
          el("div", { class: "row-end" }, goSet)),
        setNote),
      el("p", { class: "hint", text: "Imports only add cards you don't have yet. Your Cameo and Featured tags are stored separately and are never changed by importing or deleting cards." })
    );
  }


  // ---- Collection view ----------------------------------------------

  function viewCollection() {
    const summary = el("div", { class: "summary" });
    const results = el("div", { class: "results" });

    refreshResults = function () {
      const list = Collection.filter(state.filter);
      const shown = list.slice(0, state.limit);

      const delBtn = el("button", {
        class: "danger needs-idle", text: "Delete " + list.length.toLocaleString() + " shown…",
        disabled: !list.length,
        onclick: function () {
          if (confirm("Delete " + plural(list.length, "card entry", "card entries") +
                      " matching " + filterLabel() + " from the catalog?\n\nYour Cameo/Featured tags are kept, and you can re-import the cards later.")) {
            Store.remove(list.map(function (c) { return c.id; }));
          }
        }
      });

      setChildren(summary,
        el("span", { text: list.length.toLocaleString() + " of " + plural(Store.size(), "card") +
                     " · release order · Cameo/Featured edits apply to every finish of a card" }),
        list.length ? delBtn : null);

      if (!list.length) {
        setChildren(results, emptyMessage());
        updateBusy();
        return;
      }

      const table = el("table", { class: "cards" },
        el("thead", {}, el("tr", {},
          ["", "Name", "Set", "No.", "Finish", "Lang", "Released", "Rarity", "Dex", "Featured", "Cameo", ""]
            .map(function (h) { return el("th", { text: h }); }))),
        el("tbody", {}, shown.map(cardRow)));

      const more = list.length > shown.length
        ? el("button", {
            class: "more", text: "Show more (" + (list.length - shown.length).toLocaleString() + " left)",
            onclick: function () { state.limit += PAGE_SIZE; refreshResults(); }
          })
        : null;

      setChildren(results, el("div", { class: "table-wrap" }, table), more);
      updateBusy();
    };

    return el("div", { class: "stack" },
      filterBar(function () { refreshResults(); }),
      summary,
      results);
  }

  function thumbUrl(url) {
    return url ? url.replace(/\/high\.png$/, "/low.png") : "";
  }

  function tagLabel(c) {
    return c.name + " — " + c.set + " " + Collection.displayNumber(c);
  }

  function tagInput(c, fieldName) {
    const value = fieldName === "cameo" ? Collection.cameo(c) : Collection.featured(c);
    return el("input", {
      class: "cell-edit", type: "text", value: value,
      placeholder: fieldName === "cameo" ? "e.g. 25, 133" : "",
      "data-card": c.cardId, "data-field": fieldName,
      "aria-label": fieldName + " for " + c.name + " " + c.set,
      onchange: function (e) {
        state.quiet = true;
        try {
          Tags.set(c.cardId, fieldName, e.target.value.trim(), tagLabel(c));
        } finally {
          state.quiet = false;
        }
        syncTagInputs(e.target);
      }
    });
  }

  /** Other rows of the same card (its other finishes) show the new tag too. */
  function syncTagInputs(source) {
    const selector = 'input.cell-edit[data-card="' + CSS.escape(source.dataset.card) +
                     '"][data-field="' + source.dataset.field + '"]';
    document.querySelectorAll(selector).forEach(function (inp) {
      if (inp !== source) { inp.value = source.value.trim(); }
    });
  }

  function cardRow(c) {
    return el("tr", {},
      el("td", { class: "thumb" }, c.imageUrl
        ? el("img", { src: thumbUrl(c.imageUrl), alt: "", loading: "lazy", width: 40, height: 55 })
        : el("span", { class: "noimg-sm", text: "—" })),
      el("td", { class: "name", text: c.name }),
      el("td", { class: "set" },
        c.setIcon ? el("img", { src: c.setIcon, alt: "", loading: "lazy", class: "set-icon", onerror: hideBroken }) : null,
        el("span", { text: c.set })),
      el("td", { class: "num", text: Collection.displayNumber(c) }),
      el("td", { text: c.variant }),
      el("td", { text: c.language }),
      el("td", { class: "num", text: c.releaseDate || c.year }),
      el("td", { text: c.rarity }),
      el("td", { class: "num", text: c.dex }),
      el("td", {}, tagInput(c, "featured")),
      el("td", {}, tagInput(c, "cameo")),
      el("td", {}, el("button", {
        class: "icon-btn", title: "Remove from catalog (tags are kept)",
        "aria-label": "Remove " + c.name + " " + c.variant,
        text: "×",
        onclick: function () { Store.remove([c.id]); }
      })));
  }

  /** Asks the browser to keep our storage (it may decide silently). */
  function askPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () {});
    }
  }


  // ---- Data view ------------------------------------------------------

  function viewData() {
    const tagsBox = el("section", { class: "panel" });
    const catalogBox = el("section", { class: "panel subtle" });

    const restoreInput = el("input", {
      type: "file", accept: ".json,application/json", hidden: true,
      onchange: function () {
        const file = restoreInput.files[0];
        restoreInput.value = "";
        if (!file) { return; }
        file.text()
          .then(function (text) { return Tags.importJson(text); })
          .then(function (n) { alert("Read " + plural(n, "tag") + " from " + file.name + ". Newer edits were kept."); })
          .catch(function (err) { alert(err.message); });
      }
    });

    refreshDataView = function () {
      const s = Tags.state();
      const STATUS = {
        unsupported: "This browser can't save to a file — tags are kept in this browser only. Use Edge or Chrome on a computer to save them to a file.",
        local:       "Tags are saved in this browser only. Choose a file to keep them permanently.",
        reconnect:   "Linked to " + s.fileName + ", but the browser needs your OK again (it asks after a restart).",
        saving:      "Saving to " + s.fileName + "…",
        saved:       "Saving automatically to " + s.fileName + ".",
        error:       "Problem saving to " + (s.fileName || "the file") + ": " + s.error
      };

      const buttons = [];
      if (Tags.SUPPORTED) {
        if (s.status === "reconnect" || s.status === "error") {
          buttons.push(el("button", { class: "primary", text: "Reconnect", onclick: function () { Tags.reconnect(); } }));
        }
        if (!s.fileName) {
          buttons.push(el("button", { class: "primary", text: "Create tags file…", onclick: connectNew }));
          buttons.push(el("button", { text: "Use an existing tags file…", onclick: connectExisting }));
        } else {
          buttons.push(el("button", { text: "Switch to another file…", onclick: connectExisting }));
          buttons.push(el("button", {
            class: "danger", text: "Stop using this file",
            onclick: function () {
              if (confirm("Stop saving tags to " + s.fileName + "? The file stays where it is, and your tags stay in this browser.")) {
                Tags.disconnect();
              }
            }
          }));
        }
      }

      // Cloud sync (live site only).
      const c = Cloud.state();
      const cloudButtons = [];
      let cloudText = "";
      let cloudClass = "status-local";
      if (!Cloud.AVAILABLE) {
        cloudText = "Cloud sync works on the live site, not from a file on this computer. This copy keeps tags in the tags file below.";
        cloudButtons.push(el("a", { class: "button-link", href: LIVE_SITE, target: "_blank", rel: "noopener", text: "Open the live site" }));
      } else if (c.status === "loading") {
        cloudText = "Starting…";
      } else if (c.status === "signed-out" || c.status === "signing-in") {
        cloudText = "Sign in with Google and your tags sync to every device where you sign in — computers, phones and tablets.";
        cloudButtons.push(el("button", { class: "primary", text: "Sign in with Google", disabled: c.status === "signing-in", onclick: signIn }));
      } else if (c.status === "denied" || c.status === "error") {
        cloudText = c.error;
        cloudClass = "status-error";
        if (Cloud.signedIn()) {
          cloudButtons.push(el("button", { class: "primary", text: "Try again", onclick: function () { Cloud.retry(); } }));
          cloudButtons.push(el("button", { text: "Sign out", onclick: function () { Cloud.signOut(); } }));
        }
      } else {
        const SYNC = {
          syncing: "Syncing…",
          synced:  "Everything is up to date.",
          offline: "Offline — edits are saved on this device and will sync when you're back online."
        };
        cloudText = "Signed in as " + c.email + ". " + (SYNC[c.status] || "");
        cloudClass = c.status === "synced" ? "status-saved" : "status-local";
        cloudButtons.push(el("button", {
          text: "Sign out",
          onclick: function () {
            if (confirm("Sign out of cloud sync on this device? Your tags stay here, and in the cloud.")) {
              Cloud.signOut();
            }
          }
        }));
      }

      setChildren(tagsBox,
        el("h2", { text: "Cameo & Featured tags" }),
        el("p", { class: "lead", text: plural(Tags.count(), "card") + " tagged. Tags are your own data: they're kept separately from the card catalog, so importing or deleting cards never touches them." }),
        el("h3", { text: "Cloud sync" }),
        el("p", { class: "status-line " + cloudClass, text: cloudText }),
        cloudButtons.length ? el("div", { class: "row wrap" }, cloudButtons) : null,
        el("h3", { text: "Tags file" }),
        el("p", { class: "status-line status-" + s.status, text: STATUS[s.status] || "" }),
        buttons.length ? el("div", { class: "row wrap" }, buttons) : null,
        el("p", { class: "hint", text: "Tip: put the file in your OneDrive (or other synced) folder so it's backed up. With cloud sync on, the file is an extra copy — cloud edits are written into it too." }),
        el("h3", { text: "Backups" }),
        el("div", { class: "row wrap" },
          el("button", {
            text: "Download tags backup",
            onclick: function () {
              const stamp = new Date().toISOString().slice(0, 10);
              downloadBlob(new Blob([Tags.exportJson()], { type: "application/json" }),
                           "master-set-tags-backup-" + stamp + ".json");
            }
          }),
          el("button", { text: "Restore tags from a backup…", onclick: function () { restoreInput.click(); } }),
          restoreInput),
        el("p", { class: "hint", text: "Restoring merges: for each card, whichever edit is newer wins." }));

      const usage = el("span", { class: "hint" });
      if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(function (e) {
          usage.textContent = "Browser storage used: about " + Math.max(1, Math.round((e.usage || 0) / 1048576)) + " MB.";
        }).catch(function () {});
      }
      const persist = el("span", { class: "hint" });
      if (navigator.storage && navigator.storage.persisted) {
        navigator.storage.persisted().then(function (p) {
          persist.textContent = p
            ? " Storage is marked persistent."
            : " The browser may clear the catalog if disk space runs low — it can always be re-imported.";
        }).catch(function () {});
      }

      setChildren(catalogBox,
        el("h2", { text: "Card catalog" }),
        el("p", { class: "lead", text: plural(Store.size(), "card entry", "card entries") +
          " (one per card × finish × language), downloaded from TCGdex and stored in this browser. It can be re-imported any time." }),
        el("p", {}, usage, persist),
        el("div", { class: "row wrap" },
          el("button", {
            class: "danger needs-idle", text: "Delete all cards…",
            onclick: function () {
              if (confirm("Delete all " + Store.size() + " card entries from this browser?\n\nYour Cameo/Featured tags are kept. You can re-import the cards any time.")) {
                Store.clear();
              }
            }
          })));
      updateBusy();
    };

    refreshDataView();
    return el("div", { class: "stack" }, tagsBox, catalogBox);
  }


  // ---- Print view ---------------------------------------------------

  function viewPrint() {
    const summary = el("div", { class: "summary" });
    const results = el("div", {});

    refreshResults = function () {
      const list = Collection.filter(state.filter);
      const pages = Math.ceil(list.length / PRINT_PER_PAGE);
      const tooMany = list.length > MAX_PRINT_CARDS;

      setChildren(summary,
        el("span", { text: plural(list.length, "card") + " · " + plural(pages, "page") + " (Letter, 3×3)" }),
        list.length && !tooMany
          ? el("button", { class: "primary", text: "Print / Save PDF", onclick: function () { window.print(); } })
          : null);

      if (!list.length) {
        setChildren(results, emptyMessage());
        return;
      }
      if (tooMany) {
        setChildren(results, el("p", { class: "warn",
          text: "That's " + plural(pages, "page") + ". Filter to " + MAX_PRINT_CARDS + " cards or fewer (one Pokémon, set or language) to print." }));
        return;
      }

      const pageEls = [];
      for (let i = 0; i < list.length; i += PRINT_PER_PAGE) {
        pageEls.push(el("div", { class: "print-page" },
          list.slice(i, i + PRINT_PER_PAGE).map(printCard)));
      }

      setChildren(results, el("div", { class: "print-pages" }, pageEls));
    };

    return el("div", { class: "stack" },
      filterBar(function () { refreshResults(); }),
      el("p", { class: "hint no-print", text: "In the print dialog, set Scale to 100% (Default) so cards print at real size (2.5 × 3.5 in)." }),
      summary,
      results);
  }

  function printCard(c) {
    return el("div", { class: "pcard" },
      el("div", { class: "pcard-art" }, c.imageUrl
        ? el("img", { src: c.imageUrl, alt: c.name })
        : el("div", { class: "noimg" }, el("strong", { text: "No Image" }), el("span", { text: "Available" }))),
      el("div", { class: "pcard-set", text: c.set }),
      el("div", { class: "pcard-variant", text: c.variant }),
      el("div", { class: "pcard-lang", text: Collection.langYear(c) }),
      el("div", { class: "pcard-num" },
        c.setIcon ? el("img", { src: c.setIcon, alt: "", onerror: hideBroken }) : null,
        el("span", { text: Collection.displayNumber(c) })));
  }

  /** Some sets have no symbol on TCGdex — drop the icon instead of a broken image. */
  function hideBroken(e) {
    e.target.remove();
  }


  // ---- Cricut view --------------------------------------------------

  function viewCricut() {
    const paper = el("select", {
      onchange: function () { Prefs.set("paper", paper.value); refreshResults(); }
    }, options(Object.keys(Cricut.PAPER).map(function (k) { return [k, Cricut.PAPER[k].label]; }),
               Prefs.get("paper", "legal")));

    const rotate = el("input", {
      type: "checkbox", checked: Prefs.get("rotate", true),
      onchange: function () { Prefs.set("rotate", rotate.checked); refreshResults(); }
    });

    const summary = el("div", { class: "summary" });
    const preview = el("canvas", { id: "cricutPreview", class: "preview", width: 260, height: 10 });
    const downloads = el("div", { class: "downloads" });

    function currentPlan() { return Cricut.plan(paper.value, rotate.checked); }

    refreshResults = function () {
      const list = Collection.filter(state.filter);
      const p = currentPlan();
      const sheets = Math.ceil(list.length / p.perSheet);
      const tooMany = sheets > MAX_CRICUT_SHEETS;

      const buildBtn = el("button", {
        class: "primary needs-idle", text: "Build sheets",
        onclick: function () { if (list.length && !tooMany) { build(list, p); } }
      });
      buildBtn.dataset.ready = list.length && !tooMany ? "yes" : "no"; // updateBusy() honours this

      setChildren(summary,
        el("span", { text: plural(list.length, "card") + " → " + plural(sheets, "sheet") +
          " · " + p.perSheet + " per sheet (" + p.cols + "×" + p.rows + (p.rotate ? ", sideways" : "") + ")" }),
        buildBtn);

      if (!list.length) {
        setChildren(downloads, emptyMessage());
      } else if (tooMany && !state.cricut.files.length) {
        setChildren(downloads, el("p", { class: "warn",
          text: "That's " + plural(sheets, "sheet") + ". Filter to " + MAX_CRICUT_SHEETS + " sheets or fewer (one Pokémon, set or language) per export." }));
      } else {
        drawDownloads();
      }
      updateBusy();
    };

    function drawDownloads() {
      const files = state.cricut.files;
      if (!files.length) {
        setChildren(downloads);
        return;
      }
      const pairs = [];
      for (let i = 0; i < files.length; i += 2) {
        pairs.push(el("li", {},
          el("span", { text: "Sheet " + (i / 2 + 1) }),
          fileLink(files[i], "PNG"),
          files[i + 1] ? fileLink(files[i + 1], "Cut SVG") : null));
      }
      setChildren(downloads,
        el("div", { class: "row wrap" },
          el("button", {
            class: "primary", text: "Download all (ZIP)",
            onclick: function () {
              downloadBlob(makeZip(state.cricut.files), fileSafe(state.cricut.label, "AllCards") + "_cricut.zip");
            }
          }),
          el("span", { class: "hint", text: plural(state.cricut.sheets, "sheet") + " for " + state.cricut.label })),
        el("ul", { class: "file-list" }, pairs));
    }

    function fileLink(f, label) {
      return el("button", {
        class: "link", text: label,
        onclick: function () {
          const type = /\.svg$/.test(f.name) ? "image/svg+xml" : "image/png";
          downloadBlob(new Blob([f.data], { type: type }), f.name);
        }
      });
    }

    async function build(list, p) {
      if (state.job) { return; }
      const f = state.filter;
      const label = [f.pokemon, f.set, f.text].filter(Boolean).join(" ") || "AllCards";
      const base = fileSafe(label + (f.lang ? " " + f.lang : ""), "AllCards");
      const sheets = Math.ceil(list.length / p.perSheet);

      state.cricut = { files: [], label: label + (f.lang ? " (" + LANG_NAMES[f.lang] + ")" : ""), sheets: 0 };
      drawDownloads();

      const signal = startJob("cricut", "Building Cricut sheets for " + filterLabel());
      const iconCache = new Map();
      try {
        for (let s = 0; s < sheets; s++) {
          if (signal.aborted) { break; }
          progress("Rendering sheet " + (s + 1) + " of " + sheets + "…", s / sheets);
          const cards = list.slice(s * p.perSheet, (s + 1) * p.perSheet);
          const png = await Cricut.renderSheet(p, cards, iconCache, $("cricutPreview"));
          state.cricut.files.push(
            { name: base + "_sheet" + (s + 1) + ".png", data: png },
            { name: base + "_sheet" + (s + 1) + "_CUT.svg", data: new TextEncoder().encode(Cricut.cutSvg(p, cards.length)) });
          state.cricut.sheets = s + 1;
        }
        endJob(signal.aborted
          ? "Stopped after " + plural(state.cricut.sheets, "sheet") + ". Those are ready to download below."
          : "Done: " + plural(sheets, "sheet") + " ready — download them below.", false);
      } catch (err) {
        endJob("Export stopped: " + err.message, true);
      }
      if (state.view === "cricut") { drawDownloads(); }
    }

    return el("div", { class: "stack" },
      filterBar(function () { refreshResults(); }),
      el("section", { class: "panel" },
        el("div", { class: "row wrap" },
          field("Paper (printable area)", paper),
          el("label", { class: "check" }, rotate, el("span", { text: "Lay cards sideways (fits more)" }))),
        summary),
      el("div", { class: "cricut-out" },
        el("div", { class: "preview-wrap" }, preview),
        el("div", { class: "grow" },
          downloads,
          el("details", { class: "howto" },
            el("summary", { text: "Using the files in Cricut Design Space" }),
            el("ol", {},
              el("li", { text: "Upload the sheet PNG and its _CUT.svg." }),
              el("li", { text: "Check both are the same size (the SVG is exact; resize the PNG to match if needed)." }),
              el("li", { text: "Select both → Align → Center, then Attach (or Flatten the PNG with the SVG as cut)." }),
              el("li", { text: "Make It → Print Then Cut, using the same paper size you chose here." })))))
    );
  }


  // ---- Startup ------------------------------------------------------

  // While a long import runs, redraw less often (the catalog changes constantly).
  const scheduleRefresh = debounce(function () {
    if (refreshSetOptions) { refreshSetOptions(); }
    if (refreshResults) { refreshResults(); }
    renderTagsStatus();   // also refreshes the Data page
  }, function () { return state.job ? 2500 : 400; });

  Store.onChange(function () {
    updateCount();
    if (!state.quiet) { scheduleRefresh(); }
  });

  Tags.onChange(function (kind) {
    if (kind === "status") {
      renderTagsStatus();
    } else {
      updateCount();
      if (!state.quiet) { scheduleRefresh(); }
    }
  });

  Cloud.onChange(renderTagsStatus);

  /** First-version rows kept cameo on the card row — move them into Tags. */
  function migrateOldCameos(rawRows) {
    rawRows.forEach(function (r) {
      if (r && r.cameo && r.cardId && !Tags.get(r.cardId)) {
        Tags.set(r.cardId, "cameo", r.cameo, r.name + " — " + r.set + " " + (r.number || ""));
      }
    });
  }

  renderNav();
  Store.load()
    .then(function (rawRows) {
      return Tags.load()
        .catch(function (err) { console.warn("Tags load failed:", err); })
        .then(function () { migrateOldCameos(rawRows); });
    })
    .then(function () {
      renderTagsStatus();
      if (!Store.size() && ["collection", "print", "cricut"].indexOf(state.view) !== -1) {
        state.view = "import";
        renderNav();
      }
      renderView();
      // Cloud sync starts after tags are loaded, so the first merge sees them.
      return Cloud.init();
    })
    .catch(function (err) {
      setChildren($("view"), el("div", { class: "panel" },
        el("h2", { text: "Couldn't open the app's storage" }),
        el("p", { text: "This browser blocked local storage (" + (err && err.message || "unknown error") +
          "). Private/incognito windows and some privacy settings do this. Try a normal window." })));
    });

})();
