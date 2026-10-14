/**
 * ==========================================================
 * Pokémon Master Set Companion
 * cricut.js
 *
 * Cricut Print-Then-Cut sheets. Each sheet produces:
 *   - <name>_sheetN.png       the printed cards (300 DPI)
 *   - <name>_sheetN_CUT.svg   matching cut lines (upload both,
 *                             stack, Align, Attach, Make It)
 *
 * Cards are drawn in the "companion" style (art on top, set name,
 * finish, language · year, set icon + number) and can be rotated 90°
 * to pack more onto a tall sheet. Everything runs in the browser.
 * ==========================================================
 */
"use strict";

const Cricut = (function () {

  // Print-Then-Cut PRINTABLE area (inside the registration marks), inches.
  const PAPER = {
    letter:  { label: "Letter 8.5×11",  w: 7.44,  h: 9.94 },
    legal:   { label: "Legal 8.5×14",   w: 7.44,  h: 12.9 },
    tabloid: { label: "Tabloid 11×17",  w: 10.64, h: 15.43 }
  };

  const CARD_W_IN      = 2.5;    // real card size (portrait)
  const CARD_H_IN      = 3.5;
  const CARD_GAP_IN    = 0.1;    // gap between cards
  const CARD_RADIUS_IN = 0.125;  // rounded corner radius
  const DPI            = 300;    // print resolution
  const IMAGE_TIMEOUT  = 20000;  // ms before giving up on one image

  const SERIF    = "Georgia, 'Times New Roman', serif";
  const NUM_FONT = "Arial, Helvetica, sans-serif";


  /**
   * Layout for a paper size and orientation.
   *
   * @param {string} paperKey  letter | legal | tabloid
   * @param {boolean} rotate   lay cards sideways
   * @return {Object}
   */
  function plan(paperKey, rotate) {
    const paper = PAPER[paperKey] || PAPER.legal;
    const cellW = rotate ? CARD_H_IN : CARD_W_IN;
    const cellH = rotate ? CARD_W_IN : CARD_H_IN;

    // +1e-6 absorbs float rounding (e.g. 13.0/2.6 = 4.9999… → 5).
    const cols = Math.max(1, Math.floor((paper.w + CARD_GAP_IN) / (cellW + CARD_GAP_IN) + 1e-6));
    const rows = Math.max(1, Math.floor((paper.h + CARD_GAP_IN) / (cellH + CARD_GAP_IN) + 1e-6));

    return {
      paper: paper, rotate: rotate,
      cellW: cellW, cellH: cellH,
      cols: cols, rows: rows, perSheet: cols * rows,
      // Tight grid size; the PNG and SVG share it so they line up.
      gridW: cols * cellW + (cols - 1) * CARD_GAP_IN,
      gridH: rows * cellH + (rows - 1) * CARD_GAP_IN
    };
  }


  /**
   * Loads an image for canvas use. TCGdex sends CORS headers, so the
   * canvas stays exportable. Resolves null on failure or timeout.
   */
  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) { resolve(null); return; }
      const im = new Image();
      const timer = setTimeout(function () { im.src = ""; resolve(null); }, IMAGE_TIMEOUT);
      im.crossOrigin = "anonymous";
      im.decoding = "async";
      im.onload = function () { clearTimeout(timer); resolve(im); };
      im.onerror = function () { clearTimeout(timer); resolve(null); };
      im.src = src;
    });
  }


  // Largest font size (down to 40% of base) that keeps text within maxW.
  function fitFont(ctx, text, maxW, basePx, family, weight) {
    const prefix = weight ? weight + " " : "";
    let px = basePx;
    ctx.font = prefix + Math.round(px) + "px " + family;
    while (px > basePx * 0.40 && ctx.measureText(text).width > maxW) {
      px -= 1;
      ctx.font = prefix + Math.round(px) + "px " + family;
    }
  }


  /** Draws one upright card. */
  function drawCard(ctx, W, H, card, cardImg, setIcon) {

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // Border.
    const bw = Math.max(2, 0.02 * W);
    ctx.lineWidth = bw;
    ctx.strokeStyle = "#000000";
    ctx.strokeRect(bw / 2, bw / 2, W - bw, H - bw);

    // Image area.
    const padX  = 0.09 * W;
    const top   = 0.05 * H;
    const areaW = W - 2 * padX;
    const areaH = 0.52 * H;

    if (cardImg) {
      const s = Math.min(areaW / cardImg.width, areaH / cardImg.height);
      const iw = cardImg.width * s, ih = cardImg.height * s;
      ctx.drawImage(cardImg, (W - iw) / 2, top + (areaH - ih) / 2, iw, ih);
    } else {
      ctx.fillStyle = "#eeeeee";
      ctx.fillRect(padX, top, areaW, areaH);
      ctx.fillStyle = "#888888";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold " + Math.round(0.05 * H) + "px " + SERIF;
      ctx.fillText("No Image", W / 2, top + areaH / 2 - 0.03 * H);
      ctx.font = Math.round(0.04 * H) + "px " + SERIF;
      ctx.fillText("Available", W / 2, top + areaH / 2 + 0.03 * H);
    }

    const FS = 0.05 * H; // one shared font size for all four lines
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    // Set name.
    const name = card.set || "";
    ctx.fillStyle = "#222222";
    fitFont(ctx, name, W * 0.86, FS, SERIF, "");
    ctx.fillText(name, W / 2, 0.63 * H);

    // Finish.
    const variant = card.variant || "";
    ctx.fillStyle = "#666666";
    fitFont(ctx, variant, W * 0.82, FS, SERIF, "");
    ctx.fillText(variant, W / 2, 0.71 * H);

    // Language · year.
    const langLabel = Collection.langYear(card);
    ctx.fillStyle = "#888888";
    fitFont(ctx, langLabel, W * 0.82, FS, SERIF, "");
    ctx.fillText(langLabel, W / 2, 0.785 * H);

    // Number, with the set icon on the same line.
    const num  = Collection.displayNumber(card);
    const numY = 0.86 * H;
    fitFont(ctx, num, W * 0.62, FS, NUM_FONT, "bold");
    const numW = ctx.measureText(num).width;
    ctx.fillStyle = "#000000";

    if (setIcon) {
      const iconH = 0.06 * H;
      const iconW = iconH * (setIcon.width / setIcon.height);
      const gapI  = 0.03 * W;
      const startX = (W - (iconW + gapI + numW)) / 2;
      ctx.drawImage(setIcon, startX, numY - iconH / 2, iconW, iconH);
      ctx.textAlign = "left";
      ctx.fillText(num, startX + iconW + gapI, numY);
    } else {
      ctx.textAlign = "center";
      ctx.fillText(num, W / 2, numY);
    }
  }


  /**
   * Renders one sheet to a PNG.
   *
   * @param {Object} p           plan()
   * @param {Object[]} cards     this sheet's cards
   * @param {Map} iconCache      set icon URL -> Promise<Image|null>
   * @param {HTMLCanvasElement} preview  optional, gets a thumbnail
   * @return {Promise<Uint8Array>}  PNG bytes tagged with DPI
   */
  async function renderSheet(p, cards, iconCache, preview) {

    const cardWpx = Math.round(CARD_W_IN * DPI);
    const cardHpx = Math.round(CARD_H_IN * DPI);
    const cellWpx = Math.round(p.cellW * DPI);
    const cellHpx = Math.round(p.cellH * DPI);
    const gap     = CARD_GAP_IN * DPI;

    const big = document.createElement("canvas");
    big.width  = Math.round(p.gridW * DPI);
    big.height = Math.round(p.gridH * DPI);
    const bctx = big.getContext("2d");

    const cardCanvas = document.createElement("canvas");
    cardCanvas.width  = cardWpx;
    cardCanvas.height = cardHpx;
    const cctx = cardCanvas.getContext("2d");

    function icon(url) {
      if (!url) { return Promise.resolve(null); }
      if (!iconCache.has(url)) { iconCache.set(url, loadImage(url)); }
      return iconCache.get(url);
    }

    const imgs = await Promise.all(cards.map(function (c) {
      return Promise.all([loadImage(c.imageUrl), icon(c.setIcon)]);
    }));

    cards.forEach(function (c, i) {
      drawCard(cctx, cardWpx, cardHpx, c, imgs[i][0], imgs[i][1]);

      const col = i % p.cols, row = Math.floor(i / p.cols);
      const cx = col * (cellWpx + gap) + cellWpx / 2;
      const cy = row * (cellHpx + gap) + cellHpx / 2;

      bctx.save();
      bctx.translate(cx, cy);
      if (p.rotate) { bctx.rotate(Math.PI / 2); }
      bctx.drawImage(cardCanvas, -cardWpx / 2, -cardHpx / 2, cardWpx, cardHpx);
      bctx.restore();
    });

    if (preview) {
      const pw = 260;
      preview.width = pw;
      preview.height = Math.round(big.height * (pw / big.width));
      preview.getContext("2d").drawImage(big, 0, 0, preview.width, preview.height);
    }

    const blob = await new Promise(function (resolve, reject) {
      try {
        big.toBlob(function (b) {
          if (b) { resolve(b); } else { reject(new Error("The browser couldn't create the PNG.")); }
        }, "image/png");
      } catch (err) {
        reject(new Error("An image blocked export (" + err.message + ")."));
      }
    });

    // Free the big canvas memory now rather than at garbage collection.
    big.width = big.height = 0;

    return pngWithDpi(new Uint8Array(await blob.arrayBuffer()), DPI);
  }


  /** Cut-line SVG: one rounded rectangle per card, matching the PNG. */
  function cutSvg(p, count) {
    const parts = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + p.gridW + 'in" height="' +
        p.gridH + 'in" viewBox="0 0 ' + p.gridW + ' ' + p.gridH + '">'
    ];

    for (let i = 0; i < count; i++) {
      const x = (i % p.cols) * (p.cellW + CARD_GAP_IN);
      const y = Math.floor(i / p.cols) * (p.cellH + CARD_GAP_IN);
      parts.push(
        '<rect x="' + +x.toFixed(4) + '" y="' + +y.toFixed(4) + '" width="' + p.cellW +
        '" height="' + p.cellH + '" rx="' + CARD_RADIUS_IN + '" ry="' + CARD_RADIUS_IN +
        '" fill="none" stroke="#000000" stroke-width="0.01"/>'
      );
    }

    parts.push("</svg>");
    return parts.join("\n");
  }


  return {
    PAPER: PAPER,
    DPI: DPI,
    plan: plan,
    renderSheet: renderSheet,
    cutSvg: cutSvg
  };

})();
