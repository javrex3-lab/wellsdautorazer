/**
 * /ticketop — TICKET LEADERBOARD PNG üreticisi.
 *
 * Kütüphane: @napi-rs/canvas (projede ZATEN kurulu — prebuilt binary, Linux/
 * Railway uyumlu, derleme gerektirmez). Yeni dependency EKLENMEZ.
 *
 * Tasarım karanlık/antrasit; 1. sıra altın, 2. gümüş, 3. bronz vurgulu.
 * Avatar indirmeleri zaman aşımlıdır; alınamazsa baş harf rozeti üretilir ve
 * görsel ÜRETİMİ ASLA çökmez.
 *
 * Diskte geçici dosya OLUŞTURULMAZ — sonuç doğrudan Buffer olarak döner ve
 * Discord'a `attachment://` ile eklenir.
 */
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ */
/* Yazı tipi — Linux imajlarında sistem fontu olmayabilir.             */
/* ------------------------------------------------------------------ */

const VARSAYILAN_FONT = 'sans-serif';
let FONT_KULLANILDI = VARSAYILAN_FONT;

/** Depoda varsa gömülü fontu kaydeder; yoksa sistem fontuna düşer. */
function fontuHazirla() {
  const adaylar = [
    path.join(__dirname, '..', '..', 'assets', 'font.ttf'),
    path.join(__dirname, '..', '..', 'assets', 'font.otf'),
  ];
  for (const p of adaylar) {
    try {
      if (fs.existsSync(p)) {
        if (GlobalFonts.registerFromPath(p, 'WellsdFont')) {
          FONT_KULLANILDI = 'WellsdFont';
          return FONT_KULLANILDI;
        }
      }
    } catch {
      /* varsayılana düş */
    }
  }
  return FONT_KULLANILDI;
}
fontuHazirla();

/* ------------------------------------------------------------------ */
/* Sabitler                                                            */
/* ------------------------------------------------------------------ */

const G = {
  W: 1100,
  tabloUst: 312,
  satirY: 112,
  kenar: 56,
  altPay: 92,
};

const RENK = {
  arka: '#0B0E14',
  kart: '#161B26',
  kartAlt: '#1B2130',
  cizgi: '#252C3D',
  mor: '#7C5CFF',
  morKoyu: '#4B36A8',
  mavi: '#38BDF8',
  altin: '#F5C451',
  altinKoyu: '#B8862B',
  gumus: '#C7D0DE',
  gumusKoyu: '#8A94A6',
  bronz: '#CD7F32',
  bronzKoyu: '#8A5522',
  beyaz: '#FFFFFF',
  gri: '#8B94A8',
  griKoyu: '#5A6377',
};

/** Sıraya göre madalya rengi (ilk 3 özel, sonrası nötr). */
function madalyaRengi(i) {
  if (i === 0) return RENK.altin;
  if (i === 1) return RENK.gumus;
  if (i === 2) return RENK.bronz;
  return RENK.morKoyu;
}

/* ------------------------------------------------------------------ */
/* Avatar                                                              */
/* ------------------------------------------------------------------ */

const AVATAR_TIMEOUT_MS = 6000;

/** Tek avatarı indirir; hata/timeout'ta null döner (asla throw etmez). */
async function avatarYukle(url) {
  if (!url) return null;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), AVATAR_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    if (!ab || !ab.byteLength) return null;
    return await loadImage(Buffer.from(ab));
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Avatar kırpılmış daire içine çizilir. */
function avatarCiz(ctx, img, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    const ratio = Math.max((r * 2) / img.width, (r * 2) / img.height);
    const w = img.width * ratio;
    const h = img.height * ratio;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  } else {
    ctx.fillStyle = RENK.morKoyu;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/** Avatar yoksa: baş harf rozeti (emoji/fonta bağımlı DEĞİL). */
function basHarfCiz(ctx, ad, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, RENK.mor);
  g.addColorStop(1, RENK.morKoyu);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = RENK.beyaz;
  ctx.font = `bold ${Math.round(r * 1.0)}px ${FONT_KULLANILDI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const harf = String(ad || '?').trim().charAt(0).toUpperCase() || '?';
  ctx.fillText(harf, cx, cy + 1);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Çizim yardımcıları                                                  */
/* ------------------------------------------------------------------ */

function yuvarlakDikdortgen(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function metinKirp(ctx, metin, maxGenislik) {
  let s = String(metin ?? '');
  if (ctx.measureText(s).width <= maxGenislik) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxGenislik) s = s.slice(0, -1);
  return s + '…';
}

/** Arka plan: dikey degrade + mor/mavi ışıma + ince ızgara. */
function arkaPlanCiz(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0E1220');
  g.addColorStop(0.55, RENK.arka);
  g.addColorStop(1, '#080A10');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const par = ctx.createRadialGradient(W / 2, -60, 0, W / 2, -60, 640);
  par.addColorStop(0, 'rgba(124,92,255,0.32)');
  par.addColorStop(1, 'rgba(124,92,255,0)');
  ctx.fillStyle = par;
  ctx.fillRect(0, 0, W, 660);

  const par2 = ctx.createRadialGradient(W - 120, H - 40, 0, W - 120, H - 40, 520);
  par2.addColorStop(0, 'rgba(56,189,248,0.16)');
  par2.addColorStop(1, 'rgba(56,189,248,0)');
  ctx.fillStyle = par2;
  ctx.fillRect(0, Math.max(0, H - 620), W, 620);

  ctx.strokeStyle = 'rgba(124,92,255,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 44) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
    ctx.stroke();
  }
}

function baslikCiz(ctx, W) {
  ctx.save();
  ctx.textAlign = 'center';

  const marka = 'W E L L S D A U T O R A Z E R';
  ctx.font = `600 20px ${FONT_KULLANILDI}`;
  const mw = ctx.measureText(marka).width + 46;
  yuvarlakDikdortgen(ctx, (W - mw) / 2, 44, mw, 40, 20);
  ctx.fillStyle = 'rgba(124,92,255,0.12)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(124,92,255,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#C9B8FF';
  ctx.textBaseline = 'middle';
  ctx.fillText(marka, W / 2, 65);

  ctx.font = `bold 74px ${FONT_KULLANILDI}`;
  const grad = ctx.createLinearGradient(0, 118, 0, 190);
  grad.addColorStop(0, '#FFFFFF');
  grad.addColorStop(1, RENK.mor);
  ctx.fillStyle = grad;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('TICKET LEADERBOARD', W / 2, 186);

  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(G.kenar, 212);
  ctx.lineTo(W - G.kenar, 212);
  ctx.stroke();

  ctx.font = `500 22px ${FONT_KULLANILDI}`;
  ctx.fillStyle = RENK.gri;
  ctx.fillText('En çok ticket sahiplenen yetkililer', W / 2, 248);
  ctx.restore();
}

/** Sıra satırının zeminini çizer; avatar/isim/sayı koordinatlarını döner. */
function satirZeminCiz(ctx, i) {
  const y = G.tabloUst + i * G.satirY;
  const x = G.kenar;
  const w = G.W - G.kenar * 2;
  const h = G.satirY - 16;
  const madalya = madalyaRengi(i);
  const vurgu = i < 3;

  yuvarlakDikdortgen(ctx, x, y, w, h, 16);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  if (i === 0) {
    g.addColorStop(0, '#2C2516');
    g.addColorStop(1, '#191C26');
  } else if (i === 1) {
    g.addColorStop(0, '#202533');
    g.addColorStop(1, '#151A24');
  } else if (i === 2) {
    g.addColorStop(0, '#261D15');
    g.addColorStop(1, '#151A24');
  } else {
    g.addColorStop(0, RENK.kart);
    g.addColorStop(1, RENK.kartAlt);
  }
  ctx.fillStyle = g;
  ctx.fill();

  ctx.strokeStyle = vurgu ? madalya : RENK.cizgi;
  ctx.globalAlpha = vurgu ? 0.5 : 1;
  ctx.lineWidth = vurgu ? 2 : 1;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // sol renk şeridi
  ctx.save();
  yuvarlakDikdortgen(ctx, x, y, 8, h, 4);
  ctx.fillStyle = madalya;
  ctx.fill();
  ctx.restore();

  // sıra madalyası
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const nx = x + 62;
  if (vurgu) {
    ctx.beginPath();
    ctx.arc(nx, y + h / 2, 30, 0, Math.PI * 2);
    const ng = ctx.createLinearGradient(nx - 30, y, nx + 30, y + h);
    ng.addColorStop(0, madalya);
    ng.addColorStop(1, i === 0 ? RENK.altinKoyu : i === 1 ? RENK.gumusKoyu : RENK.bronzKoyu);
    ctx.fillStyle = ng;
    ctx.fill();
    ctx.fillStyle = i === 1 ? '#1A1F2B' : '#1A1408';
    ctx.font = `bold 34px ${FONT_KULLANILDI}`;
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    yuvarlakDikdortgen(ctx, nx - 26, y + h / 2 - 26, 52, 52, 14);
    ctx.fill();
    ctx.fillStyle = RENK.gri;
    ctx.font = `bold 26px ${FONT_KULLANILDI}`;
  }
  ctx.fillText(String(i + 1), nx, y + h / 2 + 1);
  ctx.restore();

  return { x, y, w, h, medyax: y + h / 2 };
}

/* ------------------------------------------------------------------ */
/* Ana çizim                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {Array<{user_id:string, ad?:string, adGorsel?:string, avatarUrl?:string|null, claimed_count:number}>} satirlar
 * @param {{guildName?:string, toplam?:number}} opts
 * @returns {Promise<Buffer>} PNG
 */
async function leaderboardCiz(satirlar, opts = {}) {
  const liste = Array.isArray(satirlar) ? satirlar.slice(0, 10) : [];
  // Boş durumda tek satırlık yerine içerik bloğu için yer ayrılır; aksi halde
  // metin tuvalin altına taşıp alt bilgiyle çakışır.
  const H = G.tabloUst + G.altPay + Math.max(liste.length, 4) * G.satirY + 20;

  const canvas = createCanvas(G.W, H);
  const ctx = canvas.getContext('2d');

  arkaPlanCiz(ctx, G.W, H);
  baslikCiz(ctx, G.W);

  // ── Boş durum — profesyonel görsel, hata DEĞİL ────────────────
  if (!liste.length) {
    const cx = G.W / 2;
    const cy = G.tabloUst + 200;
    ctx.save();
    ctx.textAlign = 'center';

    ctx.beginPath();
    ctx.arc(cx, cy - 70, 66, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(124,92,255,0.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(124,92,255,0.40)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // yükselen çubuk ikonu (font/emojiye bağımlı değil)
    const bx = cx - 30;
    const by = cy - 6;
    [16, 28, 42].forEach((hh, k) => {
      ctx.fillStyle = [RENK.gumusKoyu, RENK.mor, RENK.mor][k];
      yuvarlakDikdortgen(ctx, bx + k * 22, by - hh, 14, hh, 4);
      ctx.fill();
    });

    ctx.textBaseline = 'middle';
    ctx.font = `bold 42px ${FONT_KULLANILDI}`;
    ctx.fillStyle = RENK.beyaz;
    ctx.fillText('Henüz veri yok', cx, cy + 44);
    ctx.font = `500 24px ${FONT_KULLANILDI}`;
    ctx.fillStyle = RENK.gri;
    ctx.fillText('Henüz kaydedilmiş ticket sahiplenme istatistiği bulunmuyor.', cx, cy + 92);
    ctx.restore();
  }

  // ── Avatarlar (paralel, zaman aşımlı, hata yutucu) ─────────────
  const avatarlar = await Promise.all(liste.map((s) => avatarYukle(s.avatarUrl).catch(() => null)));

  // ── Satırlar ─────────────────────────────────────────────────
  for (let i = 0; i < liste.length; i++) {
    const s = liste[i];
    const k = satirZeminCiz(ctx, i);
    const r = 40;

    if (avatarlar[i]) avatarCiz(ctx, avatarlar[i], k.x + 150, k.medyax, r);
    else basHarfCiz(ctx, s.adGorsel || s.ad || s.user_id, k.x + 150, k.medyax, r);

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `bold 30px ${FONT_KULLANILDI}`;
    ctx.fillStyle = i < 3 ? '#FFFFFF' : '#E4E8F0';
    ctx.fillText(
      metinKirp(ctx, String(s.adGorsel || s.ad || 'Bilinmeyen'), 380),
      k.x + 214,
      k.medyax + 4,
    );

    ctx.font = `500 19px ${FONT_KULLANILDI}`;
    ctx.fillStyle = RENK.griKoyu;
    const alt = s.ad && s.adGorsel && s.ad !== s.adGorsel ? `${s.adGorsel}  •  ${s.user_id}` : String(s.user_id);
    ctx.fillText(metinKirp(ctx, alt, 380), k.x + 214, k.medyax + 32);
    ctx.restore();

    // sağdaki sayı
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const sayi = String(s.claimed_count);
    ctx.font = `bold 46px ${FONT_KULLANILDI}`;
    const sg = ctx.createLinearGradient(k.x + k.w - 250, k.medyax - 30, k.x + k.w - 90, k.medyax + 30);
    sg.addColorStop(0, madalyaRengi(i));
    sg.addColorStop(1, i === 0 ? RENK.altinKoyu : i === 1 ? RENK.gumusKoyu : i === 2 ? RENK.bronzKoyu : RENK.morKoyu);
    ctx.fillStyle = sg;
    ctx.fillText(sayi, k.x + k.w - 96, k.medyax);

    ctx.font = `600 16px ${FONT_KULLANILDI}`;
    ctx.fillStyle = RENK.griKoyu;
    ctx.fillText('TICKET', k.x + k.w - 42, k.medyax + 30);
    ctx.restore();
  }

  // ── Alt bilgi ────────────────────────────────────────────────
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 20px ${FONT_KULLANILDI}`;
  ctx.fillStyle = RENK.griKoyu;
  const altSatir =
    (opts.guildName ? opts.guildName + '  •  ' : '') +
    (liste.length ? 'İlk ' + liste.length + ' yetkili' : 'Sıralama') +
    (opts.toplam ? `  •  Toplam ${opts.toplam} sahiplenme` : '');
  ctx.fillText(altSatir, G.W / 2, H - 50);

  ctx.font = `500 15px ${FONT_KULLANILDI}`;
  ctx.fillStyle = 'rgba(139,148,168,0.55)';
  ctx.fillText('WellsdAutorazer • Ticket Sahiplenme Sistemi', G.W / 2, H - 26);
  ctx.restore();

  return canvas.toBuffer('image/png');
}

module.exports = { leaderboardCiz, avatarYukle, madalyaRengi, G, RENK };