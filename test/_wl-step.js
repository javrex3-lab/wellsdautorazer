/**
 * Tek adım çalıştırıcı — test tarafından AYRI node sürecinde çağrılır
 * (gerçek restart taklidi). Son satıra JSON yazar.
 */
const G = '1354465879311777893';
const U1 = '100000000000000777';
const U2 = '100000000000000778';
const AKTOR = '1056585742731726918';
const adim = process.argv[2];

const db = require('../src/database/database');
db.initDatabase();

const liste = () => db.listWhitelist(G).map((k) => ({ user_id: k.user_id, level: k.level }));
const cikti = (o) => {
  // ÖNCE kapat (kapanış logu JSON'dan SONRA basılmalı ki JSON son satır kalsın)
  try { db.closeDatabase(); } catch { /* zaten kapalı */ }
  process.stdout.write('###JSON###' + JSON.stringify(o) + '\n');
  process.exit(0);
};

switch (adim) {
  case 'ekle':
    db.setGuardLevel(G, U2, 4, AKTOR);
    cikti({
      created: db.setGuardLevel(G, U1, 2, AKTOR).created,
      kayitlar: liste(),
      toplam: liste().length,
      level: db.getGuardLevel(G, U1),
    });
    break;

  case 'oku':
    cikti({
      kayitlar: liste(),
      toplam: liste().length,
      level: db.getGuardLevel(G, U1),
    });
    break;

  case 'tekrar-ekle':
    cikti({
      created: db.setGuardLevel(G, U1, 3, AKTOR).created,
      kayit: liste().filter((k) => k.user_id === U1).length,
      level: db.getGuardLevel(G, U1),
    });
    break;

  case 'sil':
    cikti({ silindi: db.removeGuard(G, U1), kayitlar: liste() });
    break;

  default:
    cikti({ hata: 'bilinmeyen adım: ' + adim });
}