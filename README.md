# Pokémon Master Set Companion

A standalone web app version of the Google Apps Script "Master Set" tools.
No Google account, no server, no install, and no outside libraries.

## What it does

| Section | What it does |
|---|---|
| **Import** | **Every set** for a language (or all languages), oldest first. Also **one Pokémon** (dex number or name) or **one set**. Stopping keeps progress, and re-running carries on where it left off. TCG Pocket (digital-only) cards are skipped unless you tick the box. |
| **Collection** | Every card in **set release order**. Filter it, edit **Featured** and **Cameo** tags, and remove cards. |
| **Print** | Letter, 3×3 cards at real size. Print or Save as PDF at Scale 100%. Up to 900 cards per print. |
| **Cricut export** | Print-Then-Cut sheets (300 DPI PNG plus a matching cut-line SVG) for Letter, Legal or Tabloid. Download each file or everything as one ZIP. Up to 100 sheets per export. |
| **Data** | Where your tags are saved, backups, and the card catalog. |

The filter bar (Pokémon, Set, Language, Search) is shared between Collection, Print and Cricut export.
Whatever you filter to is what gets printed or exported.
The Pokémon filter matches a card's dex number, Featured tag or Cameo tag.

## Two kinds of data

**Your tags (Cameo and Featured).** These are your own work, so they're kept permanently:
- They're saved to **`master-set-tags.json`** in a folder you choose. Put it in OneDrive so it's backed up.
  Set it up from the banner or **Data → Create tags file…**. After that, every edit saves automatically.
- A tag belongs to the **card**, not one finish. Tagging Base Set Arcanine covers Normal, 1st Edition and Shadowless.
  It also covers any other language TCGdex lists under the same card id. Japanese cards use their own ids.
- Two computers can share the same file, for example through OneDrive. Every save re-reads the file and keeps the newest edit for each card.
- After the browser restarts, it may ask once for permission to keep using the file. Click **Reconnect** in the banner, or **Allow on every visit** if offered.
- Importing, deleting or re-downloading cards **never** touches your tags.
- Saving to a file needs **Edge or Chrome** on a computer. In other browsers, tags stay in the browser. Use **Data → Download tags backup** there.

**The card catalog.** This is downloaded from TCGdex into the browser (IndexedDB) and can be re-imported any time.
The full English catalog is about 30,000 entries (one per card × finish) and imports in about a minute.
Other languages are fetched card by card, at roughly 3,000–4,000 entries a minute.

## Running it

**Option 1: just open it.** Double-click `index.html` in Edge or Chrome.

**Option 2: host it for free** (use it from any computer):
1. Create a GitHub repository and upload this folder's contents.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Open the `https://<you>.github.io/<repo>/` link it gives you.

Each browser and address keeps its own catalog. The tags file is how your tags follow you:
on a new computer, choose **Use an existing tags file…** and pick the same file.

## Security

- **No accounts, passwords or API keys.** TCGdex is free and keyless, so there are no secrets in the code.
- A **Content Security Policy** in `index.html` lets the page run only its own scripts and contact only
  `api.tcgdex.net` (card data) and `assets.tcgdex.net` (images). Nothing else can load, and data can't be sent elsewhere.
- The app can only touch the one tags file you pick, and only after you grant permission in the browser's own prompt.
- All card text is inserted as plain text, never as HTML. Tags files and backups are checked, and only known fields are read, as text.

## Files

```
index.html        page shell + security policy
css/styles.css    layout, print styles, light/dark themes
js/util.js        DOM helpers, preferences, downloads, ZIP writer, PNG DPI tag
js/store.js       local database, card catalog, filtering, release-order sorting
js/tags.js        Cameo/Featured tags and the tags file (save, merge, reconnect)
js/api.js         TCGdex requests with retry; English bulk set requests; finishes per card
js/importer.js    import every set, one Pokémon, or one set
js/cricut.js      Cricut sheet rendering and cut-line SVG
js/app.js         the interface
```

## Settings you might change

- `js/api.js` → `SHADOWLESS_SETS`: sets that also had a Shadowless printing (default: Base Set).
- `js/cricut.js` → card size, gap, corner radius, DPI and paper sizes.
- `js/importer.js` → `CONCURRENCY` (parallel requests to TCGdex; 4 is polite).

Card data and images come from [TCGdex](https://tcgdex.dev).
Pokémon and its trademarks are © Nintendo, Creatures, GAME FREAK and The Pokémon Company.
This is an unofficial fan tool.
