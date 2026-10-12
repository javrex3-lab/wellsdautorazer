/**
 * Mazeret süresi ayrıştırıcı / biçimlendirici.
 *
 * Kullanıcı serbest metin yazar: "3 gün", "12 saat", "1 hafta", "2 hafta 3 gün".
 * Burada iki iş yapılır:
 *   1) parseDuration()  -> metni milisaniyeye çevirir (otomatik bitiş hesabı için)
 *   2) formatDuration() -> ms'yi okunur Türkçe metne çevirir (panelde göstermek için)
 *
 * Serbest yazım yanlışsa çökmez: geçersizse varsayılan 1 gün uygulanır ve
 * `parsed:false` döner, çağıran taraf kullanıcıyı bilgilendirebilir.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Kabul edilen alt sınır (5 dakika) ve üst sınır (90 gün). */
const MIN_DURATION_MS = 5 * MINUTE;
const MAX_DURATION_MS = 90 * DAY;
const DEFAULT_DURATION_MS = DAY;

/**
 * Birim sözlüğü. `re` alanı metinde aranan kalıptır (küçük harfe çevrilmiş metinde).
 * ms: o birimin kaç milisaniye ettiği.
 */
// `re` TAM EŞLEŞMElidir (^...$): aksi halde "hafta" içindeki "h" "saat"e
// (hr?s?) takılıp süreyi yanlış hesaplıyordu.
const UNITS = [
  { key: 'dakika', re: /^(dakika|dakikalar|dk|min|minute|minutes|minut|mins|mn)$/, ms: MINUTE },
  { key: 'saat', re: /^(saat|saatler|st|hour|hours|hr|hrs|h)$/, ms: HOUR },
  { key: 'gun', re: /^(gün|günler|gun|gunler|g|day|days|d)$/, ms: DAY },
  { key: 'hafta', re: /^(hafta|haftalar|week|weeks|wk|w)$/, ms: WEEK },
];

/** Türkçe + kısa yazımı ASCII'ye indirger: "GÜN" -> "gun", "3Gün" -> "3gun". */
function normalize(input) {
  return String(input || '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/Ş/gi, 's')
    .replace(/ş/gi, 's')
    .replace(/Ğ/gi, 'g')
    .replace(/ğ/gi, 'g')
    .replace(/Ü/gi, 'u')
    .replace(/ü/gi, 'u')
    .replace(/Ö/gi, 'o')
    .replace(/ö/gi, 'o')
    .replace(/Ç/gi, 'c')
    .replace(/ç/gi, 'c')
    .toLowerCase()
    .trim();
}

/**
 * "3 gün 12 saat" -> [{ n:3, unit:gun }, { n:12, unit:saat }]
 * Sayı ile birim arasındaki gereksiz karakterleri (nokta, tire, boşluk) atlar.
 */
function extractParts(input) {
  const text = normalize(input);
  const parts = [];
  // sayı: tam sayı veya ondalık. Sonra 0+ ayraç, sonra birim.
  const re = /(\d+(?:[.,]\d+)?)\s*[-–—]?\s*([a-zçğıöşü]{1,12})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1].replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) continue;
    const unit = UNITS.find((u) => u.re.test(m[2]));
    if (unit) parts.push({ n, unit: unit.key, ms: unit.ms });
  }
  return parts;
}

/**
 * Serbest metni milisaniyeye çevirir.
 * @param {string} input örn. "3 gün", "12 saat", "1 hafta 2 gün"
 * @returns {{ms:number, raw:string, parsed:boolean, parts:Array, clamped:boolean}}
 */
function parseDuration(input) {
  const raw = String(input || '').trim();
  const parts = extractParts(raw);

  if (!parts.length) {
    return { ms: DEFAULT_DURATION_MS, raw, parsed: false, parts: [], clamped: false };
  }

  let ms = parts.reduce((sum, p) => sum + p.n * p.ms, 0);
  let clamped = false;
  if (ms < MIN_DURATION_MS) {
    ms = MIN_DURATION_MS;
    clamped = true;
  } else if (ms > MAX_DURATION_MS) {
    ms = MAX_DURATION_MS;
    clamped = true;
  }

  return { ms, raw, parsed: true, parts, clamped };
}

/**
 * Milisaniyeyi okunur Türkçe metne çevirir.
 * @param {number} ms
 * @returns {string} örn. "3 gün" / "1 hafta 2 gün" / "45 dakika"
 */
function formatDuration(ms) {
  let left = Math.max(0, Math.round(Number(ms) || 0));
  if (left < MINUTE) return 'birkaç dakika';

  const chunks = [];
  // 30 günden uzun süreler "hafta" yerine "gün" ile gösterilir (12 hafta 6 gün
  // yerine 90 gün — okunması kolay, sınırı da belli eder).
  const useWeeks = left < 30 * DAY;
  const units = [
    useWeeks ? ['hafta', WEEK] : null,
    ['gün', DAY],
    ['saat', HOUR],
    ['dakika', MINUTE],
  ].filter(Boolean);

  for (const [name, size] of units) {
    const n = Math.floor(left / size);
    if (n > 0) {
      chunks.push(`${n} ${name}`);
      left -= n * size;
    }
  }
  return chunks.length ? chunks.join(' ') : 'birkaç dakika';
}

/**
 * "Kalan süre" etiketi: süre dolduysa "Süresi doldu", dolmadıysa "X kaldı".
 * @param {number} expiresAt
 * @param {number} now
 */
function remainingLabel(expiresAt, now = Date.now()) {
  const left = Number(expiresAt) - now;
  if (!Number.isFinite(left) || left <= 0) return 'Süresi doldu';
  return `${formatDuration(left)} kaldı`;
}

module.exports = {
  MINUTE,
  HOUR,
  DAY,
  WEEK,
  MIN_DURATION_MS,
  MAX_DURATION_MS,
  DEFAULT_DURATION_MS,
  normalize,
  extractParts,
  parseDuration,
  formatDuration,
  remainingLabel,
};
