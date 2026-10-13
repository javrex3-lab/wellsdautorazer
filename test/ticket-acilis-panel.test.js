/**
 * test/ticket-acilis-panel.test.js
 *
 * AÇILAN ticket panelinin yeni düzeni (örnek görsele birebir) ve butonların
 * yetki ayrımı.
 *
 * Gerçek kod çalıştırılır. Discord bağlantısı YOKTUR; sunucu, kanal ve
 * etkileşim nesneleri sahtedir, DB geçici dosyaya yazılır.
 *
 * Kapsam: yalnızca açılan ticket paneli.
 */
process.env.DB_PATH = require('path').join(require('os').tmpdir(), 'tkacilis-' + Date.now() + '.db');

const fs = require('fs');
const path = require('path');
const db = require('../src/database/database');
const views = require('../src/utils/ticketViews');
const tickets = require('../src/handlers/tickets');

const KOK = path.resolve(__dirname, '..');

const G = '1354465879311777893';
const G2 = '999999999999999999';
const CATEGORY = '1522774034323079329';
const BOT = '1559192913009713222';
const USTA = '100000000000000001';
const STAFF = '1056585742731726918';
const YETKI = '1522773972393922730';

db.initDatabase();

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
const bolum = (t) => console.log('\n' + '-'.repeat(4) + ' ' + t);

console.log('='.repeat(70));
console.log('  AÇILAN TICKET PANELİ — YENİ DÜZEN + BUTON YETKİ AYRIMI');
console.log('='.repeat(70));

(async () => {
  /* ================================================================== */
  bolum('1) EMBED DÜZENİ — örneğe birebir');

  const e = views.buildTicketEmbed({
    kind: 'basvuru',
    ownerId: USTA,
    ownerTag: 'd27q#0001',
    ownerAvatarUrl: 'https://cdn.discordapp.com/avatars/1/abc.png?size=256',
    ticketId: 486,
    createdAt: 1760000000000,
    avgResponseMs: 47000,
    status: 'open',
  }).toJSON();

  check('Başlık: emoji + tür + numara', e.title === '📝 Başvuru Talebi #486', e.title);
  check('Sağ üstte açan kişinin arması', e.thumbnail?.url?.includes('/avatars/1/'), String(e.thumbnail?.url));
  check('author kullanılmıyor (başlık setTitle ile)', e.author === undefined);

  const d = e.description;
  check('Açılış cümlesi: mention + tarih', d.includes(`<@${USTA}>`) && d.includes('<t:'), d.split('\n')[0]);
  check('Açılış cümlesi "Yetkililer size ile ilgilenecektir." ile bitiyor', d.includes('Yetkililer size ile ilgilenecektir.'));
  check('"Destek bilgileri" bölüm başlığı', d.includes('**Destek bilgileri**'));
  check('Destek ID satırı #486', d.includes('🔹 **Destek ID** #486'), d);
  check('Destek Kategorisi satırı', d.includes('#️⃣ **Destek Kategorisi** **Başvuru**'), d);
  check('Ortalama Yanıt Süresi 47 saniye (inline kod)', d.includes('⏱ **Ortalama Yanıt Süresi** `47 saniye`'), d);
  check('"Destek Durumu" bölüm başlığı', d.includes('**Destek Durumu**'));
  check('Durum kutusu kod bloğunda: "Yetkili bekleniyor..."', d.includes('```Yetkili bekleniyor...```'), d);
  check('İki ayırıcı çizgi var', (d.match(/─{10,}/g) || []).length === 2, String((d.match(/─{10,}/g) || []).length));
  check('Açıklama 4096 karakter sınırı içinde', d.length <= 4096, String(d.length));

  /* ================================================================== */
  bolum('2) VERİ YOKSA UYDURULMAZ');

  {
    const y = views.buildTicketEmbed({ kind: 'sikayet', ownerId: USTA, status: 'open' }).toJSON();
    check('Ortalama yokken "henüz veri yok" yazar', y.description.includes('*henüz veri yok*'), y.description);
    check('Ortalama yokken sahte süre YAZILMAZ', !/\d+\s*(saniye|dakika|saat)/.test(y.description), y.description);
    check('Numara yokken başlık numarasız', !y.title.includes('#'), y.title);
    check('Numara yokken ID satırı "—"', y.description.includes('🔹 **Destek ID** —'), y.description);
    check('Zaman yokken tarih cümlesi düşer', !y.description.includes('tarihinde'), y.description);
    check('Avatar yoksa thumbnail yok', y.thumbnail === undefined);
  }
  {
    const s = [0, -5, NaN, null, undefined].map((ms) => views.sureMetni(ms));
    check('Geçersiz süreler null döner', s.every((x) => x === null), JSON.stringify(s));
    check('59 saniye -> "59 saniye"', views.sureMetni(59000) === '59 saniye', views.sureMetni(59000));
    check('90 saniye -> "2 dakika"', views.sureMetni(90000) === '2 dakika', views.sureMetni(90000));
    check('2 saat -> "2 saat"', views.sureMetni(7200000) === '2 saat', views.sureMetni(7200000));
  }

  /* ================================================================== */
  bolum('3) DURUM METNİ');

  check('Açık + sahiplenilmemiş', views.durumMetni({ status: 'open' }) === 'Yetkili bekleniyor...', views.durumMetni({ status: 'open' }));
  check('Açık + sahiplenilmiş (yetkili adı)', views.durumMetni({ status: 'open', claimedBy: STAFF }) === `<@${STAFF}> talebinizi inceliyor.`);
  check('Kabul edilmiş', views.durumMetni({ status: 'accepted' }) === 'Talebiniz kabul edildi. 🎉');
  check('Reddedilmiş', views.durumMetni({ status: 'rejected' }) === 'Talebiniz reddedildi.');
  check('Kapatılmış', views.durumMetni({ status: 'closed' }) === 'Bu ticket kapatıldı.');
  check('Sahiplenilmiş olsa bile durum kazanır', views.durumMetni({ status: 'closed', claimedBy: STAFF }) === 'Bu ticket kapatıldı.');

  /* ================================================================== */
  bolum('4) EK BİLGİLER KAYBOLMADI');

  {
    const c = views.buildTicketEmbed({
      kind: 'basvuru',
      ownerId: USTA,
      ticketId: 5,
      status: 'open',
      claimedBy: STAFF,
      claimedAt: 1760000100000,
    }).toJSON();
    const alan = c.fields.map((f) => f.name);
    check('Sahiplenme alanı duruyor', alan.includes('🙋 Ticket Sahibi Yetkili'), alan.join('|'));
    check('Sahiplenme alanında yetkili adı var', c.fields[0].value.includes(`<@${STAFF}>`), c.fields[0].value);

    const k = views.buildTicketEmbed({ kind: 'basvuru', ownerId: USTA, status: 'accepted', actorId: STAFF }).toJSON();
    check('Kabul Eden alanı duruyor', k.fields.some((f) => f.name === 'Kabul Eden'), JSON.stringify(k.fields.map((f) => f.name)));

    const r = views.buildTicketEmbed({
      kind: 'basvuru',
      ownerId: USTA,
      status: 'open',
      roles: [{ roleId: '1522773983588646982', ok: true }, { roleId: '1522773986721660928', ok: false, note: 'yetki yok' }],
    }).toJSON();
    check('Kısmi roller açıkça raporlanıyor', r.fields.some((f) => f.name.includes('KISMEN VERİLDİ')), JSON.stringify(r.fields.map((f) => f.name)));
  }

  /* ================================================================== */
  bolum('5) ORTALAMA SÜRE — GERÇEK HESAP');

  check('getOrtalamaYanitSuresi export edildi', typeof db.getOrtalamaYanitSuresi === 'function');
  check('Veri yokken null', db.getOrtalamaYanitSuresi(G2) === null, String(db.getOrtalamaYanitSuresi(G2)));

  {
    // 10 sn ve 30 sn sonra sahiplenilen iki ticket -> ortalama 20 sn
    const t1 = db.createTicketSession({ guildId: G, ownerId: '200000000000000001', kind: 'basvuru' });
    const t2 = db.createTicketSession({ guildId: G, ownerId: '200000000000000002', kind: 'sikayet' });
    db.getDb()
      .prepare('UPDATE ticket_sessions SET claimed_at = created_at + ? WHERE id = ?')
      .run(10000, t1.id);
    db.getDb()
      .prepare('UPDATE ticket_sessions SET claimed_at = created_at + ? WHERE id = ?')
      .run(30000, t2.id);

    const ortalama = db.getOrtalamaYanitSuresi(G);
    check('Gerçek ortalama hesaplandı (20 sn)', ortalama === 20000, String(ortalama));
    check('Embed bu değeri kullanıyor', views.buildTicketEmbed({ kind: 'basvuru', ownerId: USTA, avgResponseMs: ortalama }).toJSON().description.includes('`20 saniye`'));

    // Sahiplenilmemiş ticket ortalamayı bozmamalı
    db.createTicketSession({ guildId: G, ownerId: '200000000000000003', kind: 'diger' });
    check('Sahiplenilmemiş ticket ortalamaya girmiyor', db.getOrtalamaYanitSuresi(G) === 20000, String(db.getOrtalamaYanitSuresi(G)));

    // Başka sunucu verisi karışmamalı
    const y = db.createTicketSession({ guildId: G2, ownerId: '200000000000000004', kind: 'basvuru' });
    db.getDb()
      .prepare('UPDATE ticket_sessions SET claimed_at = created_at + ? WHERE id = ?')
      .run(900000, y.id);
    check('Sunucu izolasyonu korunuyor', db.getOrtalamaYanitSuresi(G) === 20000, String(db.getOrtalamaYanitSuresi(G)));
    check('Başka sunucunun ortalaması ayrı', db.getOrtalamaYanitSuresi(G2) === 900000, String(db.getOrtalamaYanitSuresi(G2)));
  }

  /* ================================================================== */
  bolum('6) BUTON YERLEŞİMİ');

  const satirlar = (kind, st) => views.buildTicketRows(kind, st).map((r) => r.toJSON());
  const duz = (kind, st) => satirlar(kind, st).flatMap((r) => r.components);

  {
    const s = satirlar('basvuru', 'open');
    check('Başvuru: 2 satır', s.length === 2, String(s.length));
    check(
      'Satır 1: Sahiplen + Kabul + Reddet',
      s[0].components.map((c) => c.custom_id).join('|') === 'tk_sahiplen|tk_kabul|tk_reddet',
      s[0].components.map((c) => c.custom_id).join('|'),
    );
    check(
      'Satır 2: Yetkili-Kapat + Oyuncu-Kapat + Video Yükle',
      s[1].components.map((c) => c.custom_id).join('|') === 'tk_kapat_yetkili|tk_kapat_oyuncu|tk_video_yukle',
      s[1].components.map((c) => c.custom_id).join('|'),
    );
    check('2. satır emojileri 💻 / 🔴 / 🎥', s[1].components.map((c) => c.emoji?.name).join('') === '\u{1F4BB}\u{1F534}\u{1F3A5}', s[1].components.map((c) => c.emoji?.name).join(''));
    check('1. satır emojileri 👤 / ✅ / ❌', s[0].components.map((c) => c.emoji?.name).join('') === '\u{1F464}\u{2705}\u{274C}', s[0].components.map((c) => c.emoji?.name).join(''));
    check('Her satır ≤5 buton', s.every((r) => r.components.length <= 5), JSON.stringify(s.map((r) => r.components.length)));
  }
  {
    const s = satirlar('sikayet', 'open');
    check('Şikayet: 1. satırda sadece Sahiplen', s[0].components.length === 1 && s[0].components[0].custom_id === 'tk_sahiplen');
    check('Şikayet: Kabul/Reddet yok', !duz('sikayet', 'open').some((c) => ['tk_kabul', 'tk_reddet'].includes(c.custom_id)));
    check('Şikayet: 2 satır, 4 buton', s.length === 2 && duz('sikayet', 'open').length === 4);
  }
  {
    const s = satirlar('basvuru', 'closed');
    check('Kapalı: tek satır', s.length === 1, String(s.length));
    check('Kapalı: Kapat devre dışı', s[0].components[0].disabled === true && s[0].components[0].custom_id === 'tk_kapat');
    check('Kapalı: Sahiplen/kapatma/yükleme yok', duz('basvuru', 'closed').length === 1, duz('basvuru', 'closed').map((c) => c.custom_id).join('|'));
  }

  /* ================================================================== */
  bolum('7) CUSTOM ID + YÖNLENDİRME');

  check('KAPAT_YETKILI', views.CID.KAPAT_YETKILI === 'tk_kapat_yetkili', views.CID.KAPAT_YETKILI);
  check('KAPAT_OYUNCU', views.CID.KAPAT_OYUNCU === 'tk_kapat_oyuncu', views.CID.KAPAT_OYUNCU);
  check('VIDEO_YUKLE', views.CID.VIDEO_YUKLE === 'tk_video_yukle', views.CID.VIDEO_YUKLE);
  check('Eski KAPAT korundu (geriye uyum)', views.CID.KAPAT === 'tk_kapat', views.CID.KAPAT);

  {
    const bh = fs.readFileSync(path.join(KOK, 'src/handlers/buttonHandler.js'), 'utf8');
    check('buttonHandler yeni 3 butonu yönlendiriyor', /tickets\.CID\.KAPAT_YETKILI/.test(bh) && /tickets\.CID\.KAPAT_OYUNCU/.test(bh) && /tickets\.CID\.VIDEO_YUKLE/.test(bh));
    const tk = fs.readFileSync(path.join(KOK, 'src/handlers/tickets.js'), 'utf8');
    check('handleTicketButton kapsamları geçiriyor', /handleClose\(interaction, 'yetkili'\)/.test(tk) && /handleClose\(interaction, 'oyuncu'\)/.test(tk));
    check('handleVideoYukle export edildi', typeof tickets.handleVideoYukle === 'function');
    check('handleClose export edildi', typeof tickets.handleClose === 'function');
  }

  /* ================================================================== */
  bolum('8) KAPATMA YETKİ AYRIMI (uçtan uca)');

  const kapat = db.createTicketSession({ guildId: G, ownerId: USTA, kind: 'basvuru' });
  db.setTicketChannel(kapat.id, '999000000000000777');

  const olusan = [];
  const guild = {
    id: G,
    name: 'WELL SD #V12',
    iconURL: () => 'https://cdn/i.png',
    roles: { everyone: { id: G } },
    members: {
      me: { permissions: { has: () => true }, roles: { highest: { position: 90 } } },
      fetch: async () => null,
    },
    channels: {
      fetch: async (id) => (id === CATEGORY ? { id: CATEGORY, type: 4, name: 't', permissionsFor: () => ({ has: () => true }) } : Promise.reject(new Error('yok'))),
      create: async () => ({}),
    },
  };

  const etk = (o) => {
    const c = { reply: null, edit: null, update: null, deferred: false };
    return {
      _c: c,
      customId: o.customId,
      channelId: '999000000000000777',
      user: { id: o.userId, tag: 'x#0001', username: 'x' },
      member: { id: o.userId, permissions: { has: () => !!o.staff }, roles: { cache: new Map() } },
      guild: { ...guild, channels: { ...guild.channels, create: async (p) => { olusan.push(p); return { id: 'k' + olusan.length, delete: async () => {} }; } } },
      channel: { id: '999000000000000777', send: async () => ({}) },
      client: { user: { id: BOT } },
      replied: false,
      deferred: false,
      isRepliable: () => true,
      reply: async (p) => ((c.reply = p), true),
      editReply: async (p) => ((c.edit = p), true),
      update: async (p) => ((c.update = p), true),
      deferReply: async () => ((c.deferred = true), true),
    };
  };
  const yanit = (i) => JSON.stringify(i._c.edit || i._c.reply || i._c.update || {});

  {
    // Oyuncu, "Yetkili - Kapat"a basamaz
    const i1 = etk({ userId: USTA, staff: false, customId: views.CID.KAPAT_YETKILI });
    await tickets.handleClose(i1, 'yetkili');
    check('Oyuncu yetkili-kapat butonuna basamaz', i1._c.deferred === false, yanit(i1));
    check('Oyuncuya net sebep bildiriliyor', yanit(i1).includes('yalnızca yetkililer'), yanit(i1));
    check('Ticket hâlâ açık', db.getTicketByChannel('999000000000000777').status === 'open');
  }
  {
    // Yetkili olmayan, "Oyuncu - Kapat"a basamaz
    const i2 = etk({ userId: '300000000000000009', staff: false, customId: views.CID.KAPAT_OYUNCU });
    await tickets.handleClose(i2, 'oyuncu');
    check('Yabancı oyuncu-kapat butonuna basamaz', i2._c.deferred === false, yanit(i2));
    check('Yabancıya net sebep bildiriliyor', yanit(i2).includes('yalnızca sahibi'), yanit(i2));
    check('Ticket hâlâ açık', db.getTicketByChannel('999000000000000777').status === 'open');
  }
  {
    // Sahibi, "Oyuncu - Kapat"a basabilir -> akış başlar
    const i3 = etk({ userId: USTA, staff: false, customId: views.CID.KAPAT_OYUNCU });
    await tickets.handleClose(i3, 'oyuncu');
    check('Sahibi oyuncu-kapat ile kapatabilir', i3._c.deferred === true, yanit(i3));
    check('Durum DBde closed oldu', db.getTicketByChannel('999000000000000777').status === 'closed', db.getTicketByChannel('999000000000000777').status);
  }
  {
    // Artık kapalı: tekrar basılırsa "zaten kapatılmış"
    const i4 = etk({ userId: USTA, staff: false, customId: views.CID.KAPAT_OYUNCU });
    await tickets.handleClose(i4, 'oyuncu');
    check('Kapatılmış ticket ikinci kez kapatılamaz', yanit(i4).includes('zaten'), yanit(i4));
  }
  tickets._silmeZamanlayici.forEach((t) => clearTimeout(t));
  tickets._silmeZamanlayici.clear();

  /* ================================================================== */
  bolum('9) GERİYE UYUM — ESKİ tk_kapat');

  {
    const t = db.createTicketSession({ guildId: G, ownerId: '400000000000000001', kind: 'sikayet' });
    db.setTicketChannel(t.id, '999000000000000888');

    // Sahibi eski butonla kapatabilmeye devam eder
    const i = etk({ userId: '400000000000000001', staff: false, customId: views.CID.KAPAT });
    i.channelId = '999000000000000888';
    i.guild.channels.fetch = guild.channels.fetch;
    await tickets.handleClose(i);
    check('Eski buton: sahibi kapatabiliyor', db.getTicketByChannel('999000000000000888').status === 'closed', db.getTicketByChannel('999000000000000888').status);
    tickets._silmeZamanlayici.forEach((x) => clearTimeout(x));
    tickets._silmeZamanlayici.clear();
  }

  /* ================================================================== */
  bolum('10) VIDEO YÜKLE');

  {
    const i = etk({ userId: USTA, staff: false, customId: views.CID.VIDEO_YUKLE });
    const r = await tickets.handleVideoYukle(i);
    check('Video Yükle yanıt veriyor', r !== undefined && i._c.reply !== null, JSON.stringify(i._c));
    const m = JSON.stringify(i._c.reply?.embeds?.[0] || {});
    check('Başlık doğru', m.includes('Video / Görsel Yükleme'), m);
    check('Ephemeral yanıt', (i._c.reply?.flags ?? 0) === 64, String(i._c.reply?.flags));
    check('Kullanıcıya ne yapacağı söyleniyor', m.includes('Kanala doğrudan dosya yükleyin'), m);
    check('SAHTE ARŞIVLEME VAADI YOK', !/arşivl|transcript|saklanacaktır/i.test(m), m);
    check('Ticket ID footerda', m.includes('Ticket #'), m);
  }
  {
    // Ticket olmayan kanalda çalışmaz, sahte "başarı" dönmez
    const i = etk({ userId: USTA, staff: false, customId: views.CID.VIDEO_YUKLE });
    i.channelId = '999000000000000999';
    const r = await tickets.handleVideoYukle(i);
    check('Ticket olmayan kanalda sahte başarı dönmez', yanit(i).includes('ticket olarak kayıtlı değil'), yanit(i));
    check('Ticket olmayan kanalda yanıt bir hata embed\'i (video yönlendirmesi değil)', Boolean(i._c.reply?.embeds?.[0]) && !JSON.stringify(i._c.reply).includes('Video / Görsel Yükleme'), JSON.stringify(i._c.reply?.embeds?.[0]?.title));
    check('Ticket olmayan kanalda sahte yükleme yönlendirmesi yok', !JSON.stringify(i._c.reply || {}).includes('Video / Görsel Yükleme'));
  }

  /* ================================================================== */
  bolum('11) DİĞER SİSTEMLER ETKİLENMEDİ');

  {
    const src = fs.readFileSync(path.join(KOK, 'src/utils/ticketViews.js'), 'utf8');
    check('Ana ticket paneli değişmedi', /function buildMainPanel\(/.test(src) && /function buildMainPanelRows\(/.test(src));
    check('Kategori seçim menüsü korundu', /tk_ac_kategori/.test(src) && /StringSelectMenuBuilder/.test(src));
    check('Sahiplenme embed\'i korundu', /function buildSahiplenmeEmbed/.test(src));

    check('Banlılar paneli dokunulmadı', typeof require('../src/commands/banlilar').execute === 'function');
    check('Mazeret paneli dokunulmadı', typeof require('../src/commands/mazeretpanel').execute === 'function');
    check('ticketop dokunulmadı', typeof require('../src/commands/ticketop').execute === 'function');
    check('IC dokunulmadı', typeof require('../src/handlers/icHandler').handleIcButton === 'function');
    check('Banlılar handler dokunulmadı', typeof require('../src/handlers/banli').handleEtkilesim === 'function');
    check('Mazeret handler dokunulmadı', typeof require('../src/handlers/mazeret').handleSureSelect === 'function');

    check('.env değiştirilmedi', !fs.readFileSync(path.join(KOK, '.env'), 'utf8').includes('tk_video_yukle'));
    const pkg = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));
    check('Yeni dependency eklenmedi', Object.keys(pkg.dependencies).length === 9, String(Object.keys(pkg.dependencies).length));
  }

  /* ================================================================== */
  console.log('\n' + '='.repeat(70));
  console.log(`  SONUÇ:  ${pass} başarılı / ${pass + fail} toplam  /  ${fail} başarısız`);
  console.log('='.repeat(70));

  db.closeDatabase();
  try {
    fs.unlinkSync(process.env.DB_PATH);
  } catch {
    /* yok */
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('TEST ÇÖKTÜ: ' + (e?.stack || e));
  process.exit(1);
});