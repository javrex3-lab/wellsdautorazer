/**
 * Mazeret sistemi testleri.
 * Kapsam: süre ayrıştırma, biçimlendirme, panel embed limitleri, numaralandırma.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDuration,
  formatDuration,
  remainingLabel,
  MIN_DURATION_MS,
  MAX_DURATION_MS,
  DEFAULT_DURATION_MS,
} = require('../src/utils/mazeretDuration');
const { buildActiveMazeretEmbed, buildMazeretPanelEmbed, numberEmoji } = require('../src/utils/mazeretEmbeds');

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/* ------------------------------------------------------------------ */
/* Süre ayrıştırma                                                     */
/* ------------------------------------------------------------------ */

test('parseDuration: gün/saat/hafta/dakika tanır', () => {
  assert.equal(parseDuration('3 gün').ms, 3 * DAY);
  assert.equal(parseDuration('12 saat').ms, 12 * HOUR);
  assert.equal(parseDuration('1 hafta').ms, WEEK);
  assert.equal(parseDuration('45 dakika').ms, 45 * MIN);
});

test('parseDuration: yazım varyasyonlarını tolere eder', () => {
  // "hafta" kelimesi "saat"e takılmamalı (eski hata: hr?s? deseni)
  assert.equal(parseDuration('1 hafta').ms, WEEK, '"hafta" yanlış birim sayılıyor');
  assert.equal(parseDuration('3gun').ms, 3 * DAY, 'boşluk olmadan yazım');
  assert.equal(parseDuration('3 GÜN').ms, 3 * DAY, 'büyük harf + Türkçe İ');
  assert.equal(parseDuration('12saat').ms, 12 * HOUR);
  assert.equal(parseDuration('1h').ms, HOUR, 'kısa yazım h');
  assert.equal(parseDuration('1w').ms, WEEK, 'kısa yazım w');
});

test('parseDuration: bileşik süreyi toplar', () => {
  assert.equal(parseDuration('2 hafta 3 gün').ms, 2 * WEEK + 3 * DAY);
  assert.equal(parseDuration('1 hafta 12 saat').ms, WEEK + 12 * HOUR);
  assert.equal(parseDuration('5 gün 4 saat 30 dakika').ms, 5 * DAY + 4 * HOUR + 30 * MIN);
  assert.equal(parseDuration('1,5 gün').ms, 1.5 * DAY, 'ondalık ayrımı');
});

test('parseDuration: ayrıştırılamayan metin varsayılana düşer', () => {
  for (const bozuk of ['', '   ', 'abc', 'bilmiyorum', '??']) {
    const r = parseDuration(bozuk);
    assert.equal(r.parsed, false, `"${bozuk} ayrıştırılmamalıydı`);
    assert.equal(r.ms, DEFAULT_DURATION_MS);
  }
});

test('parseDuration: alt/üst sınırlar uygulanır', () => {
  const kisa = parseDuration('1 dakika');
  assert.equal(kisa.ms, MIN_DURATION_MS, 'çok kısa süre yükseltilmeli');
  assert.equal(kisa.clamped, true);

  const uzun = parseDuration('365 gün');
  assert.equal(uzun.ms, MAX_DURATION_MS, 'çok uzun süre kırpılmalı');
  assert.equal(uzun.clamped, true);

  const tam = parseDuration('30 gün');
  assert.equal(tam.clamped, false, 'sınır içindeki süre değişmemeli');
});

test('parseDuration: negatif ve sıfır yok sayılır', () => {
  const r = parseDuration('0 gün');
  assert.equal(r.ms, DEFAULT_DURATION_MS);
});

/* ------------------------------------------------------------------ */
/* Biçimlendirme                                                      */
/* ------------------------------------------------------------------ */

test('formatDuration: okunur Türkçe metin üretir', () => {
  assert.equal(formatDuration(45 * MIN), '45 dakika');
  assert.equal(formatDuration(HOUR), '1 saat');
  assert.equal(formatDuration(3 * DAY), '3 gün');
  assert.equal(formatDuration(WEEK), '1 hafta');
  assert.equal(formatDuration(WEEK + 2 * DAY), '1 hafta 2 gün');
  assert.equal(formatDuration(5 * DAY + 4 * HOUR + 30 * MIN), '5 gün 4 saat 30 dakika');
});

test('formatDuration: 30 günden uzun süreler gün cinsinden', () => {
  assert.equal(formatDuration(90 * DAY), '90 gün');
  assert.equal(formatDuration(60 * DAY), '60 gün', '"8 hafta 4 gün" okunması zor');
});

test('formatDuration: bozuk girdi çökmez', () => {
  assert.doesNotThrow(() => formatDuration(undefined));
  assert.doesNotThrow(() => formatDuration(-5));
  assert.equal(formatDuration(0), 'birkaç dakika');
});

test('remainingLabel: süre doldu / kaldı', () => {
  const now = Date.now();
  assert.equal(remainingLabel(now - 1000, now), 'Süresi doldu');
  assert.equal(remainingLabel(now + DAY, now), '1 gün kaldı');
});

/* ------------------------------------------------------------------ */
/* Panel embed'i                                                       */
/* ------------------------------------------------------------------ */

function fakeRow(i, now) {
  return {
    user_id: '10000000000000000' + i,
    reason: 'test sebebi ' + i,
    duration_ms: (i % 5 + 1) * DAY,
    created_at: now - HOUR,
    expires_at: now + (i % 5 + 1) * DAY,
    reported_by: '20000000000000000' + i,
  };
}

test('buildActiveMazeretEmbed: boş listede bilgi verir', () => {
  const e = buildActiveMazeretEmbed([], {}).toJSON();
  assert.match(e.description, /mazeretli memur bulunmuyor/i);
  assert.match(e.title, /Aktif Mazeretli/i);
});

test('buildActiveMazeretEmbed: numaralı liste üretir', () => {
  const now = Date.now();
  const rows = [0, 1, 2].map((i) => fakeRow(i + 1, now));
  const e = buildActiveMazeretEmbed(rows, {}).toJSON();
  assert.match(e.description, /1️⃣/, 'ilk kayıt 1️⃣ ile numaralanmalı');
  assert.match(e.description, /2️⃣/);
  assert.match(e.description, /3️⃣/);
  for (const r of rows) {
    assert.ok(e.description.includes(`<@${r.user_id}>`), 'kullanıcı mention edilmeli');
    assert.ok(e.description.includes(`<@${r.reported_by}>`), 'onaylayan mention edilmeli');
  }
  assert.match(e.description, /Sebep/, 'sebep etiketi olmalı');
  assert.match(e.footer.text, /Toplam: 3/);
});

test('buildActiveMazeretEmbed: Discord 4096 limitini asmaz', () => {
  const now = Date.now();
  const rows = Array.from({ length: 200 }, (_, i) => ({
    ...fakeRow(i + 1, now),
    reason: 'çok uzun sebep '.repeat(20),
  }));
  const e = buildActiveMazeretEmbed(rows, {}).toJSON();
  assert.ok(e.description.length <= 4096, `açıklama ${e.description.length} karakter, sınır aşıldı`);
  assert.match(e.description, /kişi daha listelenemedi/, 'taşan kısım özetlenmeli');
  assert.match(e.footer.text, /Toplam: 200/, 'gerçek toplam yazılmalı (özet olsa bile)');
});

test('numberEmoji: 1-9 ve 10+', () => {
  assert.equal(numberEmoji(1), '1️⃣');
  assert.equal(numberEmoji(9), '9️⃣');
  assert.equal(numberEmoji(10), '1️⃣0️⃣');
  assert.equal(numberEmoji(25), '2️⃣5️⃣');
  assert.equal(numberEmoji(100), '#100.');
});

test('buildMazeretPanelEmbed: buton ve aktif sayısı', () => {
  const e = buildMazeretPanelEmbed({ activeCount: 4 }).toJSON();
  assert.match(e.title, /Mazeret Bildirimi/);
  const field = (e.fields || []).find((f) => /Şu an mazeretli/.test(f.name));
  assert.ok(field, 'aktif sayısı alanı olmalı');
  assert.match(field.value, /4/);
});
