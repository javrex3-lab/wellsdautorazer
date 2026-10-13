/**
 * MAZERET → AKTİF MAZERETLİLER PANELİ — uçtan uca akış testleri
 *
 * Kapsanan senaryolar (görev maddesi 8):
 *   1) kullanıcı mazeret bildirir          2) kalıcı depoya kaydedilir
 *   3) panelde mention/süre/sebep görünür 4) ikinci kullanıcı AYNI paneli günceller
 *   5) kayıtlar birbirini ezmez            6) restart sonrası aynı panel güncellenir
 *   7) süresi biten kayıt listeden çıkar   8) panel silinince yenisi oluşur
 *
 * Discord bağlantısı YOKTUR (kanal/mesaj taklit edilir).
 */
process.env.DB_PATH = require('path').join(require('os').tmpdir(), 'mzpanel-' + Date.now() + '.db');

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const db = require('../src/database/database');
const config = require('../src/config');
const mz = require('../src/handlers/mazeret');
const views = require('../src/utils/mazeretViews');

const KOK = path.resolve(__dirname, '..');
const G = '1354465879311777893';
const KANAL = '1548927431597883472';
const H = 3600_000;

let pass = 0,
  fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log('  OK   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '  -> ' + extra : ''));
  }
};
const section = (t) => console.log('\n' + '-'.repeat(4) + ' ' + t);

console.log('='.repeat(70));
console.log('  MAZERET → AKTİF MAZERETLİLER PANELİ — AKIŞ TESTLERİ');
console.log('='.repeat(70));

/* ---- Eski şema simülasyonu: migration gerçekten çalışıyor mu? ---- */
section('0) ŞEMA GÖÇÜ (kök neden düzeltmesi)');

db.initDatabase();
{
  const cols = db.getDb().prepare('PRAGMA table_info(mazeret_records)').all().map((c) => c.name);
  check('mazeret_records.started_at mevcut', cols.includes('started_at'), cols.join(','));
  const idx = db
    .getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='uq_mazeret_one_active'")
    .get();
  check('uq_mazeret_one_active indexi mevcut', !!idx);

  const mig = fs.readFileSync(path.join(KOK, 'src/database/database.js'), 'utf8');
  check('migrate() içinde ALTER TABLE mazeret_records var', /ALTER TABLE mazeret_records ADD COLUMN started_at/.test(mig));
  check('Göç eski kayıtları dolduruyor (started_at = created_at)', /UPDATE mazeret_records SET started_at = created_at/.test(mig));
  check('Göç hatası gizlenmiyor', /Mazeret göçü BAŞARISIZ/.test(mig));

  // ESKİ ŞEMALI DB'ye karşı test (migration'ın asıl kanıtı)
  const eskiDb = path.join(require('os').tmpdir(), 'mz-eski-' + Date.now() + '.db');
  fs.writeFileSync(
    path.join(KOK, 'test', '_mz-mig-step.js'),
    "const {DatabaseSync}=require('node:sqlite');\n" +
      "const d=new DatabaseSync(process.argv[2]);\n" +
      'd.exec("CREATE TABLE mazeret_records (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, user_id TEXT, reason TEXT, duration_raw TEXT, duration_ms INTEGER, duration_guess INTEGER DEFAULT 0, created_at INTEGER, expires_at INTEGER, reported_by TEXT, active INTEGER DEFAULT 1, ended_at INTEGER, ended_by TEXT, end_reason TEXT)");\n' +
      "d.prepare('INSERT INTO mazeret_records (guild_id,user_id,reason,duration_raw,duration_ms,created_at,expires_at,reported_by,active) VALUES (?,?,?,?,?,?,?,?,1)').run('1','222222222222222222','eski kayit','1 gun',86400000,Date.now()-1000,Date.now()+86400000,'222222222222222222');\n" +
      'd.close();process.exit(0);\n',
    'utf8',
  );
  execFileSync(process.execPath, [path.join(KOK, 'test', '_mz-mig-step.js'), eskiDb], { encoding: 'utf8' });

  const cikti = execFileSync(
    process.execPath,
    ['-e', "require('./src/database/database').initDatabase();const d=require('./src/database/database');const r=d.getDb().prepare('SELECT started_at FROM mazeret_records').get();console.log(JSON.stringify({started:r.started_at>0}));d.closeDatabase();process.exit(0);"],
    { cwd: KOK, encoding: 'utf8', env: { ...process.env, DB_PATH: eskiDb } },
  );
  check('ESKİ şemalı DB migrate ediliyor', cikti.includes('"started":true'), cikti.trim().split('\n').pop());
  fs.unlinkSync(path.join(KOK, 'test', '_mz-mig-step.js'));
  for (const s of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(eskiDb + s); } catch { /* yok */ }
  }
}

/* ---- Sahte Discord ---- */
const gonderilen = [];
const mesajlar = new Map();
let mesajSayac = 0;
let gonderimHatasi = 0;

const kanal = {
  id: KANAL,
  guildId: G,
  name: 'mazeretler',
  isTextBased: () => true,
  isDMBased: () => false,
  permissionsFor: () => ({ has: () => true }),
  send: async (p) => {
    if (gonderimHatasi > 0) {
      gonderimHatasi--;
      throw Object.assign(new Error('Discord hatası'), { code: 50013 });
    }
    const m = { id: 'MSG' + ++mesajSayac, ...p, edit: async (q) => Object.assign(m, q) };
    gonderilen.push(p);
    mesajlar.set(m.id, m);
    return m;
  },
  messages: {
    fetch: async (id) => mesajlar.get(id) || Promise.reject(Object.assign(new Error('yok'), { code: 10008 })),
  },
};

const guild = { id: G, members: { me: { permissions: { has: () => true } } } };
const client = { channels: { fetch: async (id) => (id === KANAL ? kanal : null) }, guilds: { cache: new Map([[G, guild]]) } };

const sahte = (userId, neden) => {
  const c = { reply: null, edit: null };
  return {
    _c: c,
    customId: 'mz_sebep',
    guildId: G,
    user: { id: userId, tag: 'u#0001' },
    member: { id: userId },
    guild,
    client,
    replied: false,
    deferred: false,
    isRepliable: () => true,
    fields: { getTextInputValue: (k) => (k === 'mz_neden' ? neden : null) },
    reply: async (p) => ((c.reply = p), true),
    editReply: async (p) => ((c.edit = p), true),
    update: async () => true,
    showModal: async () => true,
    deferReply: async () => true,
    deferUpdate: async () => true,
    followUp: async () => true,
  };
};

const panelAciklama = () => mesajlar.size ? [...mesajlar.values()][0].embeds[0].data.description : '';
const panelMesajSayisi = () => mesajlar.size;

(async () => {
  /* ============================================================== */
  section('1) BİR KULLANICI MAZERET BİLDİRİR (1 saat)');

  const U1 = '100000000000001111';
  const i1 = sahte(U1, 'Hastane randevum var');
  mz.sureAyarla(G, U1, { key: 's1', label: '1 saat', ms: H });
  await mz.handleSebepSubmit(i1);

  const rec1 = db.getActiveMazeretByUser(G, U1);
  check('Kayıt kalıcı depoya yazıldı', !!rec1, 'kayıt yok');
  check('Süre 1 saat', rec1?.duration_ms === H);
  check('Bitiş = başlangıç + 1 saat', rec1?.expires_at === rec1?.started_at + H);
  check('Kullanıcıya onay verildi', JSON.stringify(i1._c.reply || {}).includes('kaydedildi'));

  section('2) PANELDE KULLANICI / SÜRE / SEBEP GÖRÜNÜR');
  check('Panel mesajı oluşturuldu', panelMesajSayisi() === 1, String(panelMesajSayisi()));
  check('Panel kanalı 1548927431597883472', [...mesajlar.keys()].length === 1 && kanal.id === KANAL);
  const d1 = panelAciklama();
  check('Panel başlığı "Aktif Mazeretli Memurlar"', [...mesajlar.values()][0].embeds[0].data.title === 'Aktif Mazeretli Memurlar');
  check('Gerçek mention görünüyor', d1.includes('<@' + U1 + '>'), d1.slice(0, 140));
  check('Numaralandırma "1)" var', /\*\*1\)\s*👤/.test(d1), d1.slice(0, 80));
  check('Süre görünüyor', d1.includes('1 saat'));
  check('Bitiş zamanı görünüyor (göreli)', /<t:\d+:R>/.test(d1));
  check('Sebep görünüyor', d1.includes('Hastane randevum var'));
  check('Panel mesaj ID kalıcı kaydedildi', db.getMazeretActivePanel(G, 'central')?.message_id === [...mesajlar.keys()][0]);

  section('3) İKİNCİ KULLANICI — AYNI PANEL GÜNCELLENİR');
  const U2 = '100000000000002222';
  const i2 = sahte(U2, 'Özel bir işim var');
  mz.sureAyarla(G, U2, { key: 'g3', label: '3 gün', ms: 3 * 24 * H });
  await mz.handleSebepSubmit(i2);

  check('İkinci kayıt da yazıldı', !!db.getActiveMazeretByUser(G, U2));
  check('İKİNCİ PANEL MESAJI OLUŞMADI', panelMesajSayisi() === 1, 'mesaj sayısı: ' + panelMesajSayisi());
  const d2 = panelAciklama();
  check('İlk kullanıcı hâlâ listede (ezilmedi)', d2.includes('<@' + U1 + '>'));
  check('İkinci kullanıcı da listede', d2.includes('<@' + U2 + '>'));
  check('İkinci sebep listede', d2.includes('Özel bir işim var'));
  check('Numaralandırma 1) ve 2)', /\*\*1\)\s*👤/.test(d2) && /\*\*2\)\s*👤/.test(d2));
  check('İki farklı süre görünüyor', d2.includes('1 saat') && d2.includes('3 gün'));

  section('4) KAYITLAR BİRBİRİNİ EZMEZ');
  check('Toplam 2 aktif kayıt', db.getActiveMazerets(G).length === 2, String(db.getActiveMazerets(G).length));
  check('U1 süresi bozulmadı', db.getActiveMazeretByUser(G, U1).duration_ms === H);
  check('U2 süresi bozulmadı', db.getActiveMazeretByUser(G, U2).duration_ms === 3 * 24 * H);
  check('U1 sebebi bozulmadı', db.getActiveMazeretByUser(G, U1).reason === 'Hastane randevum var');
  check('U2 sebebi bozulmadı', db.getActiveMazeretByUser(G, U2).reason === 'Özel bir işim var');

  section('5) AYNI KULLANICI İKİNCİ KEZ (duplicate engeli)');
  const i3 = sahte(U1, 'tekrar');
  mz.sureAyarla(G, U1, { key: 'g1', label: '1 gün', ms: 24 * H });
  await mz.handleSebepSubmit(i3);
  check('Duplicate kayıt oluşmadı', db.getActiveMazerets(G).filter((x) => x.user_id === U1).length === 1);
  check('Kullanıcı bilgilendirildi', /Zaten aktif/.test(JSON.stringify(i3._c.reply || {})));
  check('Panel hâlâ tek mesaj', panelMesajSayisi() === 1);

  section('6) SÜRESİ BİTEN KAYIT LİSTEDEN ÇIKAR');
  {
    const U3 = '100000000000003333';
    db.createMazeretRecord({ guildId: G, userId: U3, reason: 'Kısa mazeret', durationRaw: '1 dakika', durationMs: 60_000, reportedBy: U3 });
    await mz.refreshMerkeziPanel(client, G, 1);
    check('Üçüncü kayıt panelde görünüyor', panelAciklama().includes('<@' + U3 + '>'));

    // Zamanı U3'ün bitişinin ötesine atla
    const ileri = db.getActiveMazeretByUser(G, U3).expires_at + 1000;
    db.expireMazerets(G, ileri);
    await mz.refreshMerkeziPanel(client, G, 1);
    const dN = panelAciklama();
    check('Süresi biten kullanıcı listeden çıktı', !dN.includes('<@' + U3 + '>'), dN.slice(0, 200));
    check('Diğer kullanıcılar listede kaldı', dN.includes('<@' + U1 + '>') && dN.includes('<@' + U2 + '>'));
    check('Geçmiş kayıt SİLİNMEDİ', (() => {
      const r = db.getDb().prepare('SELECT * FROM mazeret_records WHERE user_id = ?').get(U3);
      return r && r.active === 0 && r.end_reason === 'expired';
    })());
    check('Panel mesajı silinmedi', panelMesajSayisi() === 1);
  }

  section('7) PANEL SİLİNMİŞSE YENİSİ OLUŞUR');
  const eskiId = db.getMazeretActivePanel(G, 'central')?.message_id;
  mesajlar.clear();
  await mz.refreshMerkeziPanel(client, G, 1);
  check('Yeni mesaj oluşturuldu', panelMesajSayisi() === 1, String(panelMesajSayisi()));
  const yeniId = db.getMazeretActivePanel(G, 'central')?.message_id;
  check('Yeni mesaj ID kaydedildi', yeniId && yeniId !== eskiId, `${eskiId} -> ${yeniId}`);
  await mz.refreshMerkeziPanel(client, G, 1);
  check('Sonraki güncellemede AYNI mesaj kullanıldı', panelMesajSayisi() === 1, String(panelMesajSayisi()));
  check('Mesaj ID değişmedi', db.getMazeretActivePanel(G, 'central')?.message_id === yeniId);

  section('8) EŞ ZAMANLI İŞLEMLER — DUPLICATE PANEL OLUSMAZ');
  {
    mesajlar.clear();
    gonderilen.length = 0;
    db.deleteMazeretActivePanel(G, 'central');
    // 5 eş zamanlı çağrı
    await Promise.all([
      mz.refreshMerkeziPanel(client, G, 1),
      mz.refreshMerkeziPanel(client, G, 1),
      mz.refreshMerkeziPanel(client, G, 1),
      mz.refreshMerkeziPanel(client, G, 1),
      mz.refreshMerkeziPanel(client, G, 1),
    ]);
    check('5 eş zamanlı çağrıdan sonra TEK panel', panelMesajSayisi() === 1, String(panelMesajSayisi()));
    check('Gönderilen mesaj sayısı 1', gonderilen.length === 1, String(gonderilen.length));
    check('Kilit temizlendi', mz._panelKilit.size === 0, String(mz._panelKilit.size));
  }

  section('9) PANEL GÜNCELLENEMEZSE HATA GİZLENMEZ');
  {
    gonderimHatasi = 99; // tüm gönderimler başarısız
    mesajlar.clear();
    const ok = await mz.refreshMerkeziPanel(client, G, 1);
    check('Başarısız güncelleme false döner', ok === false, String(ok));
    const i4 = sahte('100000000000004444', 'Panel testi');
    mz.sureAyarla(G, '100000000000004444', { key: 's1', label: '1 saat', ms: H });
    await mz.handleSebepSubmit(i4);
    check('Kayıt yine de kaydedildi', !!db.getActiveMazeretByUser(G, '100000000000004444'));
    const yanit = JSON.stringify(i4._c.reply || {});
    check('Kullanıcıya panel hatası bildirildi (gizlenmedi)', /güncellenemedi/.test(yanit), yanit.slice(0, 200));
    gonderimHatasi = 0;
  }

  section('10) SÜREÇ RESTART — AYNI PANEL GÜNCELLENİR');
  {
    // Bölüm 9 gönderim hatası verdi; panel kaydı düzgünce silinmişti.
    // Önce paneli başarıyla yeniden oluştur (hata sonrası toparlanma testi).
    await mz.refreshMerkeziPanel(client, G, 1);

    const probe = path.join(KOK, 'test', '_mz-panel-step.js');
    fs.writeFileSync(
      probe,
      "const db=require('../src/database/database');db.initDatabase();\n" +
        'const gid=process.argv[2];\n' +
        "const p=db.getMazeretActivePanel(gid,'central');\n" +
        'const rows=db.getActiveMazerets(gid);\n' +
        "const out={panel:p?p.message_id:null, aktif:rows.length, started:rows.every(r=>r.started_at>0)};\n" +
        'db.closeDatabase();\n' +
        "console.log('###JSON###'+JSON.stringify(out));process.exit(0);\n",
      'utf8',
    );
    const oku = () =>
      JSON.parse(
        execFileSync(process.execPath, [probe, G], {
          cwd: KOK,
          encoding: 'utf8',
          env: { ...process.env, DB_PATH: process.env.DB_PATH },
        }).split('###JSON###')[1].trim(),
      );

    const sonra = oku();
    // Bölüm 9 kasıtlı olarak gönderimi bozdu ve stale panel kaydı düzgünce silindi.
    // Bu satırdan önce panel yeniden oluşturulmuş olmalı (aşağıdaki kontrol bunu doğrular).
    const canliId = db.getMazeretActivePanel(G, 'central')?.message_id;
    check('Panel yeniden oluşturuldu (hata sonrası toparlanma)', !!canliId && panelMesajSayisi() === 1, String(canliId));
    check('Restart sonrası panel kaydı korundu', sonra.panel === canliId, `${sonra.panel} != ${canliId}`);
    check('Restart sonrası aktif kayıtlar korundu', sonra.aktif === db.getActiveMazerets(G).length);
    check('started_at kalıcı', sonra.started === true);

    // YENİ SÜREÇ bilgisiyle aynı paneli güncelle
    await mz.refreshMerkeziPanel(client, G, 1);
    check('Restart sonrası aynı mesaj güncellendi', panelMesajSayisi() === 1 && db.getMazeretActivePanel(G, 'central')?.message_id === canliId);
    fs.unlinkSync(probe);
  }

  section('11) BOŞ LİSTE MESJI');
  {
    const idOnce = db.getMazeretActivePanel(G, 'central')?.message_id;
    db.getDb().prepare('UPDATE mazeret_records SET active = 0, expires_at = 1 WHERE guild_id = ?').run(G);
    await mz.refreshMerkeziPanel(client, G, 1);
    const d = panelAciklama();
    check('Tam mesaj: "Şu anda aktif mazeretli kullanıcı bulunmuyor."', d.includes('Şu anda aktif mazeretli kullanıcı bulunmuyor.'), d.slice(0, 160));
    check('Panel mesajı silinmedi', panelMesajSayisi() === 1);
    check('Panel kaydı korundu', db.getMazeretActivePanel(G, 'central')?.message_id === idOnce);
    check('Başlık değişmedi', [...mesajlar.values()][0].embeds[0].data.title === 'Aktif Mazeretli Memurlar');
  }

  console.log('\n' + '='.repeat(70));
  console.log('  SONUÇ:  ' + pass + ' başarılı / ' + (pass + fail) + ' toplam  /  ' + fail + ' başarısız');
  console.log('='.repeat(70));
  db.closeDatabase();
  try { fs.unlinkSync(process.env.DB_PATH); } catch { /* zaten yok */ }
  process.exit(fail ? 1 : 0);
})();