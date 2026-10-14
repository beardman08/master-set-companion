# Pokémon Master Set Companion

A standalone web app version of the Google Apps Script "Master Set" tools.
No server and no install. It runs from GitHub Pages, or straight from the folder.

Live site: **https://beardman08.github.io/master-set-companion/**

## What it does

| Section | What it does |
|---|---|
| **Import** | **Every set** for a language (or all languages), oldest first. Also **one Pokémon** (dex number or name) or **one set**. Stopping keeps progress, and re-running carries on where it left off. TCG Pocket (digital-only) cards are skipped unless you tick the box. |
| **Collection** | Every card in **set release order**. Filter it, edit **Featured** and **Cameo** tags, and remove cards. |
| **Print** | Letter, 3×3 cards at real size. Print or Save as PDF at Scale 100%. Up to 900 cards per print. |
| **Cricut export** | Print-Then-Cut sheets (300 DPI PNG plus a matching cut-line SVG) for Letter, Legal or Tabloid. Download each file or everything as one ZIP. Up to 100 sheets per export. |
| **Data** | Cloud sync, the tags file, backups, and the card catalog. |

The filter bar (Pokémon, Set, Language, Search) is shared between Collection, Print and Cricut export.
Whatever you filter to is what gets printed or exported.
The Pokémon filter matches a card's dex number, Featured tag or Cameo tag.

## Two kinds of data

**Your tags (Cameo and Featured).** These are your own work, so they're kept permanently:
- A tag belongs to the **card**, not one finish. Tagging Base Set Arcanine covers Normal, 1st Edition and Shadowless.
  It also covers any other language TCGdex lists under the same card id. Japanese cards use their own ids.
- Importing, deleting or re-downloading cards **never** touches your tags.
- Tags are always saved in the browser, plus either or both of:
  - **Cloud sync** (live site only): **Sign in with Google**, and tags sync to every device where you sign in, phones included.
    Edits made offline sync when you're back online.
  - **Tags file**: `master-set-tags.json` in a folder you choose, such as OneDrive. Set it up with **Data → Create tags file…**.
    It works in Edge or Chrome on a computer, including the double-clicked copy, and is a good extra backup.
- Wherever tags meet (cloud, file, another device), the **newest edit for each card wins**.
- **Data → Download tags backup** saves a copy any time.

**The card catalog.** This is downloaded from TCGdex into the browser (IndexedDB) and can be re-imported any time.
Each device and browser keeps its own, and a new device offers a one-click English import.
The full English catalog is about 30,000 entries (one per card × finish) and imports in about a minute.
Other languages are fetched card by card, at roughly 3,000–4,000 entries a minute.

## Running it

- **Live site:** https://beardman08.github.io/master-set-companion/. Cloud sync works here.
- **From the folder:** double-click `index.html` in Edge or Chrome.
  Google sign-in doesn't work from a local file, so this copy uses the tags file.

To update the live site, commit and push to `main`. GitHub Pages republishes in a minute or two.

## Cloud sync setup (Firebase)

Cloud sync uses a free Firebase project (`master-set-companion`, Spark plan) with Google sign-in and Cloud Firestore.
Each tag is one document at `users/{uid}/tags/{cardId}`.

- `js/firebase-config.js` holds the project's web settings. These are **public by design**: they identify the project but grant no access.
- Access is controlled by the **Firestore security rules**, set in the Firebase console (Firestore → Rules).
  They allow only the owner's Google account, only under its own `users/{uid}`, and only well-formed tag documents.
  Everything else is denied. The rules include the owner's email, so they live only in the console, not in this repo.
- `beardman08.github.io` must stay in **Authentication → Settings → Authorized domains**.

## Security

- **No passwords or secret keys in the code.** TCGdex is keyless, and the Firebase settings are public identifiers.
- A **Content Security Policy** in `index.html` limits the page to its own scripts plus Google's sign-in helper.
  It can contact only TCGdex (`api.tcgdex.net`, `assets.tcgdex.net`), Google sign-in
  (`identitytoolkit`/`securetoken.googleapis.com`, the project's `firebaseapp.com` sign-in frame) and Firestore.
  Nothing else can load, and data can't be sent elsewhere.
- The Firebase library is a pinned copy (12.19.0) inside this repo, not loaded from a CDN. It only loads on the live site.
- The app can only touch the one tags file you pick, and only after you grant permission in the browser's own prompt.
- All card text is inserted as plain text, never as HTML. Tags from files, backups and the cloud are checked, and only known fields are read, as text.

## Files

```
index.html                 page shell + security policy
css/styles.css             layout, print styles, light/dark themes
js/util.js                 DOM helpers, preferences, downloads, ZIP writer, PNG DPI tag
js/store.js                local database, card catalog, filtering, release-order sorting
js/tags.js                 Cameo/Featured tags and the tags file (save, merge, reconnect)
js/cloud.js                Google sign-in and Firestore sync of tags
js/firebase-config.js      Firebase project settings (public)
js/vendor/firebase-12.19.0 Firebase SDK (compat builds) + license
js/api.js                  TCGdex requests with retry; English bulk set requests; finishes per card
js/importer.js             import every set, one Pokémon, or one set
js/cricut.js               Cricut sheet rendering and cut-line SVG
js/app.js                  the interface
```

## Settings you might change

- `js/api.js` → `SHADOWLESS_SETS`: sets that also had a Shadowless printing (default: Base Set).
- `js/cricut.js` → card size, gap, corner radius, DPI and paper sizes.
- `js/importer.js` → `CONCURRENCY` (parallel requests to TCGdex; 4 is polite).

Card data and images come from [TCGdex](https://tcgdex.dev).
Pokémon and its trademarks are © Nintendo, Creatures, GAME FREAK and The Pokémon Company.
This is an unofficial fan tool. Firebase SDK © Google, Apache-2.0 (see `js/vendor/firebase-12.19.0/LICENSE.txt`).
