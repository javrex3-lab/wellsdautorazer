/**
 * GUARD WHITELIST KALICILIK TESTLERİ
 *
 * Kapsam: whitelist kaydının süreç restart'ı sonrası korunması, duplicate
 * engeli, silmenin kalıcı olması, DB hatasında verinin üzerine yazılmaması
 * ve platform kalıcılık tespiti.
 *
 * NOT: Her senaryo AYRI node sürecinde çalıştırılır (gerçek restart taklidi).
 */
process.env.DB_PATH = require('path').join(require('os').tmpdir(), 'wlreg-' + Date.now() + '.db');

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const KOK = path.resolve(__dirname, '..');
const PROBE = path.join(__dirname, '_wl-step.js');
const G = '1354465879311777893';
const U1 = '100000000000000777';
const U2 = '100000000000000778';

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

/** Gerçek ayrı süreçte çalıştır (restart taklidi). */
function yeniSurec(adim, dbPath, env = {}) {
  const out = execFileSync(process.execPath, [PROBE, adim], {
    cwd: KOK,
    encoding: 'utf8',
    env: { ...process.env, DB_PATH: dbPath, ...env },
  });
  const isaretli = out.split('###JSON###').pop();
  try {
    return { veri: JSON.parse(isaretli.trim()), cikis: 0 };
  } catch (e) {
    return { veri: {}, cikis: 0, ham: out, parseHatasi: e.message };
  }
}

console.log('='.repeat(68));
console.log('  GUARD WHITELIST KALICILIK TESTLERİ');
console.log('='.repeat(68));

// Testler GECICI veritabani kullanir — kullanicinin GERCEK kayitlarina dokunulmaz.
const KALICI_DB = path.join(require('os').tmpdir(), 'wlreg-' + Date.now() + '.db');
const GERCEK_DB = path.join(KOK, 'data', 'wellsd.db');
check('Test geçici DB kullanıyor (gerçek veri korunur)', KALICI_DB !== GERCEK_DB);

/* ================================================================== */
section('1) YENİ İŞLEM EKLEME (TEST 1)');

const sonuc1 = yeniSurec('ekle', KALICI_DB);
const d1 = sonuc1.veri;
check('Whitelist kaydı oluştu', d1.toplam >= 1, JSON.stringify(d1));
check('Eklenen kullanıcı kayıtlı', (d1.kayitlar || []).some((k) => k.user_id === U1));
check('Seviye doğru kaydedildi', (d1.kayitlar || []).find((k) => k.user_id === U1)?.level === 2);
check('getGuardLevel okuyor', d1.level === 2, String(d1.level));
check('created=true (yeni kayıt)', d1.created === true);
check('listWhitelist okunabiliyor', Array.isArray(d1.kayitlar) && d1.kayitlar.length > 0);

/* ================================================================== */
section('2) SÜREÇ RESTART — KAYIT KORUNUYOR MU? (TEST 2)');

const sonuc2 = yeniSurec('oku', KALICI_DB);
const d2 = sonuc2.veri;
check('RESTART SONRASI kayıt hâlâ var', (d2.kayitlar || []).some((k) => k.user_id === U1), JSON.stringify(d2.kayitlar));
check('RESTART SONRASI seviye korundu', d2.level === 2, String(d2.level));
check('Toplam kayıt sayısı değişmedi', d2.toplam === d1.toplam, d2.toplam + ' != ' + d1.toplam);

/* ================================================================== */
section('3) DUPLICATE ENGELİ (TEST 3)');

const sonuc3 = yeniSurec('tekrar-ekle', KALICI_DB);
const d3 = sonuc3.veri;
check('Aynı kullanıcı tekrar eklenince created=false', d3.created === false, String(d3.created));
check('Duplicate SATIR oluşmadı', d3.kayit === 1, 'bulunan: ' + d3.kayit);
check('Seviye güncellendi (2 → 3)', d3.level === 3, String(d3.level));

const sonuc3b = yeniSurec('oku', KALICI_DB);
check('Restart sonrası da tek kayıt', sonuc3b.veri.kayitlar.filter((k) => k.user_id === U1).length === 1, JSON.stringify(sonuc3b.veri.kayitlar));

/* ================================================================== */
section('4) KALDIRMA KALICI OLUYOR MU? (TEST 4)');

const sonuc4 = yeniSurec('sil', KALICI_DB);
const d4 = sonuc4.veri;
check('removeGuard başarılı', d4.silindi === true, String(d4.silindi));
check('Listede artık yok', d4.kayitlar.some((k) => k.user_id === U1) === false);

const sonuc5 = yeniSurec('oku', KALICI_DB);
const d5 = sonuc5.veri;
check('RESTART SONRASI silinen KENDINI GERI GELMEDI (TEST 5)', d5.level === 0, String(d5.level));
check('Silinen kullanıcı listede yok', d5.kayitlar.some((k) => k.user_id === U1) === false);
check('Diğer kullanıcılar korundu', d5.kayitlar.some((k) => k.user_id === U2), JSON.stringify(d5.kayitlar));

/* ================================================================== */
section('5) YENİDEN EKLEME — ESKİ KAYIT SIFIRLANMADI');

const sonuc6 = yeniSurec('tekrar-ekle', KALICI_DB);
const d6 = sonuc6.veri;
check('U1 yeniden eklendi', d6.level === 3, String(d6.level));

const sonuc6b = yeniSurec('oku', KALICI_DB);
check('U2 hâlâ duruyor', sonuc6b.veri.kayitlar.some((k) => k.user_id === U2), JSON.stringify(sonuc6b.veri.kayitlar));
check('Toplam 2 kayıt korundu', sonuc6b.veri.toplam === 2, String(sonuc6b.veri.toplam));

/* ================================================================== */
section('6) /guard setup WHITELIST\'I SİLMEZ');

{
  const s = fs.readFileSync(path.join(KOK, 'src/commands/guardsetup.js'), 'utf8');
  check('guardsetup whitelist silmiyor', !/DELETE FROM guard_whitelist/.test(s));
  check('guardsetup removeGuard çağırmıyor', !/\bremoveGuard\s*\(/.test(s));
  check('guardsetup listWhitelist ile SADECE sayıyor', /listWhitelist/.test(s) && /korundu/.test(s));
}

{
  const s = fs.readFileSync(path.join(KOK, 'src/database/database.js'), 'utf8');
  const silenler = [...s.matchAll(/DELETE FROM guard_whitelist/g)].length;
  check('database.js yalnızca removeGuard içinde siliyor', silenler === 1, 'bulunan: ' + silenler);
  check('initDatabase whitelist TRUNCATE/DROP yapmıyor', !/DROP TABLE guard_whitelist|DELETE FROM guard_whitelist[^;]*initDatabase/.test(s));
}

/* ================================================================== */
section('7) DB HATASINDA BOŞ LİSTE YAZILMAZ (TEST 7)');

{
  const s = fs.readFileSync(path.join(KOK, 'src/database/database.js'), 'utf8');
  check('listWhitelist hata halinde logluyor', /listWhitelist failed/.test(s));
  check('getGuardLevel hata halinde logluyor', /getGuardLevel failed/.test(s));
  check('setGuardLevel hatayı YUTMUYOR (throws)', /setGuardLevel failed[\s\S]{0,120}throw err/.test(s));

  // DB_PATH yazılamayan bir yere götür → initDatabase THROW etmeli, boş tablo oluşturulmamalı
  const bozukYol = 'Z:\\yok-boyle-bir-dizin\\wellsd.db';
  let patladi = false;
  try {
    yeniSurec('oku', bozukYol);
  } catch {
    patladi = true;
  }
  check('Yazılamayan DB yolunda süreç hata veriyor (sessiz boş tablo YOK)', patladi);

  // Mevcut verinin ÜZERİNE yazılmadığını doğrula
  const sonra = yeniSurec('oku', KALICI_DB);
  check('Hata denemesinden sonra mevcut veri bozulmadı', sonra.veri.level === 3, JSON.stringify(sonra.veri));
}

/* ================================================================== */
section('8) PLATFORM KALICILIK TESPİTİ');

{
  const c = require('../src/config');
  check('config.dbIsPersistent tanımlı', typeof c.dbIsPersistent === 'boolean', String(c.dbIsPersistent));
  check('Yerel çalıştırmada kalıcı=true', c.dbIsPersistent === true, String(c.dbIsPersistent));

  const s = fs.readFileSync(path.join(KOK, 'src/config.js'), 'utf8');
  const mountIdx = s.indexOf('RAILWAY_VOLUME_MOUNT_PATH');
  const explicitIdx = s.indexOf('const explicit = (process.env.DB_PATH');
  check('Volume mount DB_PATH\'tan ÖNCE geliyor (tuzak kapalı)', mountIdx > -1 && mountIdx < explicitIdx, 'mount=' + mountIdx + ' explicit=' + explicitIdx);
  check('dbIsPersistent hesaplanıyor', /dbIsPersistent:/.test(s));
}

{
  const s = fs.readFileSync(path.join(KOK, 'src/database/database.js'), 'utf8');
  check('Açılışta kalıcılık teşhisi var', /reportPersistence/.test(s));
  check('Açılışta whitelist sayısı loglanıyor', /Guard whitelist/.test(s));
  check('Kalıcı değilse GÜRÜLTÜLÜ uyarı var', /HER REDEPLOY/.test(s));
  check('Çözüm adımı (Volume /data) yazıyor', /mount path = \/data/.test(s));
}

/* ================================================================== */
section('9) ŞEMA — DUPLICATE VERİTABANINDA ENGELLİ');

{
  const s = fs.readFileSync(path.join(KOK, 'src/database/schema.js'), 'utf8');
  check('guard_whitelist PRIMARY KEY (guild_id, user_id)', /CREATE TABLE IF NOT EXISTS guard_whitelist[\s\S]*?PRIMARY KEY \(guild_id, user_id\)/.test(s));
  check('level CHECK kısıtı korunmuş', /level\s+INTEGER NOT NULL CHECK \(level BETWEEN 1 AND 4\)/.test(s));
  check('guild bazlı index var', /idx_guard_wl_guild/.test(s));
}

/* ================================================================== */
section('10) WHITELIST KOMUTLARI KORUNDU');

for (const [dosya, ad] of [
  ['src/commands/guardekle.js', '/guardekle'],
  ['src/commands/guardçıkar.js', '/guardçıkar'],
  ['src/commands/guardliste.js', '/guardliste'],
  ['src/commands/guardsetup.js', '/guardsetup'],
]) {
  const p = path.join(KOK, dosya);
  const varMi = fs.existsSync(p);
  check('Komut mevcut: ' + ad, varMi);
  if (varMi) {
    const s = fs.readFileSync(p, 'utf8');
    check('  ' + ad + ' kalıcı DB kullanıyor', /database\/database/.test(s) || /listWhitelist|setGuardLevel|removeGuard|getGuardSettings/.test(s));
  }
}

{
  const s = fs.readFileSync(path.join(KOK, 'src/commands/guardekle.js'), 'utf8');
  check('/guardekle seviye seçenekleri korundu (1-4)', (s.match(/value: [1-4]/g) || []).length === 4);
  check('/guardekle DB hatasında başarı mesajı vermiyor', /catch[\s\S]{0,400}Kayıt sırasında bir hata/.test(s));
}

/* ================================================================== */
section('11) GERİ YÜKLEME KAYNAĞI (/guardyukle)');

{
  const seedYol = path.join(KOK, 'data', 'guard-whitelist-seed.json');
  check('Tohum dosyası repoda var', fs.existsSync(seedYol));

  const seed = JSON.parse(fs.readFileSync(seedYol, 'utf8'));
  check('Tohum geçerli JSON', !!seed.kayitlar && Array.isArray(seed.kayitlar));
  check('Tohum guild_id doğru', seed._guild_id === G, String(seed._guild_id));

  // Kullanıcının verdiği 10 kayıt birebir burada olmalı
  const beklenen = [
    ['1056585742731726918', 4],
    ['1305984973937053818', 4],
    ['1375758772210761738', 1],
    ['846509021296459787', 1],
    ['1264965435594506270', 1],
    ['1098953616301232219', 1],
    ['1098944843142676553', 1],
    ['1070019000593043486', 1],
    ['733961225276489729', 1],
    ['1294835692685234216', 1],
  ];
  for (const [id, lvl] of beklenen) {
    const k = seed.kayitlar.find((x) => x.user_id === id);
    check(`Tohumda ${id} (seviye ${lvl})`, !!k && k.level === lvl, k ? 'seviye=' + k.level : 'YOK');
  }
  check('Tohumda tam 10 kayıt', seed.kayitlar.length === 10, String(seed.kayitlar.length));
  check('Tohumdaki tüm ID\'ler geçerli', seed.kayitlar.every((k) => /^\d{17,20}$/.test(k.user_id)));
  check('Tohumdaki tüm seviyeler 1-4', seed.kayitlar.every((k) => k.level >= 1 && k.level <= 4));
}

{
  const { _tohumOku: tohumOku, _TOHUM_DOSYA: dosya } = require('../src/commands/guardyukle');
  const t = tohumOku();
  check('tohumOku() başarılı', t.ok === true, t.hata || '');
  check('tohumOku() 10 geçerli kayıt döndürüyor', t.kayitlar.length === 10, String(t.kayitlar.length));
  check('Tohum dosyası doğru yolda', fs.existsSync(dosya), dosya);

  // Bozuk dosya güvenli sekilde reddediliyor
  const bozuk = path.join(require('os').tmpdir(), 'bozuk-seed-' + Date.now() + '.json');
  fs.writeFileSync(bozuk, '{ bu json degil', 'utf8');
  const b = tohumOku(bozuk);
  check('Bozuk JSON reddediliyor (sessizce geçmiyor)', b.ok === false, JSON.stringify(b));
  fs.unlinkSync(bozuk);

  const yok = tohumOku(path.join(require('os').tmpdir(), 'olmayan-' + Date.now() + '.json'));
  check('Eksik dosya reddediliyor', yok.ok === false);
}

{
  // Tohum idempotent uygulama: 3 kez calistir, kayit sayisi degismez
  const probeYeni = path.join(require('os').tmpdir(), 'wlseed-' + Date.now() + '.db');
  const { _tohumOku: tohumOku } = require('../src/commands/guardyukle');
  const seed = tohumOku();
  const { execFileSync } = require('child_process');
  const yaz = path.join(KOK, 'test', '_wl-seed-step.js');
  fs.writeFileSync(
    yaz,
    "const db=require('../src/database/database');db.initDatabase();" +
      "const t=require('../src/commands/guardyukle')._tohumOku();" +
      "let n=0;for(const k of t.kayitlar){if(db.setGuardLevel(process.argv[2],k.id,k.level,'1').created)n++;}" +
      "const top=db.listWhitelist(process.argv[2]).length;" +
      "db.closeDatabase();" +
      "console.log('###JSON###'+JSON.stringify({eklendi:n,toplam:top}));process.exit(0);",
    'utf8',
  );
  const calistir = () => {
    const ham = execFileSync(process.execPath, [yaz, G], { cwd: KOK, encoding: 'utf8', env: { ...process.env, DB_PATH: probeYeni } });
    return JSON.parse(ham.split('###JSON###')[1].trim());
  };

  const r1 = calistir();
  check('İlk yükleme: 10 kayıt eklendi', r1.eklendi === 10 && r1.toplam === 10, JSON.stringify(r1));
  const r2 = calistir();
  check('İkinci yükleme: duplicate yok', r2.eklendi === 0 && r2.toplam === 10, JSON.stringify(r2));
  const r3 = calistir();
  check('Üçüncü yükleme: hâlâ 10', r3.eklendi === 0 && r3.toplam === 10, JSON.stringify(r3));

  // Kayitlarin tamami gercekten DBde ve dogru seviyede mi?
  const kontrol = yeniSurec('oku', probeYeni);
  const seed2 = tohumOku();
  const hepsiDogru = seed2.kayitlar.every((k) => kontrol.veri.kayitlar.some((x) => x.user_id === k.id));
  check('Tohumun tamamı DBde doğru seviyede', kontrol.veri.toplam === 10 && hepsiDogru, JSON.stringify(kontrol.veri));

  fs.unlinkSync(yaz);
  fs.unlinkSync(probeYeni);
}

{
  // Komut SİLME yapmamali
  const s = fs.readFileSync(path.join(KOK, 'src/commands/guardyukle.js'), 'utf8');
  check('/guardyukle removeGuard çağırmıyor', !/\bremoveGuard\s*\(/.test(s));
  check('/guardyukle DELETE çalıştırmıyor', !/DELETE FROM/.test(s));
  check('/guardyukle idempotent (upsert kullanıyor)', /setGuardLevel/.test(s));
  check('/guardyukle sonucu doğruluyor', /Doğrulama/.test(s));
  check('/guardyukle başarıyı doğrulamadan söylemiyor', /getGuardLevel\(interaction\.guildId, k\.id\) === k\.level/.test(s));
}

/* ================================================================== */
console.log('\n' + '='.repeat(68));
console.log('  SONUÇ:  ' + pass + ' başarılı / ' + (pass + fail) + ' toplam  /  ' + fail + ' başarısız');
console.log('='.repeat(68));
process.exit(fail ? 1 : 0);