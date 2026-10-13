/** mazeretliler.test.js — /mazeretliler komutu ve referans format testleri. */
process.env.DB_PATH = require('path').join(require('os').tmpdir(), 'mzl-' + Date.now() + '.db');

const fs = require('fs');
const path = require('path');
const db = require('../src/database/database');
const mz = require('../src/handlers/mazeret');
const views = require('../src/utils/mazeretViews');
const komut = require('../src/commands/mazeretliler');

const KOK = path.resolve(__dirname, '..');
const G = '1354465879311777893';
const KANAL = '1548927431597883472';
const H = 3600_000;
const GUN = 24 * H;

let pass = 0,
  fail = 0;
const check = (n, c, e = '') => {
  if (c) {
    pass++;
    console.log('  OK   ' + n);
  } else {
    fail++;
    console.log('  FAIL ' + n + (e ? '  -> ' + e : ''));
  }
};
const section = (t) => console.log('\n' + '-'.repeat(4) + ' ' + t);

console.log('='.repeat(68));
console.log('  /MAZERETLILER KOMUTU — TESTLER');
console.log('='.repeat(68));
db.initDatabase();

/* ================================================================== */
section('1) KOMUT TANIMI');

check('Dosya mevcut', fs.existsSync(path.join(KOK, 'src/commands/mazeretliler.js')));
check('Komut adı /mazeretliler', komut.data.name === 'mazeretliler', komut.data.name);
check('execute fonksiyonu var', typeof komut.execute === 'function');
check('HERKES kullanabilir (openToEveryone)', komut.openToEveryone === true, String(komut.openToEveryone));
check('Yetkili kapısı YOK (herkes)', komut.openToRoleManagers !== true, String(komut.openToRoleManagers));
{
  const s = fs.readFileSync(path.join(KOK, 'src/commands/mazeretliler.js'), 'utf8');
  check('Yetki engeli YOK (herkes çalıştırabilir)', !/canManageTickets/.test(s));
  check('Süresi dolmuşları kapatıyor', /expireMazerets\(interaction\.guildId\)/.test(s));
  check('Yalnızca aktifleri okuyor', /getActiveMazerets\(interaction\.guildId\)/.test(s));
  check('Merkezi paneli tazeliyor', /refreshMerkeziPanel/.test(s));
  check('Ephemeral DEĞİL (herkes görsün)', !/MessageFlags\.Ephemeral/.test(s));
  check('Kanala mesaj göndermiyor (spam yok)', !/interaction\.channel\.send/.test(s));
  check('Referans görünümü kullanıyor', /buildMazeretliListesiEmbed/.test(s));
}

/* ================================================================== */
section('2) REFERANS FORMATI (fotoğraftaki düzen)');

{
  const simdi = Date.now();
  const k = [
    { user_id: '111111111111111111', duration_ms: 3 * GUN, expires_at: simdi + 3 * GUN, reason: 'Dışarıdaym' },
    { user_id: '222222222222222222', duration_ms: H, expires_at: simdi + H, reason: 'reise ameliyat öncesi kontrol' },
  ];
  const p = views.buildMazeretliListesiEmbed(k, { now: simdi });
  const d = p.embed.data.description;

  check('Başlık "Aktif Mazeretli Memurlar"', p.embed.data.title === 'Aktif Mazeretli Memurlar', p.embed.data.title);
  check(
    'Açıklama (referans metni)',
    d.includes('Aşağıda departman bünyesinde anlık olarak mazereti (izinli) sayılan memurları görebilirsiniz.'),
    d.slice(0, 90),
  );
  check('Numaralandırma 1) ve 2)', /\*\*1\)/.test(d) && /\*\*2\)/.test(d));
  check('Ok emoji ⬇️', d.includes('⬇️'));
  check('Gerçek mention 1', d.includes('<@111111111111111111>'));
  check('Gerçek mention 2', d.includes('<@222222222222222222>'));
  check('Süre etiketi', (d.match(/\*\*Süre:\*\*/g) || []).length === 2);
  check('Sebep etiketi', (d.match(/\*\*Sebep:\*\*/g) || []).length === 2);
  check('Bitiş etiketi', (d.match(/\*\*Bitiş:\*\*/g) || []).length === 2);
  check('↳ işaretleri kullanılıyor', (d.match(/↳/g) || []).length === 4);
  check('Süreler doğru (3 gün / 1 saat)', d.includes('3 gün') && d.includes('1 saat'));
  check('Sebepler görünüyor', d.includes('Dışarıdaym') && d.includes('reise ameliyat'));
  check('Bitiş göreli zaman damgası', /<t:\d+:R>/.test(d));
  check('Footer aktif sayısı', p.embed.data.footer.text.includes('Aktif: 2 kişi'), p.embed.data.footer.text);
  check('4096 sınırı içinde', d.length <= 4096, String(d.length));

  const bos = views.buildMazeretliListesiEmbed([], { now: simdi });
  check('Boş liste mesajı', bos.embed.data.description.includes('Şu anda aktif mazeretli kullanıcı bulunmuyor.'));
  check('Boş listede başlık korunur', bos.embed.data.title === 'Aktif Mazeretli Memurlar');

  // Güvenlik: mention PING yok
  const kotu = [
    { user_id: '333333333333333333', duration_ms: GUN, expires_at: simdi + GUN, reason: '<@&1522773972393922730> @everyone <@111> ping' },
  ];
  const g = views.buildMazeretliListesiEmbed(kotu, { now: simdi });
  const gd = g.embed.data.description;
  check('Sebepteki rol mention temizlendi', !gd.includes('<@&'));
  check('Sebepteki @everyone temizlendi', !/@everyone/i.test(gd));
  check('Sebepteki kullanıcı mention temizlendi', (gd.match(/<@\d+>/g) || []).length === 1, (gd.match(/<@\d+>/g) || []).join(','));

  // Sayfalama: çok kayıt
  const cok = Array.from({ length: 70 }, (_, i) => ({
    user_id: '10000000000000' + String(i).padStart(4, '0'),
    duration_ms: GUN,
    expires_at: simdi + GUN,
    reason: 'sebep ' + i,
  }));
  const pc = views.buildMazeretliListesiEmbed(cok, { now: simdi });
  check('70 kayıt → sayfalama var', pc.toplamSayfa > 1, String(pc.toplamSayfa));
  check('Her sayfa 4096 içinde', pc.embed.data.description.length <= 4096);
  check('Footer sayfa bilgisi gösteriyor', pc.embed.data.footer.text.includes('Sayfa 1/'), pc.embed.data.footer.text);
}

/* ================================================================== */
section('3) KOMUT ÇALIŞTIRMA (sahte Discord)');

(async () => {
  const gonderilen = [];
  const mesajlar = new Map();
  let sayac = 0;
  const kanal = {
    id: KANAL,
    guildId: G,
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async (p) => {
      const m = { id: 'MSG' + ++sayac, ...p, edit: async (q) => Object.assign(m, q) };
      gonderilen.push(p);
      mesajlar.set(m.id, m);
      return m;
    },
    messages: { fetch: async (id) => mesajlar.get(id) || Promise.reject(Object.assign(new Error('yok'), { code: 10008 })) },
  };
  const guild = { id: G, members: { me: { permissions: { has: () => true } } } };
  const client = { channels: { fetch: async (id) => (id === KANAL ? kanal : null) }, guilds: { cache: new Map([[G, guild]]) } };

  const etkilesim = (o = {}) => {
    const c = { reply: null, edit: null };
    return {
      _c: c,
      guildId: G,
      guild,
      client,
      user: { id: o.userId || '1056585742731726918', tag: 'd27q#0001' },
      member: { id: o.userId || '1056585742731726918', permissions: { has: () => !!o.staff } },
      replied: false,
      deferred: false,
      isRepliable: () => true,
      reply: async (p) => ((c.reply = p), true),
      editReply: async (p) => ((c.edit = p), true),
      followUp: async () => true,
    };
  };

  // HERKES kullanabilmeli (yetki engeli olmamalı)
  {
    const i = etkilesim({ staff: false });
    await komut.execute(i);
    check('Yetkisiz kullanıcı da komutu kullanabiliyor', i._c.reply !== null);
    check('Yanıt herkese açık (ephemeral DEĞİL)', i._c.reply?.flags !== 64, String(i._c.reply?.flags));
    check('Yetki hatası verilmedi', !JSON.stringify(i._c.reply || {}).includes('yalnızca yetkililer'));
    check('Başlık doğru', JSON.stringify(i._c.reply || {}).includes('Aktif Mazeretli Memurlar'));
  }

  // Yetkili, kayıt yokken
  {
    const i = etkilesim({ staff: true });
    await komut.execute(i);
    const y = JSON.stringify(i._c.reply || {});
    check('Komut çalışıyor', i._c.reply !== null);
    check('Yanıt herkese açık (ephemeral DEĞİL)', i._c.reply?.flags !== 64, String(i._c.reply?.flags));
    check('Başlık doğru', y.includes('Aktif Mazeretli Memurlar'));
    check('Boş mesaj gösteriliyor', y.includes('bulunmuyor'));
  }

  // Kayıt ekle → listede görünmeli
  const U1 = '100000000000007777';
  const U2 = '100000000000008888';
  db.createMazeretRecord({ guildId: G, userId: U1, reason: 'Dışarıdaym', durationRaw: '3 gün', durationMs: 3 * GUN, reportedBy: U1 });
  db.createMazeretRecord({ guildId: G, userId: U2, reason: 'Hastane randevum var', durationRaw: '1 saat', durationMs: H, reportedBy: U2 });

  {
    const i = etkilesim({ staff: true });
    await komut.execute(i);
    const d = i._c.reply?.embeds?.[0]?.data?.description || '';
    check('Aktif kullanıcı 1 listede', d.includes('<@' + U1 + '>'));
    check('Aktif kullanıcı 2 listede', d.includes('<@' + U2 + '>'));
    check('Numaralandırma var', /\*\*1\)/.test(d) && /\*\*2\)/.test(d));
    check('Süreler görünüyor', d.includes('3 gün') && d.includes('1 saat'));
    check('Sebep görünüyor', d.includes('Dışarıdaym') && d.includes('Hastane randevum var'));
    check('Merkezi panel tazelendi', mesajlar.size === 1, String(mesajlar.size));
    check('Merkezi panel kaydı var', !!db.getMazeretActivePanel(G, 'central'));
    const md = [...mesajlar.values()][0].embeds[0].data.description;
    check('Merkezi panelde de kullanıcılar var', md.includes('<@' + U1 + '>') && md.includes('<@' + U2 + '>'));
  }

  // Süresi biten kayıt listeden çıkmalı
  {
    db.getDb().prepare('UPDATE mazeret_records SET active = 0, expires_at = 1 WHERE user_id = ?').run(U2);
    const i = etkilesim({ staff: true });
    await komut.execute(i);
    const d = i._c.reply?.embeds?.[0]?.data?.description || '';
    check('Süresi biten listeden çıktı', !d.includes('<@' + U2 + '>'), d.slice(0, 160));
    check('Kalan kullanıcı hâlâ listede', d.includes('<@' + U1 + '>'));
  }

  // Tekrar çalıştırınca yeni kanal mesajı OLUŞMAMALI
  {
    const onceki = mesajlar.size;
    const i = etkilesim({ staff: true });
    await komut.execute(i);
    check('Tekrar çalıştırmada merkezi mesaj artmadı', mesajlar.size === onceki, `${onceki} -> ${mesajlar.size}`);
  }

  console.log('\n' + '='.repeat(68));
  console.log('  SONUÇ:  ' + pass + ' başarılı / ' + (pass + fail) + ' toplam  /  ' + fail + ' başarısız');
  console.log('='.repeat(68));
  db.closeDatabase();
  try { fs.unlinkSync(process.env.DB_PATH); } catch { /* yok */ }
  process.exit(fail ? 1 : 0);
})();