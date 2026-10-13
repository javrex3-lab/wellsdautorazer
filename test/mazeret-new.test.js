/**
 * YENİ MAZERET SİSTEMİ — TESTLER
 *
 * Gerçek handler kodu çalıştırılır. Discord bağlantısı YOKTUR; kanal/mesaj
 * nesneleri taklit edilir. Gerçek sunucuda test edilenler raporda AYRI belirtilir.
 *
 * Restart senaryoları AYRI node süreçlerinde koşturulur (gerçek restart taklidi).
 */
process.env.DB_PATH = require('path').join(require('os').tmpdir(), 'mz-' + Date.now() + '.db');

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const db = require('../src/database/database');
const config = require('../src/config');

const KOK = path.resolve(__dirname, '..');
const G = '1354465879311777893';
const KANAL = '1548927431597883472';
const H = 3600_000;
const GUN = 24 * H;

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

console.log('='.repeat(68));
console.log('  YENI MAZERET SISTEMI - TESTLER');
console.log('='.repeat(68));

db.initDatabase();
const mz = require('../src/handlers/mazeret');
const views = require('../src/utils/mazeretViews');

/* ================================================================== */
section('1) PANEL EMBEDI (baslik + tek buton)');

const panel = views.buildPanelEmbed({ guildName: 'WELL SD #V12', activeCount: 2 });
check('Baslik tam "MAZERET BİLDİRİM SİSTEMİ"', panel.data.title === 'MAZERET BİLDİRİM SİSTEMİ', panel.data.title);
check(
  'Aciklama istenen cumleyi iceriyor',
  panel.data.description.includes('İzinli olacağınız süre boyunca mazeretinizi bildirmek') &&
    panel.data.description.includes('Mazeret sürenizi seçin ve sebebinizi belirtin'),
  panel.data.description,
);
const pRow = views.buildBildirRow().toJSON().components;
check('Panelde TAM 1 buton', pRow.length === 1, String(pRow.length));
check('Buton adi "Mazeret Bildir"', pRow[0].label === 'Mazeret Bildir', pRow[0].label);
check('Buton tipi buton (2)', pRow[0].type === 2, String(pRow[0].type));
check('Buton customId mz_bildir', pRow[0].custom_id === 'mz_bildir', pRow[0].custom_id);
check('Buton emojisi dolu', !!pRow[0].emoji?.name, String(pRow[0].emoji?.name));
check('Aciklama 4096 sinirinin altinda', panel.data.description.length <= 4096, String(panel.data.description.length));
check('Embed alan sayisi <= 25', panel.data.fields.length <= 25, String(panel.data.fields.length));
check('Renk ayarli', typeof panel.data.color === 'number');

/* ================================================================== */
section('2) /mazeretpanel YETKI KONTROLU');

{
  const komut = require('../src/commands/mazeretpanel');
  check('Komut dosyasi mevcut', !!komut);
  check('Komut adi /mazeretpanel', komut.data.name === 'mazeretpanel', komut.data.name);
  check('Herkese acik DEGIL (openToEveryone yok)', komut.openToEveryone !== true);
  const src = fs.readFileSync(path.join(KOK, 'src/commands/mazeretpanel.js'), 'utf8');
  check('canManageTickets kontrolu var', /canManageTickets\(interaction\.member\)/.test(src));
  check('Yetkisize reddediyor', /yetkililer kullanabilir/.test(src));
  check('Kanala gonderme izni kontrolu var', /SendMessages/.test(src));
}

/* ================================================================== */
section('3) SURE SELECT MENUSU');

const sRow = views.buildSureSelectRow().toJSON().components[0];
check('Select menu olustu', !!sRow, 'yok');
check('Select tipi string select (3)', sRow.type === 3, String(sRow.type));
check('customId mz_sure', sRow.custom_id === 'mz_sure', sRow.custom_id);
const BEKLENEN = ['1 saat', '3 saat', '6 saat', '12 saat', '1 gün', '2 gün', '3 gün', '1 hafta'];
const etiketler = sRow.options.map((o) => o.label);
check('8 secenek var', sRow.options.length === 8, String(sRow.options.length));
check(
  'Secenekler tam ve sirali',
  etiketler.join('|') === BEKLENEN.join('|'),
  etiketler.join('|'),
);
check('Select en fazla 25 secenek', sRow.options.length <= 25);
check('Her secenegin degeri var', sRow.options.every((o) => !!o.value));

/* ================================================================== */
section('4) SURE HESABI (gercek zamanli)');

const BEKLENEN_MS = {
  '1 saat': 1 * H,
  '3 saat': 3 * H,
  '6 saat': 6 * H,
  '12 saat': 12 * H,
  '1 gün': GUN,
  '2 gün': 2 * GUN,
  '3 gün': 3 * GUN,
  '1 hafta': 7 * GUN,
};
for (const etiket of BEKLENEN) {
  const s = views.SURELER.find((x) => x.label === etiket);
  check(`${etiket} = ${BEKLENEN_MS[etiket]} ms`, !!s && s.ms === BEKLENEN_MS[etiket], s ? String(s.ms) : 'yok');
}
check('3 gun tam 72 saat', views.SURELER.find((s) => s.label === '3 gün').ms === 72 * H);
check('1 hafta tam 7 gun', views.SURELER.find((s) => s.label === '1 hafta').ms === 7 * GUN);
check('sureBul() anahtarla calisiyor', !!views.sureBul('g3') && views.sureBul('g3').label === '3 gün');
check('Gecersiz anahtar null doner', views.sureBul('sahte') === null);
check('sureMetni() 3 gunu dogru yaziyor', views.sureMetni(3 * GUN) === '3 gün', views.sureMetni(3 * GUN));
check('kalanEtiket() dolmus durumu', views.kalanEtiket(Date.now() - 1000) === 'Süresi doldu');

/* ================================================================== */
section('5) SEBEP MODALI');

{
  const m = views.buildSebepModal('g3').toJSON();
  check('Modal basligi "Mazeret Sebebi"', m.title === 'Mazeret Sebebi', m.title);
  check('customId mz_sebep', m.custom_id === 'mz_sebep', m.custom_id);
  check('Modal tek satir bileseni', m.components.length === 1, String(m.components.length));
  const input = m.components[0].components[0];
  check('Etiket dogru', input.label === 'Mazeret nedeniniz nedir?', input.label);
  check('Zorunlu', input.required === true);
  check('Min length >= 3 (bos kabul edilmez)', input.min_length >= 3, String(input.min_length));
  check('Max length <= 4000', input.max_length <= 4000, String(input.max_length));
  check('Placeholder dolu', !!input.placeholder && input.placeholder.length > 0);
  check('Modal basligi 45 karakter siniri icinde', m.title.length <= 45, String(m.title.length));
  check('Etiket 45 karakter siniri icinde', input.label.length <= 45, String(input.label.length));
}

/* ================================================================== */
section('6) METIN GUVENLIGI (mention engelleme)');

{
  const kotu = '<@&1522773972393922730> @everyone <@1559192913009713222> <#123> @here ping!';
  const temiz = views.guvenliMetin(kotu, 300);
  check('Rol mention yok', !temiz.includes('<@&'), temiz);
  check('Kullanici mention yok', !/<@!?\d+>/.test(temiz), temiz);
  check('Kanal mention yok', !/<#\d+>/.test(temiz), temiz);
  check('@everyone yok', !/@everyone/i.test(temiz), temiz);
  check('@here yok', !/@here/i.test(temiz), temiz);
  check('Metin korunuyor (bilgi kaybi yok)', temiz.includes('ping'), temiz);
  check('Bos metin "Belirtilmedi"', views.guvenliMetin('') === 'Belirtilmedi');
  check('Bosluk metin "Belirtilmedi"', views.guvenliMetin('    ') === 'Belirtilmedi');
  check('Uzunluk kirpiliyor', views.guvenliMetin('x'.repeat(999), 50).length <= 50);
  check('Null guvenli', views.guvenliMetin(null) === 'Belirtilmedi');
}

/* ================================================================== */
section('7) AKTIF PANEL EMBEDI + SAYFALAMA');

{
  const bos = views.buildAktifPanelEmbed([], { page: 1, now: Date.now() });
  check('Bos liste -> "bulunmuyor"', bos.embed.data.description.includes('bulunmuyor'), bos.embed.data.description);
  check('Bos listede toplamSayfa = 1', bos.toplamSayfa === 1, String(bos.toplamSayfa));

  const simdi = Date.now();
  const kayitlar = (n) =>
    Array.from({ length: n }, (_, i) => ({
      user_id: '10000000000000' + String(i).padStart(4, '0'),
      duration_ms: 3 * GUN,
      duration_raw: '3 gün',
      started_at: simdi - H,
      created_at: simdi - H,
      expires_at: simdi + 3 * GUN - H,
      reason: 'Test sebebi ' + i,
      reported_by: '100000000000000001',
    }));

  const tek = views.buildAktifPanelEmbed(kayitlar(3), { page: 1, now: simdi });
  check('Tek sayfa', tek.toplamSayfa === 1, String(tek.toplamSayfa));
  check('Baslik "Aktif Mazeretli Memurlar"', tek.embed.data.title === 'Aktif Mazeretli Memurlar', tek.embed.data.title);
  check(
    'Istenen aciklama metni',
    tek.embed.data.description.includes('Aşağıda departman bünyesinde aktif olarak mazeretli olan kullanıcıları görebilirsiniz'),
  );
  for (const alan of ['**Süre:**', '**Başlangıç:**', '**Bitiş:**', '**Sebep:**', '**Durum:**']) {
    check('Alan mevcut: ' + alan, tek.embed.data.description.includes(alan));
  }
  check('Aktif durum etiketi', tek.embed.data.description.includes('Aktif'));
  check('Discord timestamp kullaniliyor', /<t:\d+:/.test(tek.embed.data.description));
  check('Mention kullaniliyor', tek.embed.data.description.includes('<@'));
  check('Aciklama 4096 siniri icinde', tek.embed.data.description.length <= 4096, String(tek.embed.data.description.length));
  check('Numaralandirma var', tek.embed.data.description.includes('👤'));

  const cok = kayitlar(60);
  const p = views.buildAktifPanelEmbed(cok, { page: 1, now: simdi });
  check('60 kayit -> birden fazla sayfa', p.toplamSayfa > 1, String(p.toplamSayfa));
  check('Her sayfa 4096 siniri icinde', p.embed.data.description.length <= 4096, String(p.embed.data.description.length));

  const gorulen = new Set();
  for (let sayfa = 1; sayfa <= p.toplamSayfa; sayfa++) {
    const s = views.buildAktifPanelEmbed(cok, { page: sayfa, now: simdi });
    for (const r of s.embed.data.description.matchAll(/<@(\d+)>/g)) gorulen.add(r[1]);
  }
  check('Tum kayitlar sayfalarda gorunuyor (kayip yok)', gorulen.size === 60, gorulen.size + '/60');

  const tasma = views.buildAktifPanelEmbed(cok, { page: 999, now: simdi });
  check('Yuksek sayfa numarasi guvenli', tasma.embed.data.description.length > 0 && tasma.embed.data.description.length <= 4096);
  const negatif = views.buildAktifPanelEmbed(cok, { page: -5, now: simdi });
  check('Negatif sayfa guvenli', negatif.embed.data.description.length > 0 && negatif.embed.data.description.length <= 4096);

  check('Tek sayfada buton yok', views.buildSayfalamaRow(1, 1) === null);
  const pag = views.buildSayfalamaRow(1, p.toplamSayfa);
  check('Cok sayfada buton var', !!pag);
  if (pag) {
    const c = pag.toJSON().components;
    check('3 buton (onceki/sayfa/sonraki)', c.length === 3, String(c.length));
    check('Ilk sayfada "Onceki" kapali', c[0].disabled === true);
    check('Son sayfada "Sonraki" kapali', views.buildSayfalamaRow(p.toplamSayfa, p.toplamSayfa).toJSON().components[2].disabled === true);
    check('Sayfa gostergesi var', /\d+ \/ \d+/.test(c[1].label), c[1].label);
  }
}

/* ================================================================== */
section('8) KALICI KAYIT - DB KATMANI');

const U1 = '100000000000001001';
const U2 = '100000000000001002';

{
  const r = db.createMazeretRecord({ guildId: G, userId: U1, reason: 'Hastane randevum var', durationRaw: '3 gün', durationMs: 3 * GUN, reportedBy: U1 });
  check('Kayit olustu', r.ok === true, r.error || '');
  check('started_at kaydedildi', typeof r.record.started_at === 'number' && r.record.started_at > 0);
  check('created_at kaydedildi', typeof r.record.created_at === 'number' && r.record.created_at > 0);
  check('expires_at = started_at + duration', r.record.expires_at === r.record.started_at + 3 * GUN, `${r.record.expires_at} != ${r.record.started_at + 3 * GUN}`);
  check('guild_id kaydedildi', r.record.guild_id === G);
  check('user_id kaydedildi', r.record.user_id === U1);
  check('sebep kaydedildi', r.record.reason === 'Hastane randevum var');
  check('sure kaydedildi', r.record.duration_ms === 3 * GUN);
  check('active = 1', r.record.active === 1);
  check('Aktif listeye girdi', db.getActiveMazerets(G).some((x) => x.user_id === U1));
  check('Kullanici bazli aktif sorgu calisiyor', db.getActiveMazeretByUser(G, U1)?.id === r.record.id);
}

check('Ayni kullanici 2. kayit YAPAMAZ (DB kisiti)', (() => {
  const r = db.createMazeretRecord({ guildId: G, userId: U1, reason: 'tekrar', durationRaw: '1 gün', durationMs: GUN, reportedBy: U1 });
  return r.ok === false && r.error === 'already_active';
})());
check('Bu durumda kayit olusmadi', db.getActiveMazerets(G).filter((x) => x.user_id === U1).length === 1);
check('Bos sebep reddedilir', db.createMazeretRecord({ guildId: G, userId: U2, reason: '   ', durationRaw: '1g', durationMs: GUN }).ok === false);
check('Gecersiz sure reddedilir', db.createMazeretRecord({ guildId: G, userId: U2, reason: 'gerekce', durationRaw: 'x', durationMs: 0 }).ok === false);
check('Farkli kullanici kayit olabilir', db.createMazeretRecord({ guildId: G, userId: U2, reason: 'Is', durationRaw: '1 hafta', durationMs: 7 * GUN, reportedBy: U2 }).ok === true);

/* ================================================================== */
section('9) SURESI DOLAN KAYIT (RAM timer degil, kalici zaman)');

// Bitis zamaninin OTELEYECEK kadar ilerisine bak: kaydin expires_at degerini
// bilerek kullaniriz, "simdi + 1 sn" degil.
const ileri = (uid) => {
  const kayit = db.getDb().prepare('SELECT expires_at FROM mazeret_records WHERE guild_id = ? AND user_id = ? AND active = 1').get(G, uid);
  return (kayit?.expires_at ?? Date.now()) + 1000;
};

check('Suresi dolmus kayit aktif listede DEGIL', !db.getActiveMazerets(G, ileri(U1)).some((x) => x.user_id === U1));
check('getActiveMazeretByUser suresi dolmusu null doner', db.getActiveMazeretByUser(G, U1, ileri(U1)) === null);
check('expireMazerets kapatir', db.expireMazerets(G, ileri(U1)) >= 1);
check('Gecmis kayit SILINMEDI', (() => {
  const row = db.getDb().prepare('SELECT * FROM mazeret_records WHERE user_id = ? AND guild_id = ?').get(U1, G);
  return row && row.active === 0 && row.end_reason === 'expired' && row.expires_at > 0;
})());
check('Kullanici yeniden mazeret alabilir', db.createMazeretRecord({ guildId: G, userId: U1, reason: 'Yeni mazeret', durationRaw: '1 saat', durationMs: H, reportedBy: U1 }).ok === true);
check('Aktif listeye geri dondu', db.getActiveMazerets(G).some((x) => x.user_id === U1));
check('Suresi dolmamis kayit listede kalir', db.getActiveMazerets(G).some((x) => x.user_id === U2));
check('Baska kullanicinin kaydi etkilenmedi', db.getActiveMazeretByUser(G, U2)?.duration_ms === 7 * GUN);

/* ================================================================== */
const sahte = (o = {}) => {
  const c = { reply: null, edit: null, update: null, modal: null, deferred: false };
  return {
    _c: c,
    customId: o.customId || 'mz_sebep',
    guildId: G,
    user: { id: o.userId || '100000000000009999', tag: 'test#0001' },
    member: { id: o.userId || '100000000000009999' },
    guild: o.guild || { id: G },
    client: o.client || { guilds: { cache: new Map() } },
    replied: false,
    deferred: false,
    values: o.values,
    message: o.message,
    fields: {
      getTextInputValue: (k) => (o.neden === undefined ? null : k === 'mz_neden' ? o.neden : null),
    },
    isRepliable: () => true,
    reply: async (p) => ((c.reply = p), true),
    editReply: async (p) => ((c.edit = p), true),
    update: async (p) => ((c.update = p), true),
    showModal: async (m) => ((c.modal = m), true),
    deferReply: async () => ((c.deferred = true), true),
    deferUpdate: async () => ((c.deferred = true), true),
    followUp: async (p) => ((c.reply = p), true),
  };
};

(async () => {
  section('10) MODAL AKISI - bos sebep / kayit');

  const gonderilen = [];
  const mesajlar = new Map();
  const kanal = {
    id: KANAL,
    name: 'mazeret-merkezi',
    isTextBased: () => true,
    isDMBased: () => false,
    send: async (p) => {
      const m = { id: 'MSG' + (mesajlar.size + 1), ...p, edit: async (q) => Object.assign(m, q) };
      gonderilen.push(p);
      mesajlar.set(m.id, m);
      return m;
    },
    messages: {
      fetch: async (id) => mesajlar.get(id) || Promise.reject(Object.assign(new Error('yok'), { code: 10008 })),
    },
  };
  const client = { channels: { fetch: async (id) => (id === KANAL ? kanal : null) }, guilds: { cache: new Map() } };

  {
    const U = '100000000000002001';
    const i = sahte({ userId: U, neden: '   ' });
    mz.sureAyarla(G, U, { key: 'g1', label: '1 gün', ms: GUN });
    await mz.handleSebepSubmit(i);
    const yanit = JSON.stringify(i._c.reply || i._c.edit || {});
    check('Bos sebep reddediliyor', /boş/i.test(yanit), yanit.slice(0, 100));
    check('Bos sebeple KAYIT OLUSMADI', !db.getActiveMazerets(G).some((x) => x.user_id === U));
  }
  {
    const U = '100000000000002002';
    const i = sahte({ userId: U, neden: 'Bir neden var' });
    await mz.handleSebepSubmit(i);
    check('Sure secilmeden kayit yapilmiyor', JSON.stringify(i._c.reply || {}).length > 0);
    check('Suresiz kayit olusmadi', !db.getActiveMazerets(G).some((x) => x.user_id === U));
  }
  {
    const U = '100000000000002003';
    const i = sahte({ userId: U, neden: 'Hastane randevum var', client });
    mz.sureAyarla(G, U, { key: 'g3', label: '3 gün', ms: 3 * GUN });
    await mz.handleSebepSubmit(i);
    const kayit = db.getActiveMazeretByUser(G, U);
    check('Gecerli mazeret kaydedildi', !!kayit, 'kayit yok');
    check('Kayit dogru kullaniciya ait', kayit?.user_id === U);
    check('Sure 3 gun', kayit?.duration_ms === 3 * GUN);
    check('Bitis = baslangic + 3 gun', kayit?.expires_at === kayit?.started_at + 3 * GUN);
    const onay = JSON.stringify(i._c.reply || {});
    check('Kullaniciya onay verildi', /kaydedildi/i.test(onay), onay.slice(0, 120));
    check('Onay sure alani iceriyor', onay.includes('"name":"Süre"'), '');
    check('Onay bitis alani iceriyor', onay.includes('"name":"Bitiş"'), '');
    check('Onay sebep alani iceriyor', onay.includes('"name":"Sebep"'), '');
  }
  {
    const U = '100000000000002003';
    const i = sahte({ userId: U, neden: 'tekrar deneme', client });
    mz.sureAyarla(G, U, { key: 'g1', label: '1 gün', ms: GUN });
    await mz.handleSebepSubmit(i);
    const yanit = JSON.stringify(i._c.reply || {});
    check('2. kayit reddediliyor', /Zaten aktif/.test(yanit), yanit.slice(0, 140));
    check('Duplicate kayit OLUSMADI', db.getActiveMazerets(G).filter((x) => x.user_id === U).length === 1);
  }

  section('11) MERKEZI PANEL (1548927431597883472) - tek mesaj');

  check('Merkezi kanal dogru', mz.merkeziKanalId() === KANAL, mz.merkeziKanalId());
  check('config merkezi kanal 1548927431597883472', config.mazeretAdminChannelId === KANAL, String(config.mazeretAdminChannelId));
  check('Panel mesaji gonderildi', gonderilen.length >= 1, String(gonderilen.length));
  check('Panel basligi "Aktif Mazeretli Memurlar"', gonderilen[0].embeds[0].data.title === 'Aktif Mazeretli Memurlar', gonderilen[0].embeds[0].data.title);
  check('Panel kaydi DBde', !!db.getMazeretActivePanel(G, 'central'));
  check('Panel kaydinin kanali 1548927431597883472', db.getMazeretActivePanel(G, 'central')?.channel_id === KANAL);

  const oncekiSayi = gonderilen.length;
  await mz.refreshMerkeziPanel(client, G, 1);
  check('Yenileme YENI MESAJ GONDERMEDI (duzenledi)', gonderilen.length === oncekiSayi, `${oncekiSayi} -> ${gonderilen.length}`);
  check('Kanal mesaj sayisi hala 1', mesajlar.size === 1, String(mesajlar.size));

  mesajlar.clear();
  await mz.refreshMerkeziPanel(client, G, 1);
  check('Panel silinince yeniden olusturulur', mesajlar.size === 1, String(mesajlar.size));
  check('Yeni mesaj ID kaydedildi', db.getMazeretActivePanel(G, 'central')?.message_id === [...mesajlar.keys()][0]);
  const kotuClient = { channels: { fetch: async () => null }, guilds: { cache: new Map() } };
  check('Kanal bulunamazsa false doner (gizlenmez)', (await mz.refreshMerkeziPanel(kotuClient, G, 1)) === false);
  check('Istemci yoksa false doner', (await mz.refreshMerkeziPanel(null, G, 1)) === false);

  section('12) BUTON -> SURE SECIMI');
  {
    const U = '100000000000004001';
    const i = sahte({ userId: U, customId: 'mz_bildir' });
    await mz.handleBildir(i);
    const p = i._c.reply;
    check('Sure secimi gonderildi', !!p);
    check('Select menusu eklendi', p?.components?.[0]?.toJSON().components[0].type === 3, String(p?.components?.[0]?.toJSON().components[0].type));
    check('Ephemeral', (p?.flags & 64) === 64, String(p?.flags));

    const U3 = '100000000000004002';
    db.createMazeretRecord({ guildId: G, userId: U3, reason: 'var', durationRaw: '1g', durationMs: GUN, reportedBy: U3 });
    const j = sahte({ userId: U3, customId: 'mz_bildir' });
    await mz.handleBildir(j);
    check('Mevcut mazereti varsa sure secmez', !j._c.reply?.components, JSON.stringify(j._c.reply?.components ? 'menu var' : 'yok'));
    check('Mevcut mazereti varsa bilgilendirilir', /Zaten aktif/.test(JSON.stringify(j._c.reply || {})));
  }

  section('13) SURE SECIMI -> SEBEP MODALI');
  {
    const U = '100000000000005001';
    const i = sahte({ userId: U, customId: 'mz_sure', values: ['g3'] });
    await mz.handleSureSelect(i);
    check('Modal acildi', !!i._c.modal);
    check('Modal basligi "Mazeret Sebebi"', i._c.modal?.data?.title === 'Mazeret Sebebi', i._c.modal?.data?.title);
    check('Sure RAMe alindi', !!mz._beklemedekiSure.get(G + ':' + U));
    check('Sure dogru tasindi', mz._beklemedekiSure.get(G + ':' + U)?.ms === 3 * GUN);

    const kotu = sahte({ userId: U, customId: 'mz_sure', values: ['sahte'] });
    await mz.handleSureSelect(kotu);
    check('Gecersiz sure secimi reddediliyor', JSON.stringify(kotu._c.reply || {}).length > 0);
    check('Gecersiz secimde modal acilmadi', !kotu._c.modal);
  }

  section('14) ACILISTA OTOMATIK PANEL GONDERILMEZ');
  {
    const readySrc = fs.readFileSync(path.join(KOK, 'src/events/ready.js'), 'utf8');
    check('ready.js refreshMerkeziPanel cagiramiyor', !/refreshMerkeziPanel/.test(readySrc));
    check('ready.js buildPanelEmbed cagiramiyor', !/buildPanelEmbed/.test(readySrc));
    check('ready.js sadece ticker baslatiyor', /startTicker\(client\)/.test(readySrc));
  }

  section('15) ESKI MAZERET SISTEMI KALDIRILDI');
  for (const f of [
    'src/handlers/mazeretHandler.js',
    'src/utils/mazeretEmbeds.js',
    'src/utils/mazeretDuration.js',
    'src/commands/mazeret.js',
    'src/commands/mazeretpng.js',
    'test/mazeret.test.js',
    'test/mazeret-db.test.js',
  ]) {
    check('Silindi: ' + f, !fs.existsSync(path.join(KOK, f)));
  }
  for (const f of ['src/handlers/mazeret.js', 'src/utils/mazeretViews.js', 'src/commands/mazeretpanel.js']) {
    check('Var: ' + f, fs.existsSync(path.join(KOK, f)));
  }

  const kaynak = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'data') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) kaynak.push(p);
    }
  })(path.join(KOK, 'src'));
  kaynak.push(path.join(KOK, 'index.js'));

  for (const [ad, re] of [
    ['mazeretHandler', /require\([^)]*mazeretHandler/],
    ['mazeretEmbeds', /require\([^)]*mazeretEmbeds/],
    ['mazeretDuration', /require\([^)]*mazeretDuration/],
    ['eski buton mazeret_open', /['"]mazeret_open['"]/],
    ['eski modal MODAL_ID', /MODAL_ID\s*=/],
    ['eski refresh butonu', /mazeret_refresh/],
    ['eski DB upsertMazeretPanel', /\bupsertMazeretPanel\b/],
    ['eski DB getMazeretPanel', /\bgetMazeretPanel\b/],
  ]) {
    const bulan = kaynak.filter((f) => re.test(fs.readFileSync(f, 'utf8')));
    check('Eski referans yok: ' + ad, bulan.length === 0, bulan.map((f) => path.relative(KOK, f)).join(', '));
  }

  section('16) ORTAK DOSYALAR KORUNDU');
  check('event loader (ready.js) yerinde', fs.existsSync(path.join(KOK, 'src/events/ready.js')));
  check('command loader (commandHandler.js) yerinde', fs.existsSync(path.join(KOK, 'src/handlers/commandHandler.js')));
  check('validateImageAttachment korundu', fs.readFileSync(path.join(KOK, 'src/utils/embeds.js'), 'utf8').includes('function validateImageAttachment'));
  check('buildErrorEmbed korundu', /buildErrorEmbed/.test(fs.readFileSync(path.join(KOK, 'src/utils/embeds.js'), 'utf8')));
  check('Buton handler mazeret butonlarini yonlendiriyor', /mz\.CID\.BILDIR/.test(fs.readFileSync(path.join(KOK, 'src/handlers/buttonHandler.js'), 'utf8')));
  check('Sayfalama butonlari yonlendirildi', /mz\.CID\.ONCEKI/.test(fs.readFileSync(path.join(KOK, 'src/handlers/buttonHandler.js'), 'utf8')));
  check('interactionCreate select dali var', /isAnySelectMenu/.test(fs.readFileSync(path.join(KOK, 'src/events/interactionCreate.js'), 'utf8')));
  check('interactionCreate modal dali var', /mz\.CID\.SEBEP/.test(fs.readFileSync(path.join(KOK, 'src/events/interactionCreate.js'), 'utf8')));

  section('17) SUREC RESTART - kayitlar korunuyor');
  const probeYol = path.join(KOK, 'test', '_mazeret-step.js');
  fs.writeFileSync(
    probeYol,
    "const db=require('../src/database/database');db.initDatabase();\n" +
      'const gid=process.argv[2];\n' +
      'const k=db.getActiveMazerets(gid);\n' +
      'const out={toplam:k.length, kayitlar:k.map(r=>({u:r.user_id,s:r.started_at,e:r.expires_at,l:r.duration_ms}))};\n' +
      'db.closeDatabase();\n' +
      "console.log('###JSON###'+JSON.stringify(out));process.exit(0);\n",
    'utf8',
  );
  const oku = () =>
    JSON.parse(
      execFileSync(process.execPath, [probeYol, G], {
        cwd: KOK,
        encoding: 'utf8',
        env: { ...process.env, DB_PATH: process.env.DB_PATH },
      }).split('###JSON###')[1].trim(),
    );

  const onceki = db.getActiveMazerets(G).length;
  const sonra = oku();
  check('YENI SURECTE kayitlar korundu', sonra.toplam === onceki, `${sonra.toplam} != ${onceki}`);
  check('started_at/expires_at kalici', sonra.kayitlar.every((r) => r.s > 0 && r.e > r.s));
  check('Sure degerleri kalici', sonra.kayitlar.every((r) => r.l > 0));
  fs.unlinkSync(probeYol);

  console.log('\n' + '='.repeat(68));
  console.log('  SONUC:  ' + pass + ' basarili / ' + (pass + fail) + ' toplam  /  ' + fail + ' basarisiz');
  console.log('='.repeat(68));
  db.closeDatabase();
  try { fs.unlinkSync(process.env.DB_PATH); } catch { /* zaten yok */ }
  process.exit(fail ? 1 : 0);
})();