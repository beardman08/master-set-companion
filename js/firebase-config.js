/**
 * ==========================================================
 * Pokémon Master Set Companion
 * firebase-config.js
 *
 * Identifies the Firebase project used for cloud sync of tags.
 * These values are public by design (every web app ships them);
 * what protects the data is the Firestore security rules, which
 * only let the owner's Google account read or write its tags.
 * ==========================================================
 */
"use strict";

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAYsRWwnAk63zLUmh6v6B9jGU6LUbXCVi8",
  authDomain: "master-set-companion.firebaseapp.com",
  projectId: "master-set-companion",
  storageBucket: "master-set-companion.firebasestorage.app",
  messagingSenderId: "581739024853",
  appId: "1:581739024853:web:4dbc986ba72d3705362d5c"
};
