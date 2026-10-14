/**
 * ==========================================================
 * Pokémon Master Set Companion
 * cloud.js
 *
 * Optional cloud sync of Cameo / Featured tags through Firebase:
 * sign in with Google, and tags sync to every device where you're
 * signed in. Each tag is one Firestore document:
 *
 *   users/{your uid}/tags/{card id}  →  { cardId, cameo, featured, label, updated }
 *
 * Merging uses the same rule as the tags file: per card, the newest
 * edit wins. The card catalog is NOT synced — it's public data that
 * each device downloads from TCGdex.
 *
 * Only works on http(s) pages (the live site), not from a local file,
 * because Google sign-in needs a real web address. The Firebase
 * library is loaded only when cloud sync can actually be used.
 * ==========================================================
 */
"use strict";

const Cloud = (function () {

  const SDK_DIR   = "js/vendor/firebase-12.19.0/";
  const SDK_FILES = ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"];
  const BATCH_MAX = 400;   // Firestore allows 500 writes per batch

  const AVAILABLE = !!window.FIREBASE_CONFIG && /^https?:$/.test(location.protocol);

  // status: unavailable | loading | signed-out | signing-in | syncing | synced | offline | denied | error
  const state = { status: AVAILABLE ? "loading" : "unavailable", email: "", name: "", error: "" };
  const listeners = [];

  let auth = null;
  let db = null;
  let user = null;
  let unsubscribe = null;
  let gotServerSnapshot = false;
  let pending = 0;          // writes sent but not yet confirmed by the server
  let lastFromCache = false;


  function emit() {
    listeners.forEach(function (fn) { fn(); });
  }

  function setStatus(s, error) {
    state.status = s;
    state.error = error || "";
    emit();
  }

  /** synced / syncing / offline, from what's in flight. */
  function refreshSyncStatus() {
    if (!user || state.status === "denied" || state.status === "error") { return; }
    if (lastFromCache) {
      setStatus("offline");          // Firestore can't reach the server right now
    } else {
      setStatus(!gotServerSnapshot || pending > 0 ? "syncing" : "synced");
    }
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Couldn't load " + src)); };
      document.head.appendChild(s);
    });
  }

  function friendly(err) {
    const code = err && err.code ? String(err.code) : "";
    if (code === "permission-denied") {
      return "This Google account isn't allowed to sync tags. Only the owner's account can (or the database rules haven't been published yet).";
    }
    if (code === "auth/popup-blocked") {
      return "The browser blocked the Google sign-in window. Allow pop-ups for this site and try again.";
    }
    if (code === "auth/unauthorized-domain") {
      return "This web address isn't on the Firebase project's list of authorized domains.";
    }
    if (code === "auth/network-request-failed" || code === "unavailable") {
      return "Couldn't reach Google. Check your internet connection.";
    }
    return err && err.message ? err.message : String(err);
  }


  // ---- Firestore <-> tags -------------------------------------------

  function tagsCollection() {
    return db.collection("users").doc(user.uid).collection("tags");
  }

  // Card ids are safe already, but encode in case one ever contains "/".
  function docId(cardId) {
    return encodeURIComponent(cardId);
  }

  function toDoc(t) {
    return {
      cardId:   String(t.cardId),
      cameo:    t.cameo || "",
      featured: t.featured == null ? null : String(t.featured),
      label:    t.label || "",
      updated:  Number(t.updated) || 0
    };
  }

  /** Sends tags to the cloud in batches. */
  function push(list) {
    if (!user || !list.length) { return Promise.resolve(); }
    const uid = user.uid;
    const commits = [];
    for (let i = 0; i < list.length; i += BATCH_MAX) {
      const batch = db.batch();
      list.slice(i, i + BATCH_MAX).forEach(function (t) {
        batch.set(tagsCollection().doc(docId(t.cardId)), toDoc(t));
      });
      pending++;
      refreshSyncStatus();
      commits.push(batch.commit()
        .catch(function (err) {
          if (user && user.uid === uid) {
            setStatus(err.code === "permission-denied" ? "denied" : "error", friendly(err));
          }
        })
        .finally(function () {
          pending--;
          refreshSyncStatus();
        }));
    }
    return Promise.all(commits);
  }

  async function onSnapshot(snap) {
    lastFromCache = snap.metadata.fromCache;

    if (!gotServerSnapshot) {
      // Wait for the server's complete view before the first full merge.
      if (snap.metadata.fromCache) { refreshSyncStatus(); return; }
      gotServerSnapshot = true;
      const all = snap.docs.map(function (d) { return d.data(); });
      const r = await Tags.mergeIncoming(all, "cloud", true);
      refreshSyncStatus();
      await push(r.newer);   // tags made here (or in the file) that the cloud lacks
      return;
    }

    // Later snapshots: only other devices' edits (skip our own pending writes).
    const incoming = snap.docChanges()
      .filter(function (c) { return c.type !== "removed" && !c.doc.metadata.hasPendingWrites; })
      .map(function (c) { return c.doc.data(); });
    if (incoming.length) {
      const r = await Tags.mergeIncoming(incoming, "cloud", false);
      push(r.newer);
    }
    refreshSyncStatus();
  }

  function onSnapshotError(err) {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    setStatus(err.code === "permission-denied" ? "denied" : "error", friendly(err));
  }

  function listen() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    gotServerSnapshot = false;
    lastFromCache = false;
    setStatus("syncing");
    unsubscribe = tagsCollection().onSnapshot({ includeMetadataChanges: true }, onSnapshot, onSnapshotError);
  }

  function onUser(u) {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    user = u;
    if (!u) {
      state.email = "";
      state.name = "";
      setStatus("signed-out");
      return;
    }
    state.email = u.email || "";
    state.name = u.displayName || "";
    listen();
  }


  // ---- Public ---------------------------------------------------------

  return {

    AVAILABLE: AVAILABLE,

    /** Loads Firebase (live site only) and restores a previous sign-in. */
    init: async function () {
      if (!AVAILABLE) { return; }
      try {
        for (let i = 0; i < SDK_FILES.length; i++) {
          await loadScript(SDK_DIR + SDK_FILES[i]);
        }
        firebase.initializeApp(window.FIREBASE_CONFIG);
        auth = firebase.auth();
        db = firebase.firestore();
      } catch (err) {
        setStatus("error", "Couldn't start cloud sync: " + friendly(err));
        return;
      }

      // Every local change (edits, tags file, backups) goes to the cloud.
      Tags.onChange(function (kind, records, source) {
        if (kind === "data" && source !== "cloud" && user && gotServerSnapshot) {
          push(records);
        }
      });

      auth.onAuthStateChanged(onUser, function (err) { setStatus("error", friendly(err)); });
    },

    onChange: function (fn) { listeners.push(fn); },

    state: function () { return Object.assign({ pending: pending }, state); },

    signedIn: function () { return !!user; },

    /** Opens Google's sign-in window (must be called from a click). */
    signIn: function () {
      if (!auth) { return Promise.resolve(); }
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      setStatus("signing-in");
      return auth.signInWithPopup(provider).catch(function (err) {
        const code = err && err.code;
        if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
          setStatus("signed-out");
        } else {
          setStatus(user ? state.status : "signed-out");
          throw new Error(friendly(err));
        }
      });
    },

    signOut: function () {
      return auth ? auth.signOut() : Promise.resolve();
    },

    /** Try again after an error (e.g. once the database rules are published). */
    retry: function () {
      if (user) { listen(); }
    }

  };

})();
