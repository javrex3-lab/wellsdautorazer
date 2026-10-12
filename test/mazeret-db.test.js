/** Mazeret DB katmani: gecici veritabani ile uctan uca test. */
process.env.DB_PATH = require('path').join(require('os').tmpdir(), 'mztest-' + Date.now() + '.db');
const os = require('os');
const path = require('path');
const fs = require('fs');

const db = require('../src/database/database');
const { parseDuration, formatDuration } = require('../src/utils/mazeretDuration');

const G = '1354465879311777893';
const U1 = '100000000000000001';
const U2 = '100000000000000002';
const STAFF = '1056585742731726918';

db.initDatabase();

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '  ' + extra); }
};

console.log('='.repeat(62));
console.log('  MAZERET DB KATMANI');
console.log('='.repeat(62));

/* --- kaydet --- */
const p1 = parseDuration('3 gün');
const r1 = db.createMazeretRecord({
  guildId: G, userId: U1, reason: 'Hastaneye gidiyorum',
  durationRaw: p1.raw, durationMs: p1.ms, durationGuess: false, reportedBy: STAFF,
});
check('kayit olusturuldu', r1.ok && r1.record?.id > 0, JSON.stringify(r1));
check('sure dogru hesaplandi', r1.record?.duration_ms === 3 * 86400000);
check('bitis = baslangic + sure', r1.record?.expires_at - r1.record?.created_at === 3 * 86400000);
check('varsayilan aktif', r1.record?.active === 1);
check('onaylayan kaydedildi', r1.record?.reported_by === STAFF);

/* --- mükerrer kayıt engellenir --- */
const dup = db.createMazeretRecord({
  guildId: G, userId: U1, reason: 'tekrar', durationRaw: '1 gün',
  durationMs: 86400000, durationGuess: false, reportedBy: STAFF,
});
check('ayni kullaniciya mukerrer kayit acilmaz', dup.ok === false && dup.error === 'already_active');

/* --- ikinci kullanıcı --- */
const p2 = parseDuration('12 saat');
db.createMazeretRecord({
  guildId: G, userId: U2, reason: 'İş seyahati',
  durationRaw: p2.raw, durationMs: p2.ms, durationGuess: false, reportedBy: STAFF,
});

/* --- listeleme --- */
const list = db.getActiveMazerets(G);
check('iki aktif kayit listelendi', list.length === 2, `bulunan: ${list.length}`);
check('kisa sure once gelir', list[0].user_id === U2, 'en kisa sure en basta olmali');

/* --- kullanıcı bazlı sorgu --- */
const u1 = db.getActiveMazeretByUser(G, U1);
check('kullanici bazli kayit bulundu', u1?.user_id === U1);
check('kayit yoksa null', db.getActiveMazeretByUser(G, '999999999999999999') === null);

/* --- süre bitince listeden düşer --- */
const short = parseDuration('2 saat');
db.createMazeretRecord({
  guildId: G, userId: '100000000000000003', reason: 'kisa',
  durationRaw: '2 saat', durationMs: 1, durationGuess: false, reportedBy: STAFF, // 1ms -> hemen dolarsin
});
const after = db.getActiveMazerets(G);
check('suresi dolan listeden dusmus', !after.some((r) => r.user_id === '100000000000000003'), 'hala duruyor');

/* --- manuel bitirme --- */
const endRes = db.endMazeret(G, U1, STAFF, 'manual');
check('mazeret manuel bitirildi', endRes.ok && endRes.record.active === 0);
check('bitis nedeni kaydedildi', endRes.record.end_reason === 'manual');
check('bitiren yetkili kaydedildi', endRes.record.ended_by === STAFF);
check('artik listede degil', !db.getActiveMazerets(G).some((r) => r.user_id === U1));
check('olmayan mazereti bitirme hatasi', db.endMazeret(G, U1, STAFF).error === 'not_found');

/* --- panel mesajı hatırlama --- */
db.upsertMazeretActivePanel(G, 'admin', '1548927431597883472', '9990001112223334440');
const panel = db.getMazeretActivePanel(G, 'admin');
check('panel mesaji hatirlaniyor', panel?.message_id === '9990001112223334440');
check('farkli kind ayri kayit', db.getMazeretActivePanel(G, 'public') === null);
db.upsertMazeretActivePanel(G, 'admin', '1548927431597883472', '9990001112223334449');
check('panel mesaji guncelleniyor', db.getMazeretActivePanel(G, 'admin').message_id === '9990001112223334449');
db.deleteMazeretActivePanel(G, 'admin');
check('panel kaydi silinebiliyor', db.getMazeretActivePanel(G, 'admin') === null);

/* --- süre tahmin bayrağı --- */
const rGuess = db.createMazeretRecord({
  guildId: G, userId: '100000000000000004', reason: 'bilinmeyen',
  durationRaw: 'bilmiyorum', durationMs: parseDuration('bilmiyorum').ms,
  durationGuess: true, reportedBy: STAFF,
});
check('tahmin bayragi saklanir', rGuess.record?.duration_guess === 1);
check('tahmin edilen sure varsayilan', rGuess.record?.duration_ms === 86400000);

/* --- diğer guild izolasyonu --- */
db.createMazeretRecord({
  guildId: '111111111111111111', userId: '100000000000000009', reason: 'x',
  durationRaw: '1 gün', durationMs: 86400000, durationGuess: false, reportedBy: STAFF,
});
check('guild izolasyonu', db.getActiveMazerets(G).every((r) => r.guild_id === G));

/* --- XSS / enjeksiyon dayanıklılığı --- */
const bad = db.createMazeretRecord({
  guildId: G, userId: '100000000000000005',
  reason: "'; DROP TABLE mazeret_records; -- <@everyone>",
  durationRaw: '1 gün', durationMs: 86400000, durationGuess: false, reportedBy: STAFF,
});
check('zararli metin oldugu gibi saklaniyor (parametrik sorgu)', bad.ok && bad.record.reason.includes('DROP TABLE'));
check('tablo hala ayakta', Array.isArray(db.getActiveMazerets(G)));

db.closeDatabase();
try { fs.unlinkSync(process.env.DB_PATH); } catch {}

console.log('\n' + '='.repeat(62));
console.log(`  ${pass} gecti, ${fail} kaldi`);
console.log('='.repeat(62));
process.exit(fail === 0 ? 0 : 1);
