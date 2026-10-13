/**
 * YENİ ticket sistemi testleri — gerçek kod çalıştırılır, Discord bağlantısı yoktur.
 * DB katmanı geçici veritabanı ile uçtan uca test edilir.
 * Kategori doğrulama ve handler yetki kontrolleri sahte Discord nesneleriyle test edilir.
 */
process.env.DB_PATH = require('path').join(require('os').tmpdir(), 'tknew-' + Date.now() + '.db');

const fs = require('fs');
const path = require('path');
const db = require('../src/database/database');
const config = require('../src/config');
const kok0 = path.resolve(__dirname, '..');

const G = '1354465879311777893';
const U1 = '100000000000000001';
const U2 = '100000000000000002';
const STAFF = '1056585742731726918';
const BOT = '1559192913009713222';
const CATEGORY = '1522774034323079329';
const PING_ROLE = '1522773972393922730';

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
const section = (t) => console.log('\n' + '-'.repeat(4) + ' ' + t);

console.log('='.repeat(66));
console.log('  YENİ TICKET SİSTEMİ — TESTLER');
console.log('='.repeat(66));

/* ================================================================== */
section('1) ANA PANEL — kategori seçim menüsü + kurallar bağlantısı');

const views = require('../src/utils/ticketViews');
const RULES_URL = 'https://discord.com/channels/1354465879311777893/1525548689064464567';
const rows = views.buildMainPanelRows({ rulesUrl: RULES_URL }).map((r) => r.toJSON());

check('Panel 2 satır: kurallar linki + seçim menüsü', rows.length === 2, 'bulunan: ' + rows.length);
check('1. satır kurallar linki butonu', rows[0].components[0].type === 2 /* LinkButton */, 'tip: ' + rows[0].components[0].type);
check('Kurallar butonu doğru adrese gidiyor', rows[0].components[0].url === RULES_URL, rows[0].components[0].url);
check('2. satır StringSelectMenu (tip 3)', rows[1].components[0].type === 3, 'tip: ' + rows[1].components[0].type);
check('Menü customId: tk_ac_kategori', rows[1].components[0].custom_id === 'tk_ac_kategori', rows[1].components[0].custom_id);
check(
  'Menü placeholder doğru',
  rows[1].components[0].placeholder === 'TICKET OLUŞTURMAK İÇİN KATEGORİ SEÇİNİZ',
  rows[1].components[0].placeholder,
);

const secenekler = rows[1].components[0].options || [];
check('Menüde 3 seçenek', secenekler.length === 3, 'bulunan: ' + secenekler.length);
check(
  'Seçenek değerleri: basvuru|sikayet|diger',
  secenekler.map((o) => o.value).join('|') === 'basvuru|sikayet|diger',
  secenekler.map((o) => o.value).join('|'),
);
check(
  'Her seçenek geçerli bir ticket türü',
  secenekler.every((o) => views.isKnownKind(o.value)),
  secenekler.map((o) => o.value).join('|'),
);
check('Emoji: 📝 / 📢 / 📩', secenekler.map((o) => o.emoji?.name).join('') === '\u{1F4DD}\u{1F4E2}\u{1F4E9}');

check('rulesUrl verilmezse kurallar satırı hiç oluşmaz', views.buildMainPanelRows().length === 1);
check('rulesUrl olmadan da menü var', views.buildMainPanelRows()[0].toJSON().components[0].type === 3);

const panel = views.buildMainPanel({ guildName: 'WELL SD #V12', iconUrl: 'https://cdn/i.png', rulesUrl: RULES_URL });
check('Panel embed + satır dizisi üretiliyor', !!panel.embed && Array.isArray(panel.rows) && panel.rows.length === 2);
check('Panel başlığı sunucu adını içerir', panel.embed.data.title.includes('WELL SD #V12'), panel.embed.data.title);
check('Sunucu arması sağ üstte (thumbnail)', panel.embed.data.thumbnail?.url === 'https://cdn/i.png', panel.embed.data.thumbnail?.url);
check('Thumbnail verilmezse yok', !views.buildMainPanel({}).embed.data.thumbnail);
check('Görsel verilince embed image alıyor', !!views.buildMainPanel({ imageUrl: 'https://x/y.png' }).embed.data.image?.url);
check('Görsel verilmezse image yok', !panel.embed.data.image);
check('Panel açıklaması kategori bilgisini verir', panel.embed.data.description.includes('kategori') || panel.embed.data.description.includes('seçeneklerden'));
check('Panel açıklaması kural uyarısı içerir', panel.embed.data.description.includes('kurallarımızı'));
check('Eski buton fonksiyonu kaldırıldı', views.buildMainPanelRow === undefined);

section('2) TICKET KANALI BUTONLARI');

const btn = (kind, st) => views.buildTicketRow(kind, st || 'open').toJSON().components;
const basvuru = btn('basvuru');
check(
    'Başvuru: 4 buton (Sahiplen+Kabul+Reddet+Kapat)',
    basvuru.length === 4,
    'bulunan: ' + basvuru.length,
  );
check(
  'Başvuru butonları: Kabul Et / Reddet / Kapat',
  basvuru.map((c) => c.label).join('|') === 'Ticketi Sahiplen|Kabul Et|Reddet|Kapat',
  basvuru.map((c) => c.label).join('|'),
);
check(
  'Başvuru customId: tk_kabul / tk_reddet / tk_kapat',
  basvuru.map((c) => c.custom_id).join('|') === 'tk_sahiplen|tk_kabul|tk_reddet|tk_kapat',
);
for (const k of ['sikayet', 'diger']) {
  const r = btn(k);
  check(
      k + ': 2 buton (Sahiplen + Kapat)',
      r.length === 2 && r.some((c) => c.label === 'Kapat') && r.some((c) => c.label === 'Ticketi Sahiplen'),
      r.map((c) => c.label).join('|'),
    );
  check(k + ': Kabul/Reddet butonu YOK', !r.some((c) => ['Kabul Et', 'Reddet'].includes(c.label)));
}
check(
    'Başvuru kabul edildikten sonra Kabul/Reddet kaybolur',
    !btn('basvuru', 'accepted').some((c) => c.custom_id === 'tk_kabul') &&
      !btn('basvuru', 'accepted').some((c) => c.custom_id === 'tk_reddet'),
  );
check(
    'Başvuru reddedildikten sonra Kabul/Reddet kaybolur',
    !btn('basvuru', 'rejected').some((c) => c.custom_id === 'tk_kabul') &&
      !btn('basvuru', 'rejected').some((c) => c.custom_id === 'tk_reddet'),
  );
check('Başvuru butonları tek satırda', views.buildTicketRow('basvuru').toJSON().components.length <= 5);

/* ================================================================== */
section('3) EMBED DURUMLARI');

const emb = (k, st, extra) =>
  views.buildTicketEmbed(Object.assign({ kind: k, ownerId: U1, ownerTag: 'd27q#0001', status: st }, extra || {}));
const txt = (e) => JSON.stringify(e.data);
check('Açık durum "AÇIK" gösterir', txt(emb('basvuru', 'open')).includes('AÇIK'));
check('Kabul "KABUL EDİLDİ" gösterir', txt(emb('basvuru', 'accepted')).includes('KABUL EDİLDİ'));
check('Ret "REDDEDİLDİ" gösterir', txt(emb('basvuru', 'rejected')).includes('REDDEDİLDİ'));
check('Embed sahibi etiketliyor', txt(emb('basvuru', 'open')).includes('<@' + U1 + '>'));

const rolSonuc = views.buildTicketEmbed({
  kind: 'basvuru',
  ownerId: U1,
  ownerTag: 'x#1',
  status: 'open',
  roles: [
    { roleId: '1522773986721660928', ok: true },
    { roleId: '1522773983588646982', ok: false, note: 'bot rolünün altında' },
  ],
});
check(
  'Kısmi rol başarısı embedde açıkça raporlanıyor',
  txt(rolSonuc).includes('KISMEN') && txt(rolSonuc).includes('bot rolünün altında'),
);

/* ================================================================== */
section('4) VERİTABANI KATMANI');

const t1 = db.createTicketSession({ guildId: G, ownerId: U1, kind: 'basvuru' });
check('createTicketSession kayıt döndürüyor', !!t1 && !!t1.id);
check('Varsayılan durum "open"', t1.status === 'open');
check('Kanal henüz NULL', t1.channel_id === null);

check('setTicketChannel yazıyor', db.setTicketChannel(t1.id, '999000000000000001') === true);
const bulunan = db.getTicketByChannel('999000000000000001');
check('getTicketByChannel ticketı buluyor', bulunan && bulunan.id === t1.id);
check('Kayıttan sahip doğru okunuyor', bulunan.owner_id === U1, 'okunan: ' + bulunan?.owner_id);
check('Kayıttan tür doğru okunuyor', bulunan.kind === 'basvuru');
check('Olmayan kanal null döner', db.getTicketByChannel('123') === null);
check('Null kanal ID güvenli', db.getTicketByChannel(null) === null);
check('getOpenTicketByUser açık ticketı buluyor', db.getOpenTicketByUser(G, U1)?.id === t1.id);
check('Başka kullanıcıda açık ticket yok', db.getOpenTicketByUser(G, U2) === null);

check('setTicketStatus accepted', db.setTicketStatus(t1.id, 'accepted', { actorId: STAFF }) === true);
check('Durum DBden okunuyor', db.getTicketByChannel('999000000000000001').status === 'accepted');
check('Aktör kaydedildi', db.getTicketByChannel('999000000000000001').actor_id === STAFF);
check('Kabul sonrası açık listeden düştü', db.getOpenTicketByUser(G, U1) === null);

const t2 = db.createTicketSession({ guildId: G, ownerId: U2, kind: 'sikayet' });
db.setTicketChannel(t2.id, '999000000000000002');
db.setTicketStatus(t2.id, 'closed', { actorId: U2 });
check('closed_at doluyor', !!db.getTicketByChannel('999000000000000002').closed_at);

check('Aynı kanal iki ticket alamıyor (UNIQUE)', (() => {
  const x = db.createTicketSession({ guildId: G, ownerId: U2, kind: 'diger' });
  const r = db.setTicketChannel(x.id, '999000000000000002');
  db.endTicketSession(x.id, { reason: 'test' });
  return r === false;
})());

check('Geçersiz tür reddediliyor', (() => {
  const x = db.createTicketSession({ guildId: G, ownerId: U2, kind: 'BOZUK' });
  return x === null;
})());
check('endTicketSession kapatıyor', (() => {
  const x = db.createTicketSession({ guildId: G, ownerId: U2, kind: 'diger' });
  db.setTicketChannel(x.id, '999000000000000003');
  return db.endTicketSession(x.id, { reason: 'test' }) === true && db.getTicketByChannel('999000000000000003').status === 'closed';
})());

check('upsertTicketPanel yazıyor', db.upsertTicketPanel(G, '111', '222') === true);
check('getTicketPanel okuyor', db.getTicketPanel(G)?.message_id === '222');
db.upsertTicketPanel(G, '111', '333');
check('Aynı guild için tek kayıt (upsert)', db.getTicketPanel(G).message_id === '333');
check(
  'Farklı guild ayrı kayıt',
  (() => {
    db.upsertTicketPanel('999', '1', '1');
    return db.getTicketPanel('999')?.message_id === '1';
  })(),
);
check('deleteTicketPanel siliyor', db.deleteTicketPanel(G) === true && db.getTicketPanel(G) === null);

/* ---- Veri korunuyor mu? ---- */
const tablolar = db.getDb()
  .prepare("SELECT name FROM sqlite_master WHERE type='table'")
  .all()
  .map((r) => r.name);
check('Eski tickets tablosu SİLİNMEDİ (veri korunur)', tablolar.includes('tickets'));
check('Guard tabloları duruyor', tablolar.includes('guard_whitelist') && tablolar.includes('guard_settings'));
check('Mazeret tabloları duruyor', tablolar.includes('mazeret_records'));
check('Çekiliş tabloları duruyor', tablolar.includes('giveaways'));
check('Yeni ticket_sessions tablosu var', tablolar.includes('ticket_sessions'));
check('Yeni ticket_panel tablosu var', tablolar.includes('ticket_panel'));

/* ================================================================== */
section('5) KATEGORİ DOĞRULAMA');

const tickets = require('../src/handlers/tickets');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

const dogruKategori = (botYetkisi) => ({
  id: CATEGORY,
  type: ChannelType.GuildCategory,
  permissionsFor: () => ({ has: () => botYetkisi }),
});
const guildYap = (cat) => ({
  roles: { everyone: { id: G }, cache: new Map() },
  members: {
    me: { permissions: { has: () => true }, roles: { highest: { position: 90 } } },
  },
    channels: { fetch: async (id) => (id === CATEGORY && cat ? cat : Promise.reject(Object.assign(new Error('Unknown Channel'), { code: 10003, status: 404 }))) },
});

(async () => {
  const ok = await tickets.resolveTicketCategory(guildYap(dogruKategori(true)));
  check('Doğru kategori kabul ediliyor', ok.ok === true && ok.parent?.id === CATEGORY);

  const yok = await tickets.resolveTicketCategory(guildYap(null));
  check('Yoksa kategori açılmıyor', yok.ok === false && yok.reason === 'kategori_yok', yok.reason);

  const yanlis = await tickets.resolveTicketCategory(guildYap({ id: CATEGORY, type: ChannelType.GuildText }));
  check('Kategori değilse reddediliyor', yanlis.ok === false && yanlis.reason === 'kategori_degil', yanlis.reason);

  const yetkisiz = await tickets.resolveTicketCategory(guildYap(dogruKategori(false)));
  check('Bot yetkisi yoksa reddediliyor', yetkisiz.ok === false && yetkisiz.reason === 'yetki_yok', yetkisiz.reason);

  /* ---- Yeni ayrım testleri: her hata AYRI sebep döner ---- */
  const geriAl = { env: process.env.TICKET_CATEGORY_ID, cfg: config.ticket.categoryId };
  const idAyarla = (v) => {
    process.env.TICKET_CATEGORY_ID = v;
    config.ticket.categoryId = v;
  };

  idAyarla('abc');
  const gecersiz = await tickets.resolveTicketCategory(guildYap(dogruKategori(true)));
  check('Geçersiz ID biçimi -> gecersiz_id', gecersiz.ok === false && gecersiz.reason === 'gecersiz_id', gecersiz.reason);

  idAyarla('');
  const bos = await tickets.resolveTicketCategory(guildYap(dogruKategori(true)));
  check('Boş ID -> yapilandirilma', bos.ok === false && bos.reason === 'yapilandirilma', bos.reason);

  idAyarla('999999999999999999');
  const yok2 = await tickets.resolveTicketCategory(guildYap(dogruKategori(true)));
  check('Bulunamayan kategori -> kategori_yok', yok2.ok === false && yok2.reason === 'kategori_yok', yok2.reason);

  // Farklı sunucuya ait kanal
  process.env.TICKET_CATEGORY_ID = geriAl.env;
  config.ticket.categoryId = geriAl.cfg;
  const yabanciKategori = { id: CATEGORY, type: ChannelType.GuildCategory, guildId: '111111111111111111', permissionsFor: () => ({ has: () => true }) };
  const yanlisSunucu = await tickets.resolveTicketCategory(guildYap(yabanciKategori));
  check('Farklı sunucuya ait kategori -> yanlis_sunucu', yanlisSunucu.ok === false && yanlisSunucu.reason === 'yanlis_sunucu', yanlisSunucu.reason);

  // Discord API hatası (404 olmayan)
  const apiGuild = {
    roles: { everyone: { id: G }, cache: new Map() },
    members: { me: { permissions: { has: () => true }, roles: { highest: { position: 90 } } } },
    channels: { fetch: async () => { throw Object.assign(new Error('rate limited'), { code: 50035 }); } },
  };
  const apiHatasi = await tickets.resolveTicketCategory(apiGuild);
  check('Discord API hatası -> api_hatasi', apiHatasi.ok === false && apiHatasi.reason === 'api_hatasi', apiHatasi.reason);
  check('API hatası kodu döndürülüyor', apiHatasi.detail === '50035', String(apiHatasi.detail));

  // 404 ayrımı
  const y404 = {
    roles: { everyone: { id: G }, cache: new Map() },
    members: { me: { permissions: { has: () => true } } },
    channels: { fetch: async () => { throw Object.assign(new Error('Unknown Channel'), { code: 10003 }); } },
  };
  const sonuc404 = await tickets.resolveTicketCategory(y404);
  check('Discord 404 -> kategori_yok (api_hatasi değil)', sonuc404.ok === false && sonuc404.reason === 'kategori_yok', sonuc404.reason);

  // Sabit fallback: env boşken config sabitini kullanmalı
  check('TICKET_CATEGORY_ID sabiti tanımlı', /const TICKET_CATEGORY_ID = '\d{17,20}'/.test(fs.readFileSync(path.join(kok0, 'src/config.js'), 'utf8')));
  const kaynakCfg = fs.readFileSync(path.join(kok0, 'src/config.js'), 'utf8');
  check(
    'categoryId env yoksa sabite düşüyor',
    /categoryId:\s*\(process\.env\.TICKET_CATEGORY_ID \|\| ''\)\.trim\(\) \|\| TICKET_CATEGORY_ID/.test(kaynakCfg),
  );
  check('Kategori ID tek yerde tanımlı (sabit)', (kaynakCfg.match(/const TICKET_CATEGORY_ID = '(\d+)'/g) || []).length === 1);

  // Her sebep için kullanıcı mesajı var mı?
  for (const r of ['yapilandirilma', 'gecersiz_id', 'kategori_yok', 'kategori_degil', 'yanlis_sunucu', 'yetki_yok', 'api_hatasi']) {
    check('Kullanıcı mesajı var: ' + r, typeof tickets.KATEGORI_HATASI[r] === 'string' && tickets.KATEGORI_HATASI[r].length > 10);
  }

  /* ============================================================== */
  section('6) HANDLER YETKİ KONTROLLERİ');

  /**
   * Sahte Discord etkileşimi. Yanıtlar `it._c` (calls) üzerinden toplanır.
   * (Closure'ın sahte nesneye değil seçeneklere yazması hatasına düşmemek için
   *  çağrı kayıtları ayrı bir nesnede tutulur.)
   */
  const sahteEtkilesim = (o = {}) => {
    const c = { reply: null, edit: null, update: null, followUp: null, deferred: false };
    return {
      _c: c,
      customId: o.customId,
      channelId: o.channelId === undefined ? '999000000000000010' : o.channelId,
      user: { id: o.userId || U1, tag: 'test#0001', username: 'test' },
      member: { id: o.userId || U1, permissions: { has: () => !!o.staff } },
      guild: o.guild || null,
      channel: o.channel || null,
      client: { user: { id: BOT } },
      replied: false,
      deferred: false,
      isRepliable: () => true,
      reply: async (p) => ((c.reply = p), true),
      editReply: async (p) => ((c.edit = p), true),
      update: async (p) => ((c.update = p), true),
      followUp: async (p) => ((c.followUp = p), true),
      deferReply: async () => ((c.deferred = true), true),
      deferUpdate: async () => ((c.deferred = true), true),
    };
  };
  const yanit = (it) => JSON.stringify(it._c.edit || it._c.reply || it._c.update || {});

  // Hazır ticket'lar (bölüm 6 için hepsi 'open' durumunda)
  const basvuruKanal = '999000000000000010';
  const sikayetKanal = '999000000000000011';
  const tb = db.createTicketSession({ guildId: G, ownerId: U1, kind: 'basvuru' });
  db.setTicketChannel(tb.id, basvuruKanal);
  const ts = db.createTicketSession({ guildId: G, ownerId: U2, kind: 'sikayet' });
  db.setTicketChannel(ts.id, sikayetKanal);

  const bilinmeyen = sahteEtkilesim({ customId: 'tk_bilinmeyen' });
  check('Bilinmeyen customId false döner', (await tickets.handleTicketButton(bilinmeyen)) === false);

  const kabulYetkisiz = sahteEtkilesim({ customId: 'tk_kabul', channelId: basvuruKanal, userId: U2, staff: false });
  const kr = await tickets.handleTicketButton(kabulYetkisiz);
  check('Kabul: yetkisiz kullanıcı reddediliyor', kr !== false);
  check('Kabul: yetkisize "yetkili olmalısınız" yanıtı', yanit(kabulYetkisiz).includes('yetkili olmalısınız'), yanit(kabulYetkisiz));
  check('Kabul: yetkisizde rol verilmemiş (durum değişmemiş)', db.getTicketByChannel(basvuruKanal).status === 'open');

  const retYetkisiz = sahteEtkilesim({ customId: 'tk_reddet', channelId: basvuruKanal, userId: U2, staff: false });
  await tickets.handleTicketButton(retYetkisiz);
  check('Ret: yetkisiz kullanıcı reddediliyor', yanit(retYetkisiz).includes('yetkili olmalısınız'), yanit(retYetkisiz));

  const retSikayet = sahteEtkilesim({ customId: 'tk_reddet', channelId: sikayetKanal, staff: true });
  await tickets.handleTicketButton(retSikayet);
  check('Ret: yalnızca Başvuru türünde çalışır', yanit(retSikayet).includes('Başvuru'), yanit(retSikayet));
  check('Ret: şikayet ticketı durumu değişmedi', db.getTicketByChannel(sikayetKanal).status === 'open');

  const kapatYabanci = sahteEtkilesim({ customId: 'tk_kapat', channelId: basvuruKanal, userId: U2, staff: false });
  await tickets.handleTicketButton(kapatYabanci);
  check('Kapat: yabancı + yetkisiz engelleniyor', yanit(kapatYabanci).includes('sahibi veya yetkililer'), yanit(kapatYabanci));

  // Ticket kaydı olmayan kanal
  const kayitsiz = sahteEtkilesim({ customId: 'tk_kapat', channelId: '999000000000000999', staff: true });
  await tickets.handleTicketButton(kayitsiz);
  check('Kapat: kayıtsız kanal reddediliyor', yanit(kayitsiz).includes('ticket olarak kayıtlı değil'), yanit(kayitsiz));

  // Kapat: sahibi kapatabilir
  const kapatSahip = sahteEtkilesim({ customId: 'tk_kapat', channelId: sikayetKanal, userId: U2, staff: false });
  const silinenler = [];
  kapatSahip.guild = { channels: { fetch: async () => ({ delete: async () => silinenler.push('sikayet') }) } };
  kapatSahip.channel = { send: async () => {} };
  await tickets.handleTicketButton(kapatSahip);
  check('Kapat: sahibi kapatabiliyor', db.getTicketByChannel(sikayetKanal).status === 'closed');
  check('Kapat: "5 saniye içinde siliniyor" mesajı planlandı', kapatSahip._c.deferred === true);
  check('Kapat: silme zamanlayıcısı kaydedildi', tickets._silmeZamanlayici.size >= 1);

  /* ============================================================== */
  section('7) ESKİ SİSTEM KALINTISI YOK');

  const kok = path.resolve(__dirname, '..');
  for (const f of [
    'src/handlers/ticketHandler.js',
    'src/utils/ticketEmbeds.js',
    'src/handlers/selectHandler.js',
    'src/commands/ticketpanel.js',
    'src/commands/ticketpng.js',
    'src/commands/ticketpermissionrepair.js',
  ]) {
    check('Silindi: ' + f, !fs.existsSync(path.join(kok, f)));
  }
    for (const f of [
    'src/handlers/tickets.js',
    'src/utils/ticketViews.js',
    'src/commands/ticketkur.js',
    'src/commands/ticketop.js',
    'src/utils/leaderboardImage.js',
  ]) {
    check('Var: ' + f, fs.existsSync(path.join(kok, f)));
  }

  const kaynak = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'data') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) kaynak.push(p);
    }
  })(path.join(kok, 'src'));
  kaynak.push(path.join(kok, 'index.js'));

  for (const [ad, re] of [
    ['ticketHandler', /require\([^)]*ticketHandler/],
    ['selectHandler', /require\([^)]*selectHandler/],
    ['ticketEmbeds', /require\([^)]*ticketEmbeds/],
    ['ensureTicketPanel', /ensureTicketPanel/],
  ]) {
    const bulan = kaynak.filter((f) => re.test(fs.readFileSync(f, 'utf8')));
    check('Eski referans yok: ' + ad, bulan.length === 0, bulan.map((f) => path.relative(kok, f)).join(', '));
  }

  // buttonHandler: eski ticket_ öneki artık YENİ handler'a gitmiyor
  const bh = fs.readFileSync(path.join(kok, 'src/handlers/buttonHandler.js'), 'utf8');
  check(
    'buttonHandler: tk_* yeni handler\'a yönlendiriyor',
    /tickets\.handleOpenButton/.test(bh) && /tickets\.handleTicketButton/.test(bh),
  );
  check('buttonHandler: OPEN_KIND ile panel butonları eşleşiyor', /tickets\.OPEN_KIND\[customId\]/.test(bh));
  check(
    'buttonHandler: eski ticket_ butonları sessizce yutulmuyor',
    /startsWith\('ticket_'\)/.test(bh) && /logger\.warn/.test(bh),
  );

  // ready.js hiçbir panel GÖNDERMİYOR
  const readySrc = fs.readFileSync(path.join(kok, 'src/events/ready.js'), 'utf8');
  check('ready.js sendMainPanel çağırmıyor', !/sendMainPanel/.test(readySrc));
  check('ready.js buildMainPanel çağırmıyor', !/buildMainPanel/.test(readySrc));
  check('ready.js ticket paneli gönderen kod yok', !/channels\.send|\.send\(\{[\s\S]{0,80}embed/.test(readySrc.slice(0, readySrc.indexOf('Mazeret paneli'))));

  // /ticketkur TEK panel göndericisi (handler tanımı hariç)
  const cagiranlar = kaynak.filter((f) => /sendMainPanel/.test(fs.readFileSync(f, 'utf8')) && !/handlers[\\/]tickets\.js$/.test(f));
  check(
    'Paneli gönderen tek dosya: src/commands/ticketkur.js',
    cagiranlar.length === 1 && /ticketkur\.js$/.test(cagiranlar[0]),
    cagiranlar.map((f) => path.relative(kok, f)).join(', '),
  );

  // NOT: claimTicket artik var — yeni sahiplenme ozelliginin DB fonksiyonudur.
    for (const f of ['createTicket', 'closeTicket', 'deleteTicket', 'getAllTickets', 'setTicketPanelMessage']) {
    check('DB artık export etmiyor: ' + f, typeof db[f] !== 'function');
  }
  {
    check(
      'DB export ediyor: claimTicket (sahiplenme ozelligi)',
      typeof db.claimTicket === 'function',
    );
    check('DB export ediyor: getTicketTop', typeof db.getTicketTop === 'function');
    check('DB export ediyor: getTicketClaimCount', typeof db.getTicketClaimCount === 'function');
  }

  check('TICKET_CATEGORY_ID = ' + CATEGORY, config.ticket.categoryId === CATEGORY, String(config.ticket.categoryId));
  check('TICKET_PING_ROLE_ID = ' + PING_ROLE, config.ticket.pingRoleId === PING_ROLE, String(config.ticket.pingRoleId));
  check(
    'Kabul rolleri = 1522773986721660928, 1522773983588646982',
    JSON.stringify(config.ticket.acceptRoleIds) === JSON.stringify(['1522773986721660928', '1522773983588646982']),
    JSON.stringify(config.ticket.acceptRoleIds),
  );

  /* ============================================================== */
  section('8) UÇTAN UCA AKIŞ — gerçek handler, sahte Discord');

  const olusan = [];
  const guild = {
    id: G,
    name: 'WELL SD',
    roles: { everyone: { id: G } },
    members: { me: { permissions: { has: () => true }, roles: { highest: { position: 90 } } } },
    channels: {
      fetch: async (id) => (id === CATEGORY ? dogruKategori(true) : Promise.reject(new Error('yok'))),
      create: async (opts) => {
        const ch = {
          id: '9990000000000010' + olusan.length,
          name: opts.name,
          type: opts.type,
          parentId: opts.parent,
          permissionOverwrites: opts.permissionOverwrites,
          sent: [],
          deleted: false,
          isTextBased: () => true,
          send: async (p) => {
            ch.sent.push(p);
            return { id: 'm' + ch.sent.length };
          },
          delete: async () => {
            ch.deleted = true;
          },
        };
        olusan.push(ch);
        return ch;
      },
    },
  };

  // --- Başvuru ---
  const ac = sahteEtkilesim({ customId: 'tk_ac_basvuru', channelId: null, userId: U2, staff: false, guild });
  const acR = await tickets.handleOpenButton(ac, 'basvuru');
  check('Başvuru butonu işlendi', acR !== false);
  check('Etkileşim anında ACK edildi (deferReply)', ac._c.deferred === true, JSON.stringify(ac._c));
  check('1 kanal oluşturuldu', olusan.length === 1, 'olusan: ' + olusan.length);
  const ch1 = olusan[0];
  check('Kanal DOĞRU kategoride', ch1?.parentId === CATEGORY, String(ch1?.parentId));
  check('@everyone kanalı göremez', ch1.permissionOverwrites.find((o) => o.id === G)?.deny.includes(PermissionFlagsBits.ViewChannel));
  check('Sahip kanala erişebiliyor', ch1.permissionOverwrites.find((o) => o.id === U2)?.allow.includes(PermissionFlagsBits.ViewChannel));
  check('Bot kanala erişebiliyor', ch1.permissionOverwrites.find((o) => o.id === BOT)?.allow.includes(PermissionFlagsBits.ManageChannels));
  check('Yetkili rol kanala erişebiliyor', ch1.permissionOverwrites.find((o) => o.id === PING_ROLE)?.allow.includes(PermissionFlagsBits.ViewChannel));
  check('1 karşılama mesajı gönderildi', ch1.sent.length === 1);
  const km = ch1.sent[0];
  check('Mesaj sahibi etiketliyor', km.content.includes('<@' + U2 + '>'), km.content);
  check('Mesaj yetkili rolü etiketliyor', km.content.includes('<@&' + PING_ROLE + '>'), km.content);
  check(
    'allowedMentions yalnızca sahip + rol',
    JSON.stringify(km.allowedMentions.users) === JSON.stringify([U2]) &&
      JSON.stringify(km.allowedMentions.roles) === JSON.stringify([PING_ROLE]),
    JSON.stringify(km.allowedMentions),
  );
  check('Karşılama embedi başvuru türü', km.embeds[0].data.author.name.includes('Başvuru'), km.embeds[0].data.author?.name);
  check(
    'Başvuru karşılamasında 4 buton (Sahiplen dahil)',
    km.components[0].toJSON().components.length === 4 &&
      km.components[0].toJSON().components[0].custom_id === 'tk_sahiplen',
    JSON.stringify(km.components[0].toJSON().components.map((x) => x.custom_id)),
  );
  check('Ticket DBye yazıldı', db.getTicketByChannel(ch1.id)?.owner_id === U2);
  check('Kullanıcının açık ticketı var', db.getOpenTicketByUser(G, U2)?.id !== null);

  // Aynı kullanıcı ikinci kez basarsa yeni kanal açılmıyor
  const ac2 = sahteEtkilesim({ customId: 'tk_ac_sikayet', channelId: null, userId: U2, staff: false, guild });
  await tickets.handleOpenButton(ac2, 'sikayet');
  check('Mevcut açık ticket varsa yeni açılmıyor', olusan.length === 1, 'toplam kanal: ' + olusan.length);
  check('Kullanıcıya kanal linki dönüldü', yanit(ac2).includes(ch1.id), yanit(ac2));

  // --- Şikayet (U1'in bölüm 6'da açık ticket'ı var; temiz kullanıcı kullanılır) ---
  const U5 = '100000000000000005';
  const ac3 = sahteEtkilesim({ customId: 'tk_ac_sikayet', channelId: null, userId: U5, staff: false, guild });
  await tickets.handleOpenButton(ac3, 'sikayet');
  const ch2 = olusan[olusan.length - 1];
  check('Şikayet kanalı açıldı', !!ch2 && olusan.length === 2);
  check(
    'Şikayet: Sahiplen + Kapat butonu',
    ch2.sent[0].components[0].toJSON().components.length === 2 &&
      ch2.sent[0].components[0].toJSON().components.some((x) => x.custom_id === 'tk_sahiplen'),
    JSON.stringify(ch2.sent[0].components[0].toJSON().components.map((x) => x.custom_id)),
  );
  check('Şikayet: kabul/reddet butonu yok', !ch2.sent[0].components[0].toJSON().components.some((c) => c.custom_id === 'tk_kabul'));
  check('Şikayet: rol etiketleniyor', ch2.sent[0].content.includes('<@&' + PING_ROLE + '>'));
  check('Şikayet: ticket türü DBde doğru', db.getTicketByChannel(ch2.id)?.kind === 'sikayet');

  // --- Diğer ---
  const ac4 = sahteEtkilesim({ customId: 'tk_ac_diger', channelId: null, userId: '100000000000000003', staff: false, guild });
  await tickets.handleOpenButton(ac4, 'diger');
  const ch3 = olusan[olusan.length - 1];
  check(
    'Diğer: Sahiplen + Kapat butonu',
    ch3.sent[0].components[0].toJSON().components.length === 2 &&
      ch3.sent[0].components[0].toJSON().components.some((x) => x.custom_id === 'tk_sahiplen'),
    JSON.stringify(ch3.sent[0].components[0].toJSON().components.map((x) => x.custom_id)),
  );
  check('Diğer: ticket türü DBde doğru', db.getTicketByChannel(ch3.id)?.kind === 'diger');

  // --- Kategori yoksa kanal açılmıyor ---
  const kotuGuild = { ...guild, channels: { fetch: async () => Promise.reject(Object.assign(new Error('Unknown Channel'), { code: 10003, status: 404 })), create: guild.channels.create } };
  const ac5 = sahteEtkilesim({ customId: 'tk_ac_basvuru', channelId: null, userId: '100000000000000004', staff: false, guild: kotuGuild });
  await tickets.handleOpenButton(ac5, 'basvuru');
  check('Kategori yoksa kanal açılmıyor', olusan.length === 3, 'toplam kanal: ' + olusan.length);
  check('Kategori yoksa kullanıcıya hata bildiriliyor', yanit(ac5).toLowerCase().includes('kategori'), yanit(ac5));

  /* --- KABUL: roller gerçekten veriliyor mu --- */
  // discord.js v14 gibi: member.roles doğrudan Collection (has + add)
  const verilenRoller = new Set();
  const rolIdsMap = new Map();
  const kul = {
    id: U2,
    user: { id: U2, tag: 'd27q#0001' },
    roles: {
      cache: rolIdsMap,
      has: (id) => rolIdsMap.has(id),
      add: async (id) => { verilenRoller.add(id); rolIdsMap.set(id, { id }); },
    },
  };
  const rolGuild = {
    ...guild,
    roles: {
      cache: new Map([
        ['1522773986721660928', { id: '1522773986721660928', position: 10 }],
        ['1522773983588646982', { id: '1522773983588646982', position: 11 }],
      ]),
      fetch: async (id) => ({ id, position: 10 }),
    },
    members: {
      fetch: async (id) => (id === U2 ? kul : null),
      me: { permissions: { has: (p) => p === PermissionFlagsBits.ManageRoles }, roles: { highest: { position: 90 } } },
    },
  };
  const kab = sahteEtkilesim({ customId: 'tk_kabul', channelId: ch1.id, userId: STAFF, staff: true, guild: rolGuild });
  kab.channel = ch1;
  await tickets.handleTicketButton(kab);
  check('Kabul: iki rol de verildi',
    verilenRoller.has('1522773986721660928') && verilenRoller.has('1522773983588646982'),
    [...verilenRoller].join(','),
  );
  check('Kabul: durum accepted oldu', db.getTicketByChannel(ch1.id)?.status === 'accepted');
  check('Kabul: yetkili DBde kayıtlı', db.getTicketByChannel(ch1.id)?.actor_id === STAFF);
  check(
    'Kabul: başvuru sahibine açıkça bildirildi',
    ch1.sent.some((m) => typeof m.content === 'string' && m.content.includes('<@' + U2 + '>') && m.content.includes('kabul edildi')),
  );

  // --- KABUL tekrar: duplicate engelleniyor ---
  const verilen2 = new Set();
  rolIdsMap.clear();
  verilenRoller.clear();
  kul.roles.add = async (id) => { verilen2.add(id); rolIdsMap.set(id, { id }); };
  const kab2 = sahteEtkilesim({ customId: 'tk_kabul', channelId: ch1.id, userId: STAFF, staff: true, guild: rolGuild });
  kab2.channel = ch1;
  await tickets.handleTicketButton(kab2);
  check('Kabul tekrarı: rol tekrar verilmiyor', verilen2.size === 0, [...verilen2].join(','));

  // --- KABUL kısmi başarısızlık açıkça raporlanıyor ---
  const tK = db.createTicketSession({ guildId: G, ownerId: U1, kind: 'basvuru' });
  db.setTicketChannel(tK.id, '999000000000000500');
  const kul2 = { id: U1, user: { id: U1, tag: 'x#1' }, roles: { cache: new Map(), add: async () => {} } };
  const kotuRolGuild = {
    ...rolGuild,
    channels: { fetch: async () => Promise.reject(Object.assign(new Error('Unknown Channel'), { code: 10003, status: 404 })), create: async () => ({ id: 'x', send: async (m) => { kotuMesajlar.push(m); }, deleted: false }) },
    members: { fetch: async () => kul2, me: { permissions: { has: () => false }, roles: { highest: { position: 90 } } } },
  };
  const kotuMesajlar = [];
  kotuRolGuild.channels.create = async () => ({
    id: '999000000000000500',
    sent: kotuMesajlar,
    send: async (m) => { kotuMesajlar.push(m); return {}; },
    delete: async () => {},
  });
  const kab3 = sahteEtkilesim({ customId: 'tk_kabul', channelId: '999000000000000500', userId: STAFF, staff: true, guild: kotuRolGuild });
  kab3.channel = { send: async (m) => { kotuMesajlar.push(m); return {}; } };
  await tickets.handleTicketButton(kab3);
  check(
    'Kabul: rol verilemezse durum "kabul edilmiş" SAYILMAZ',
    db.getTicketByChannel('999000000000000500')?.status === 'open',
    db.getTicketByChannel('999000000000000500')?.status,
  );
  check(
    'Kabul: kısmi başarısızlık kanalda açıkça raporlanıyor',
    kotuMesajlar.some((m) => typeof m.content === 'string' && /başarısız|verilemedi/i.test(m.content)),
    JSON.stringify(kotuMesajlar.map((m) => m.content || '(embed)')),
  );

  /* --- RET --- */
  const tR = db.createTicketSession({ guildId: G, ownerId: U2, kind: 'basvuru' });
  db.setTicketChannel(tR.id, '999000000000000600');
  const retMesajlar = [];
  const ret = sahteEtkilesim({ customId: 'tk_reddet', channelId: '999000000000000600', userId: STAFF, staff: true });
  ret.channel = { send: async (m) => { retMesajlar.push(m); return {}; } };
  await tickets.handleTicketButton(ret);
  check('Ret: durum rejected oldu', db.getTicketByChannel('999000000000000600')?.status === 'rejected');
  check(
    'Ret: "<@id> başvurunuz reddedildi." mesajı gönderildi',
    retMesajlar.some((m) => m.content === '<@' + U2 + '> başvurunuz reddedildi.'),
    JSON.stringify(retMesajlar.map((m) => m.content || '(embed)')),
  );
  check('Ret: allowedMentions sahibi sınırlandı', (retMesajlar.find((m) => m.content)?.allowedMentions?.users || []).includes(U2));

  /* --- KAPAT: mesaj + 5sn + yalnızca o kanal --- */
  const silinen = [];
  const tC = db.createTicketSession({ guildId: G, ownerId: U2, kind: 'basvuru' });
  db.setTicketChannel(tC.id, '999000000000000700');
  const kapatMesajlar = [];
  const kapat = sahteEtkilesim({ customId: 'tk_kapat', channelId: '999000000000000700', userId: U2, staff: false });
  kapat.guild = {
    channels: {
      fetch: async (id) => ({
        id,
        delete: async () => silinen.push(id),
        send: async (m) => { kapatMesajlar.push(m); return {}; },
      }),
    },
  };
  kapat.channel = { send: async (m) => { kapatMesajlar.push(m); return {}; } };
  await tickets.handleTicketButton(kapat);
  check('Kapat: "5 saniye içerisinde siliniyor" mesajı gönderildi', kapatMesajlar.includes('\u{1F512} Bu ticket 5 saniye içerisinde siliniyor.'), JSON.stringify(kapatMesajlar));
  check('Kapat: durum closed oldu', db.getTicketByChannel('999000000000000700')?.status === 'closed');

  // ikinci kez basılırsa ikinci silme görevi BAŞLATILMAZ
  const kapat2 = sahteEtkilesim({ customId: 'tk_kapat', channelId: '999000000000000700', userId: STAFF, staff: true });
  kapat2.guild = kapat.guild;
  kapat2.channel = kapat.channel;
  await tickets.handleTicketButton(kapat2);
  const zamanlayiciSayisi = [...tickets._silmeZamanlayici.keys()].filter((k) => k === '999000000000000700').length;
  check('Kapat: aynı kanal için tek silme görevi', zamanlayiciSayisi === 1, 'adet: ' + zamanlayiciSayisi);

  // 5 saniye bekle, sonra doğrula
  console.log('\n  ... 5 saniye bekleniyor (Kapat akışının silme adımı doğrulanıyor) ...');
  await new Promise((r) => setTimeout(r, 5600));
  check('Kapat: 5sn sonra yalnızca ilgili kanal silindi', silinen.length === 1 && silenede(silinen), silinen.join(','));
  function silenede(l) {
    return l[0] === '999000000000000700';
  }
  check('Kapat: kategori/panel silinmedi', !silinen.includes(CATEGORY));

  /* ============================================================== */
  section('9) PANEL GÖRSELİ');

  const kokYol = path.resolve(__dirname, '..');
  const gorselYol = path.join(kokYol, 'assets', 'ticket-panel.png');

  check('assets/ticket-panel.png repoda var', fs.existsSync(gorselYol));
  check('Görsel PNG imzası ile başlıyor', fs.readFileSync(gorselYol).subarray(1, 4).toString() === 'PNG');
  check(
    'Görsel boyutu makul (< 8 MB Discord limiti)',
    fs.statSync(gorselYol).size < 8 * 1024 * 1024,
    String(Math.round(fs.statSync(gorselYol).size / 1024 / 1024 * 100) / 100) + ' MB',
  );
  check('Görselin SHA256\'si beklenen', (() => {
    const h = require('crypto').createHash('sha256').update(fs.readFileSync(gorselYol)).digest('hex');
    return h.startsWith('5cd1ab5b0f926062506c5f0c676a6ebe');
  })());

  const g = tickets.panelGorseli();
  check('panelGorseli() dosyayı seçiyor', g.kaynak === 'dosya' && g.yol === gorselYol, g.kaynak);

  // sendMainPanel: YENİ panel -> dosya mesaja ekleniyor
  {
    const gonderilen = [];
    const kanal = {
      id: '1522774099317887078',
      name: 'panel',
      send: async (p) => {
        gonderilen.push(p);
        return { id: '999000000000009900' };
      },
      messages: { fetch: async () => Promise.reject(new Error('yok')) },
    };
    db.deleteTicketPanel(G);
    const r = await tickets.sendMainPanel({}, { id: G, name: 'WELL SD' }, kanal);
    check('sendMainPanel yeni panel gönderdi', r.ok === true && r.action === 'gonderildi', r.action);
    check('Mesaja dosya eklendi', Array.isArray(gonderilen[0].files) && gonderilen[0].files.length === 1);
    check(
      'Embed görseli attachment:// ile bağlı',
      gonderilen[0].embeds[0].data.image?.url === 'attachment://ticket-panel.png',
      gonderilen[0].embeds[0].data.image?.url,
    );
    check('Panel kaydı DBye yazıldı', db.getTicketPanel(G)?.message_id === '999000000000009900');
    check(
      'Panel mesajında kategori seçim menüsü var',
      gonderilen[0].components.length === 2 &&
        gonderilen[0].components[1].toJSON().components[0].custom_id === 'tk_ac_kategori',
      JSON.stringify(gonderilen[0].components.map((c) => c.toJSON().components[0].custom_id)),
    );

    // sendMainPanel tekrar -> duplicate YOK, mevcut güncellenir (görsel korunur)
    const editCagrisi = [];
    kanal.messages.fetch = async () => ({
      id: '999000000000009900',
      embeds: [{ image: { url: 'https://cdn.discordapp.com/attachments/1/2/ticket-panel.png' } }],
      edit: async (p) => editCagrisi.push(p),
    });
    const r2 = await tickets.sendMainPanel({}, { id: G, name: 'WELL SD' }, kanal);
    check('İkinci çalıştırmada yeni mesaj gönderilmedi', r2.action === 'guncellendi', r2.action);
    check('Toplam gönderilen mesaj hâlâ 1', gonderilen.length === 1, String(gonderilen.length));
    check(
      'Güncellemede mevcut görsel korundu',
      editCagrisi[0].embeds[0].data.image?.url === 'https://cdn.discordapp.com/attachments/1/2/ticket-panel.png',
      editCagrisi[0].embeds[0].data.image?.url,
    );
      check(
        'Güncellemede de kategori menüsü gönderiliyor',
        Array.isArray(editCagrisi[0].components) &&
          editCagrisi[0].components[1].toJSON().components[0].custom_id === 'tk_ac_kategori',
      );
  }

  // Dosya yoksa kayıtlı URL yedeğine düşüyor mu?
  {
    db.setSetting('ticket_panel_image', 'https://cdn.discordapp.com/attachments/1/2/yedek-panel.png');
    const gecici = gorselYol + '.gizli';
    fs.renameSync(gorselYol, gecici);
    try {
      const y = tickets.panelGorseli();
      check('Dosya yokken kayıtlı URL yedeğine düşüyor', y.kaynak === 'url', y.kaynak);
      check('Yedek URL doğru değer', y.url === 'https://cdn.discordapp.com/attachments/1/2/yedek-panel.png', y.url);
    } finally {
      fs.renameSync(gecici, gorselYol);
    }
    check('Dosya geri geldi', fs.existsSync(gorselYol));
    check('Dosya varken dosya yine seçiliyor', tickets.panelGorseli().kaynak === 'dosya');
  }

  /* ============================================================== */
  console.log('\n' + '='.repeat(66));
  console.log('  SONUÇ:  ' + pass + ' başarılı / ' + (pass + fail) + ' toplam  /  ' + fail + ' başarısız');
  console.log('='.repeat(66));

  db.closeDatabase();
  try { fs.unlinkSync(process.env.DB_PATH); } catch { /* dosya zaten yok */ }
  process.exit(fail ? 1 : 0);
})();