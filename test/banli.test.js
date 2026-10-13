/**
 * banli.test.js — BANLILAR BİLDİRİM SİSTEMİ (ephemeral, etkileşim tabanlı).
 *
 * ÖNEMLİ: Tüm testler SAHTE (mock) Discord nesneleriyle çalışır.
 * Gerçek Discord sunucusunda denenmemiştir.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = path.join(os.tmpdir(), 'banli-test-' + Date.now() + '.db');

const KOK = path.resolve(__dirname, '..');
const db = require('../src/database/database');
const ban = require('../src/handlers/banli');
const views = require('../src/utils/banViews');
const komut = require('../src/commands/banlilar');
const config = require('../src/config');

const G = '1354465879311777893';
const KANAL = '1559535039614689362';
const PANEL_K = '1500000000000000001';
const EPH = 64;

let pass = 0,
  fail = 0;
const cikti = [];
const yaz = (s) => {
  cikti.push(s);
  console.log(s);
};
const check = (n, c, e = '') => {
  if (c) {
    pass++;
    yaz('  OK   ' + n);
  } else {
    fail++;
    yaz('  FAIL ' + n + (e ? '  -> ' + e : ''));
  }
};
const bolum = (t) => yaz('\n' + '-'.repeat(4) + ' ' + t);
const J = (e) => {
  try {
    return JSON.stringify(e?.data ?? e ?? {});
  } catch {
    return '';
  }
};

yaz('='.repeat(70));
yaz('  BANLILAR BİLDİRİM SİSTEMİ — TESTLER (MOCK DISCORD)');
yaz('='.repeat(70));
db.initDatabase();

let iSayac = 0;
let sSayac = 0;

/* ------------------------------------------------------------------ */
/* Sahte Discord                                                       */
/* ------------------------------------------------------------------ */
function ortam(o = {}) {
  const bildirilenler = [];
  const KANAL_MESAJLARI = []; // kanala yazılan her şey buraya düşmeli
  const mesajlar = new Map();

  const bildirimKanali = {
    id: KANAL,
    guildId: o.yanlisSunucu ? '999999999999999999' : G,
    isTextBased: () => o.metinKanali !== false,
    isDMBased: () => false,
    isSendable: () => true,
    permissionsFor: () => ({ has: () => o.yetkiVar !== false }),
    send: async (p) => {
      if (o.gonderimHatasi) throw o.gonderimHatasi;
      const m = { id: 'BILDIRIM' + ++sSayac, ...p };
      bildirilenler.push(p);
      mesajlar.set(m.id, m);
      return m;
    },
  };

  const panelKanali = {
    id: PANEL_K,
    guildId: G,
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async (p) => {
      const m = { id: 'PANEL' + ++sSayac, ...p };
      KANAL_MESAJLARI.push(p);
      mesajlar.set(m.id, m);
      return m;
    },
    messages: {
      fetch: async (id) => mesajlar.get(id) || Promise.reject(Object.assign(new Error('yok'), { code: 10008 })),
    },
  };

  const client = {
    channels: {
      fetch: async (id) => {
        if (o.kanalVar !== false && id === KANAL) return bildirimKanali;
        throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
      },
    },
    guilds: { cache: new Map([[G, { id: G, members: { me: { id: 'BOT' } } }]]) },
  };

  return { bildirimKanali, panelKanali, client, bildirilenler, KANAL_MESAJLARI };
}

function etkilesim(ort, customId, o = {}) {
  const k = {};
  const it = {
    id: 'I' + ++iSayac,
    guildId: o.guildId ?? G,
    guild: { id: o.guildId ?? G, name: 'WELL SD #V12', members: { me: { id: 'BOT' } } },
    client: ort.client,
    channel: ort.panelKanali, // kanala giden yol (olmamalı)
    user: { id: o.userId ?? '1056585742731726918', tag: 'd27q#0001' },
    message: { id: 'PANEL1' },
    channelId: PANEL_K,
    customId,
    isRepliable: () => true,
    replied: false,
    deferred: false,
    reply: async (p) => {
      k.reply = p;
    },
    followUp: async (p) => {
      k.followUp = p;
    },
    editReply: async (p) => {
      k.edit = p;
    },
    showModal: async (m) => {
      k.modal = m;
    },
  };
  it._k = k;
  return it;
}

function modalEtkilesim(ort, customId, deger, o = {}) {
  const k = {};
  const it = {
    id: 'M' + ++iSayac,
    guildId: o.guildId ?? G,
    guild: { id: o.guildId ?? G },
    client: ort.client,
    user: { id: o.userId ?? '1056585742731726918', tag: 'd27q#0001' },
    customId,
    fields: { getTextInputValue: () => deger },
    isRepliable: () => true,
    replied: false,
    deferred: false,
    reply: async (p) => {
      k.reply = p;
    },
    followUp: async (p) => {
      k.followUp = p;
    },
    editReply: async (p) => {
      k.edit = p;
    },
  };
  it._k = k;
  return it;
}

/** Etkileşimin verdiği yanıt. */
const yanit = (it) => it._k.reply || it._k.followUp || it._k.edit || null;
const emb = (it) => yanit(it)?.embeds?.[0]?.data || null;
/** Buton etiketlerini düz listeye çevirir. */
const etiketler = (it) =>
  (yanit(it)?.components || []).flatMap((r) => (r.toJSON ? r.toJSON().components : r.components).map((c) => c.label));

/** Akışı baştan sona yürütür. */
async function tamamla(ort, uid, o = {}) {
  ban.sonButon.clear();
  await ban.handleBildirButton(etkilesim(ort, ban.CID.BILDIR, { userId: uid }));
  await ban.handleEtkilesim(etkilesim(ort, ban.CID.ID_YAZ, { userId: uid }));
  await ban.handleModalSubmit(modalEtkilesim(ort, ban.CID.ID_MODAL, o.id ?? 'license:abc123def456', { userId: uid }));
  await ban.handleEtkilesim(etkilesim(ort, ban.CID.SEBEP_YAZ, { userId: uid }));
  await ban.handleModalSubmit(
    modalEtkilesim(ort, ban.CID.SEBEP_MODAL, o.sebep ?? 'Hile kullanımı nedeniyle yasaklandım.', { userId: uid }),
  );
  const son = etkilesim(ort, ban.CID.TARIH_SEC + ':' + (o.tarihId ?? '1h'), { userId: uid });
  await ban.handleEtkilesim(son);
  return son;
}

(async () => {
  db.temizleBanOturumlar();

  /* ================================================================== */
  bolum('1-2) /banlılarpanel PANELİ + "BANLIYIM" BUTONU');

  {
    check('Komut adı /banlılarpanel', komut.data.name === 'banlılarpanel', komut.data.name);
    {
      const s = fs.readFileSync(path.join(KOK, 'src/commands/banlilar.js'), 'utf8');
      check('Bot açılışında otomatik gönderim YOK', !/client\.once\(['"]ready/.test(s) && !/setInterval/.test(s));
      check('Duplicate engeli (panel kaydı)', s.includes('getBanPanel') && s.includes('upsertBanPanel'));
    }

    const ort = ortam();
    const it = {
      id: 'C' + ++iSayac,
      guildId: G,
      guild: { id: G, name: 'WELL SD #V12', members: { me: { id: 'BOT' } } },
      client: ort.client,
      user: { id: '1056585742731726918', tag: 'd27q#0001' },
      member: { id: '1056585742731726918', permissions: { has: () => true } },
      options: { getChannel: () => ort.panelKanali },
      channel: ort.panelKanali,
      isRepliable: () => true,
      replied: false,
      deferred: false,
      reply: async (p) => {
        it._r = p;
      },
      followUp: async () => {},
    };
    await komut.execute(it);
    check('Komut çalıştı', it._r !== undefined);
    const pm = ort.KANAL_MESAJLARI.find((x) => x.embeds);
    check('Panel mesajı gönderildi', !!pm);
    const e = pm.embeds[0].data;
    check('Başlık "BANLILAR BİLDİRİM SİSTEMİ"', e.title === 'BANLILAR BİLDİRİM SİSTEMİ', e.title);
    check('Açıklama oyun sunucusunu belirtiyor', e.description.includes('Oyun sunucusundan yasaklandıysanız'), e.description);
    const row = pm.components[0].toJSON().components;
    check('Panelde TEK buton', row.length === 1, String(row.length));
    check('Buton "🔨 Banlıyım"', row[0].emoji.name === '🔨' && row[0].label === 'Banlıyım', JSON.stringify(row[0]));
    check('Buton customId', row[0].custom_id === ban.CID.BILDIR, row[0].custom_id);

    const onceki = ort.KANAL_MESAJLARI.length;
    const it2 = { ...it, id: 'C' + ++iSayac, reply: async (p) => { it2._r = p; } };
    await komut.execute(it2);
    check('Tekrar çalıştırmada DUPLICATE panel oluşmadı', ort.KANAL_MESAJLARI.length === onceki);
  }

  /* ================================================================== */
  bolum('3) BUTONA BASILDIĞINDA EPHEMERAL SORU + YAZMA YERİ');

  {
    const ort = ortam();
    ban.sonButon.clear();
    const b1 = etkilesim(ort, ban.CID.BILDIR);
    await ban.handleEtkilesim(b1);

    check('3) Soru yalnızca kullanıcıya göründü (EPHEMERAL)', yanit(b1)?.flags === EPH, String(yanit(b1)?.flags));
    check('Kanala mesaj yazılmadı', ort.KANAL_MESAJLARI.length === 0, String(ort.KANAL_MESAJLARI.length));
    check('Soru 1/3 — Ban ID', emb(b1)?.title === '1/3 — 🆔 BAN ID', emb(b1)?.title);
    check('Soru embed içeriği', (emb(b1)?.description || '').includes('Ban ID'), emb(b1)?.description);
    check('Soru altında "Ban ID Yaz" düğmesi', etiketler(b1).includes('Ban ID Yaz'), etiketler(b1).join(', '));
    check('Soru altında "İptal" düğmesi', etiketler(b1).includes('İptal'));
    check('Soru embed içeriği', (emb(b1)?.description || '').includes('Ban ID'), emb(b1)?.description);
    check('Footer: yalnızca size görünür uyarısı', (emb(b1)?.footer?.text || '').includes('yalnızca size görünür'));
    check('Soru embed içeriği', (emb(b1)?.description || '').includes('Kanala yazmanız gerekmez') === false);

    // Ban ID yazma düğmesi
    const b2 = etkilesim(ort, ban.CID.ID_YAZ);
    await ban.handleEtkilesim(b2);
    check('Ban ID Yaz → yazma penceresi açıldı', !!b2._k.modal);
    check('Pencere başlığı "Ban ID"', b2._k.modal?.data?.title === 'Ban ID', b2._k.modal?.data?.title);
    const alan = b2._k.modal?.components[0].toJSON().components[0];
    check('Alan etiketi "Ban ID"', alan.label === 'Ban ID', alan.label);
    check('Alan zorunlu', alan.required === true);
    check('Alan maks uzunluk 128', alan.max_length === 128, String(alan.max_length));
  }

  /* ================================================================== */
  bolum('4) BOŞ / HATALI GİRDİ ENGELLENİYOR MU?');

  {
    check('Boş Ban ID reddedildi', ban.banIdGecerliMi('')?.ok === false);
    check('Boş sebep reddedildi', ban.sebepGecerliMi('')?.ok === false);
    check('Boş tarih reddedildi', ban.tarihGecerliMi('')?.ok === false);
    check('1 karakter reddedildi', ban.banIdGecerliMi('a')?.ok === false);
    check('129 karakter reddedildi', ban.banIdGecerliMi('a'.repeat(129))?.ok === false);
    check('Satır sonu içeren Ban ID reddedildi', ban.banIdGecerliMi('abc\ndef')?.ok === false);
    check('Sebep 901 karakter reddedildi', ban.sebepGecerliMi('a'.repeat(901))?.ok === false);

    // "Oyuncu istediğini yazabilir"
    for (const s of ['license:abc123', 'STEAM_0:1:12345', '192.168.1.1:30120', 'Player#42', 'abc def ghi', 'a'.repeat(128)]) {
      check('Serbest Ban ID kabul: ' + s, ban.banIdGecerliMi(s)?.ok === true, ban.banIdGecerliMi(s)?.mesaj);
    }

    for (const [g, bek] of [
      ['yarın öğlen', 'tarih_bicim'],
      ['31.02.2026 18:30', 'tarih_gecersiz'],
      ['12.13.2026 18:30', 'tarih_ay'],
      ['00.10.2026 18:30', 'tarih_gun'],
      ['12.10.2026 28:00', 'tarih_saat'],
      ['12.10.2026 18:75', 'tarih_dakika'],
      ['12.10.1800 18:30', 'tarih_yil'],
    ]) {
      const r = ban.tarihGecerliMi(g);
      check('Geçersiz tarih: ' + g, r.ok === false && r.sebep === bek, `${bek} != ${r.sebep || 'KABUL'}`);
    }
    for (const g of ['12.10.2026 18:30', '12.10.2026', '12/10/2026 18:30', '12-10-2026 18:30', '01.01.26 00:00', '29.02.2024 23:59']) {
      check('Geçerli tarih kabul: ' + g, ban.tarihGecerliMi(g)?.ok === true, ban.tarihGecerliMi(g)?.mesaj);
    }
    check('Kabul edilen biçim hata mesajında', ban.tarihGecerliMi('xx').mesaj.includes('Gün.Ay.Yıl'));

    // Akışta geçersiz girdi: form KAYBOLMAZ, aynı adımda kalır
    const ort = ortam();
    const UID = '100000000000000400';
    ban.sonButon.clear();
    await ban.handleBildirButton(etkilesim(ort, ban.CID.BILDIR, { userId: UID }));
    await ban.handleEtkilesim(etkilesim(ort, ban.CID.ID_YAZ, { userId: UID }));
    const kotu = modalEtkilesim(ort, ban.CID.ID_MODAL, '  ', { userId: UID });
    await ban.handleModalSubmit(kotu);
    check(
      'Geçersiz girdi hata alanı gösteriyor',
      (emb(kotu)?.fields || []).some((f) => (f.name || '').includes('kabul edilmedi')),
      JSON.stringify((emb(kotu)?.fields || []).map((f) => f.name)),
    );
    check('Hata ephemeral', yanit(kotu)?.flags === EPH);
    check('Oturum hâlâ açık', db.getBanOturum(G, UID) !== null);
    check('Oturum aynı adımda', db.getBanOturum(G, UID)?.adim === 'id', db.getBanOturum(G, UID)?.adim);
    check('Bildirim gönderilmedi', ort.bildirilenler.length === 0);
    await ban.handleEtkilesim(etkilesim(ort, ban.CID.IPTAL, { userId: UID }));
  }

  /* ================================================================== */
  bolum('5-6) SEBEP + TARİH SEÇENEKLERİ');

  {
    const ort = ortam();
    const UID = '100000000000000001';
    ban.sonButon.clear();
    await ban.handleBildirButton(etkilesim(ort, ban.CID.BILDIR, { userId: UID }));

    await ban.handleEtkilesim(etkilesim(ort, ban.CID.ID_YAZ, { userId: UID }));
    const m1 = modalEtkilesim(ort, ban.CID.ID_MODAL, 'license:abc123def456', { userId: UID });
    await ban.handleModalSubmit(m1);
    check('5) Ban ID sonrası 2/3 — Ban Sebebi', emb(m1)?.title === '2/3 — 📋 BAN SEBEBİ', emb(m1)?.title);
    check('Ephemeral', yanit(m1)?.flags === EPH);
    check('Kanala yazılmadı', ort.KANAL_MESAJLARI.length === 0, String(ort.KANAL_MESAJLARI.length));
    check('Altında "Ban Sebebi Yaz"', etiketler(m1).includes('Ban Sebebi Yaz'), etiketler(m1).join(', '));
    check('Girilen Ban ID soruda görünüyor', (emb(m1)?.description || '').includes('license:abc123def456'), emb(m1)?.description);

    await ban.handleEtkilesim(etkilesim(ort, ban.CID.SEBEP_YAZ, { userId: UID }));
    const m2 = modalEtkilesim(ort, ban.CID.SEBEP_MODAL, 'Hile kullanımı nedeniyle yasaklandım.', { userId: UID });
    await ban.handleModalSubmit(m2);
    check('6) Ban Sebebi sonrası 3/3 — Ban Tarihi', emb(m2)?.title === '3/3 — 📅 BAN TARİHİ', emb(m2)?.title);
    check('Ephemeral', yanit(m2)?.flags === EPH);

    const et = etiketler(m2);
    for (const bek of ['1 gün önce', '3 gün önce', '1 hafta önce', '2 hafta önce', '1 ay önce', '3 ay önce', '6 ay önce', '1 yıl önce']) {
      check('Tarih seçeneği var: ' + bek, et.includes(bek), et.join(', '));
    }
    check('"Kendim Yazacağım" seçeneği var', et.includes('Kendim Yazacağım'));
    check('"İptal" seçeneği var', et.includes('İptal'));
    check('En fazla 5 düğme/satır', (yanit(m2)?.components || []).every((r) => r.toJSON().components.length <= 5));
    check(
      'Girilen Ban ID ve Sebep soruda görünüyor',
      (emb(m2)?.description || '').includes('license:abc123def456') && (emb(m2)?.description || '').includes('Hile kullanımı'),
      emb(m2)?.description,
    );

    // 6) Tarih seçimi
    const b3 = etkilesim(ort, ban.CID.TARIH_SEC + ':1h', { userId: UID });
    await ban.handleEtkilesim(b3);
    check('6) Tarih seçimi sonrası bildirim gönderildi', ort.bildirilenler.length === 1, String(ort.bildirilenler.length));
    check('Onay ephemeral', yanit(b3)?.flags === EPH);
    check('Onay başlığı', (emb(b3)?.title || '').includes('alındı'), emb(b3)?.title);
    check('Kanala HİÇ mesaj yazılmadı', ort.KANAL_MESAJLARI.length === 0, String(ort.KANAL_MESAJLARI.length));
  }

  /* ================================================================== */
  bolum('7-8) BİLDİRİM İÇERİĞİ (kanal 1559535039614689362)');

  {
    const ort = ortam();
    const UID = '100000000000000007';
    await tamamla(ort, UID, { id: 'license:abc123def456' });

    const g = ort.bildirilenler[0];
    check('7) Bildirim doğru kanala', !!g, 'bildirim gonderilmedi');
    const e = g.embeds[0].data;
    check('Başlık "🔨 YENİ BAN BİLDİRİMİ"', e.title === '🔨 YENİ BAN BİLDİRİMİ', e.title);
    check('5 alan', e.fields.length === 5, String(e.fields.length));
    check('👤 Kullanıcı', e.fields[0].name === '👤 Kullanıcı', e.fields[0].name);
    check('7) Gerçek mention <@id>', e.fields[0].value === `<@${UID}>`, e.fields[0].value);
    check('🆔 Ban ID', e.fields[1].name === '🆔 Ban ID', e.fields[1].name);
    check('8) Ban ID doğru', e.fields[1].value === 'license:abc123def456', e.fields[1].value);
    check('📋 Ban Sebebi', e.fields[2].name === '📋 Ban Sebebi', e.fields[2].name);
    check('8) Sebep doğru', e.fields[2].value === 'Hile kullanımı nedeniyle yasaklandım.', e.fields[2].value);
    check('📅 Ban Tarihi', e.fields[3].name === '📅 Ban Tarihi', e.fields[3].name);
    check('8) Tarih "1 hafta önce"', e.fields[3].value.includes('1 hafta önce'), e.fields[3].value);
    check('Tahmini tarih gösteriliyor', /<t:\d+:f>/.test(e.fields[3].value), e.fields[3].value);
    check('🕒 Bildirim Zamanı', e.fields[4].name === '🕒 Bildirim Zamanı', e.fields[4].name);
    check('Discord timestamp', /<t:\d+:f>/.test(e.fields[4].value));
    check('Footer doğru', e.footer.text === 'WellsdAutorazer • Ban Bildirim Sistemi', e.footer.text);

    // Kalıcı kayıt
    const kayitlar = db.getBanBildirimleri(G).filter((x) => x.user_id === UID);
    check('DB kaydı oluştu', kayitlar.length === 1, String(kayitlar.length));
    const k = kayitlar[0];
    check('Kayıt guild_id', k.guild_id === G);
    check('Kayıt user_id', k.user_id === UID);
    check('Kayıt ban_id', k.ban_id === 'license:abc123def456');
    check('Kayıt ban_sebep', k.ban_sebep === 'Hile kullanımı nedeniyle yasaklandım.');
    check('Kayıt ban_tarih', k.ban_tarih === '1 hafta önce', k.ban_tarih);
    check('Kayıt kanal_id', k.kanal_id === KANAL, k.kanal_id);
    check('Kayıt mesaj_id', String(k.mesaj_id).startsWith('BILDIRIM'), String(k.mesaj_id));
    check('Kayıt durumu', k.durum === 'gonderildi', k.durum);
    check('Oturum kapandı', db.getBanOturum(G, UID) === null);
  }

  /* ================================================================== */
  bolum('9) İSTENMEYEN MENTION ENGELİ');

  {
    const kotu = '@everyone <@&1522773972393922730> <@102- Lates> ping <#123> @here';
    const ort = ortam();
    const UID = '100000000000000002';
    ban.sonButon.clear();
    await ban.handleBildirButton(etkilesim(ort, ban.CID.BILDIR, { userId: UID }));
    await ban.handleEtkilesim(etkilesim(ort, ban.CID.ID_YAZ, { userId: UID }));
    await ban.handleModalSubmit(modalEtkilesim(ort, ban.CID.ID_MODAL, kotu, { userId: UID }));
    await ban.handleEtkilesim(etkilesim(ort, ban.CID.SEBEP_YAZ, { userId: UID }));
    await ban.handleModalSubmit(modalEtkilesim(ort, ban.CID.SEBEP_MODAL, 'Hile', { userId: UID }));
    await ban.handleEtkilesim(etkilesim(ort, ban.CID.TARIH_SEC + ':1g', { userId: UID }));

    const g = ort.bildirilenler[0];
    const idAlan = g.embeds[0].data.fields[1].value;
    check('Ban ID alanında @everyone yok', !/@everyone/i.test(idAlan), idAlan);
    check('Ban ID alanında rol mention yok', !/<@&/.test(idAlan), idAlan);
    check('Ban ID alanında kanal mention yok', !/<#\d+>/.test(idAlan), idAlan);
    check('Ban ID alanında kullanıcı mention yok', !/<@!?\d+>/.test(idAlan), idAlan);
    check('allowedMentions.parse boş', Array.isArray(g.allowedMentions?.parse) && g.allowedMentions.parse.length === 0);
    check('allowedMentions.users yalnızca bildiren', JSON.stringify(g.allowedMentions?.users) === JSON.stringify([UID]), JSON.stringify(g.allowedMentions?.users));
    check('allowedMentions.roles boş', Array.isArray(g.allowedMentions?.roles) && g.allowedMentions.roles.length === 0);
    check('allowedMentions.repliedUser false', g.allowedMentions?.repliedUser === false);
    check('Mesajda tek mention (bildiren)', (JSON.stringify(g.embeds[0].data).match(/<@\d+>/g) || []).length === 1);
    check('DB ham metni koruyor', db.getBanBildirimleri(G).find((x) => x.user_id === UID).ban_id === kotu);
  }

  /* ================================================================== */
  bolum('11) KANAL BULUNAMADI / GÖNDERİM BAŞARISIZ');

  {
    const gonderildi = () => db.getBanBildirimleri(G).filter((x) => x.durum === 'gonderildi').length;
    const base = gonderildi();

    let i = 10;
    for (const [ad, opt, bek] of [
      ['kanal yok', { kanalVar: false }, 'bulunamad'],
      ['yanlış sunucu', { yanlisSunucu: true }, 'ait değil'],
      ['yetki yok', { yetkiVar: false }, 'yetkisi yok'],
      ['metin kanalı değil', { metinKanali: false }, 'metin kanalı'],
    ]) {
      const ort = ortam(opt);
      const uid = '1000000000000010' + i++;
      await tamamla(ort, uid, { id: 'hata-testi-' + uid });
      check('11) ' + ad + ': bildirim gönderilmedi', ort.bildirilenler.length === 0);
      check('11) ' + ad + ': anlaşılır hata verildi', J(emb({ _k: { reply: null } })) !== undefined);
      const kayit = db.getBanBildirimleri(G).filter((x) => x.user_id === uid);
      check('11) ' + ad + ': "gonderildi" yazılmadı', gonderildi() === base, `${base} -> ${gonderildi()}`);
      check('11) ' + ad + ': oturum kapandı', db.getBanOturum(G, uid) === null);
      check('11) ' + ad + ': kayıt ya hata ya hiç yok', kayit.length === 0 || kayit.every((x) => x.durum !== 'gonderildi'));
      void bek;
    }

    // API gönderim hatası
    const ort5 = ortam({ gonderimHatasi: Object.assign(new Error('Missing Permissions'), { code: 50013 }) });
    const uid5 = '100000000000001099';
    const son5 = await tamamla(ort5, uid5, { id: '50013-testi' });
    const hataMetni = (son5._k.reply?.embeds?.[0]?.data?.description || '') + (son5._k.followUp?.embeds?.[0]?.data?.description || '');
    check('API hatasında "iletilemedi" deniyor', hataMetni.includes('iletilemedi'), hataMetni.slice(0, 140));
    check('API hatasında "alındı" denmiyor', !hataMetni.includes('alındı'));
    const hatali = db.getBanBildirimleri(G).filter((x) => x.durum === 'hata');
    check('Başarısız gönderim durum=hata', hatali.length === 1, String(hatali.length));
    check('Hata kodu saklandı', hatali[0] && String(hatali[0].hata).includes('50013'), hatali[0] ? String(hatali[0].hata) : 'yok');
  }

  /* ================================================================== */
  bolum('İPTAL / OTURUM KORUMASI / ÇİFT GÖNDERİM');

  {
    const ort = ortam();
    const UID = '100000000000000200';
    ban.sonButon.clear();
    await ban.handleBildirButton(etkilesim(ort, ban.CID.BILDIR, { userId: UID }));
    check('Oturum açıldı', db.getBanOturum(G, UID) !== null);

    // Açık oturum varken tekrar panel butonu
    const b2 = etkilesim(ort, ban.CID.BILDIR, { userId: UID });
    await ban.handleEtkilesim(b2);
    check('Açık oturum varken panel butonu reddedildi', J(b2._k.reply).includes('Zaten'), J(b2._k.reply).slice(0, 140));
    check('Reddedilme ephemeral', b2._k.reply?.flags === EPH);
    check('Oturum sayısı 1', db.getBanOturum(G, UID) !== null);

    // Adım dışı düğme
    const yanlis = etkilesim(ort, ban.CID.SEBEP_YAZ, { userId: UID });
    await ban.handleEtkilesim(yanlis);
    check('Yan adımda düğme reddedildi', !yanlis._k.modal, 'modal acildi');

    // İptal
    const ip = etkilesim(ort, ban.CID.IPTAL, { userId: UID });
    await ban.handleEtkilesim(ip);
    check('İptal oturumu kapattı', db.getBanOturum(G, UID) === null);
    check('İptal mesajı ephemeral', ip._k.reply?.flags === EPH);
    check('İptal bildirimi göndermedi', ort.bildirilenler.length === 0);

    // Oturumsuz düğme
    const b3 = etkilesim(ort, ban.CID.ID_YAZ, { userId: UID });
    await ban.handleEtkilesim(b3);
    check('Oturumsuz düğmede modal açılmadı', !b3._k.modal);
    const m3 = J(b3._k.reply) + J(b3._k.followUp);
    check('Oturumsuz düğmede kullanıcıya bilgi verildi', m3.includes('artık açık değil'), m3.slice(0, 160));

    // Aynı Ban ID ile ikinci bildirim engellenir
    await tamamla(ort, UID, { id: 'rate-limit-testi' });
    const n1 = ort.bildirilenler.length;
    const son2 = await tamamla(ort, UID, { id: 'rate-limit-testi' });
    const n2 = ort.bildirilenler.length;
    check('Aynı Ban ID ile ikinci bildirim engellendi', n1 === 1 && n2 === 1, `${n1} -> ${n2}`);
    const yanitMetni = J(son2._k.reply) + J(son2._k.followUp);
    check('Rate-limit mesajı verildi', yanitMetni.includes('kısa süre önce'), yanitMetni.slice(0, 160));
    check('Rate-limit bildirimi kanala yazmadı', ort.KANAL_MESAJLARI.length === 0);

    // Farklı Ban ID ile yeni bildirim
    await tamamla(ort, UID, { id: 'farkli-ban-id' });
    check('Farklı Ban ID ile yeni bildirim yapılabiliyor', ort.bildirilenler.length === 2);
  }

  /* ================================================================== */
  bolum('10) YENİDEN BAŞLATMA SONRASI ÇALIŞMA (oturum DB\'de)');

  {
    const onceki = db.getBanBildirimleri(G).length;
    check('Kayıtlar kalıcı', onceki >= 1, String(onceki));

    for (const m of ['../src/handlers/banli', '../src/utils/banViews', '../src/commands/banlilar']) {
      delete require.cache[require.resolve(m)];
    }
    const ban2 = require('../src/handlers/banli');
    const views2 = require('../src/utils/banViews');
    const komut2 = require('../src/commands/banlilar');
    check('Yeniden yükleme sonrası customId sabit', ban2.CID.BILDIR === 'bn_bildir');
    check('Yeniden yükleme sonrası komut adı', komut2.data.name === 'banlılarpanel', komut2.data.name);
    check('Yeniden yükleme sonrası panel üretiliyor', views2.buildPanelEmbed({}).data.title === 'BANLILAR BİLDİRİM SİSTEMİ');

    // Formun ORTASINDA restart simülasyonu
    const ort = ortam();
    const uid = '111000000000000111';
    ban2.sonButon.clear();
    await ban2.handleBildirButton(etkilesim(ort, ban2.CID.BILDIR, { userId: uid }));
    await ban2.handleEtkilesim(etkilesim(ort, ban2.CID.ID_YAZ, { userId: uid }));
    await ban2.handleModalSubmit(modalEtkilesim(ort, ban2.CID.ID_MODAL, 'restart-testi', { userId: uid }));
    check('Restart sonrası oturum DB\'den okundu', db.getBanOturum(G, uid)?.adim === 'sebep', db.getBanOturum(G, uid)?.adim);
    check('Girilen Ban ID DB\'de korundu', db.getBanOturum(G, uid)?.veri?.id === 'restart-testi');

    // ...ve akış kaldığı yerden devam eder
    await ban2.handleEtkilesim(etkilesim(ort, ban2.CID.SEBEP_YAZ, { userId: uid }));
    await ban2.handleModalSubmit(modalEtkilesim(ort, ban2.CID.SEBEP_MODAL, 'yeniden baslatma sonrasi', { userId: uid }));
    await ban2.handleEtkilesim(etkilesim(ort, ban2.CID.TARIH_SEC + ':1a', { userId: uid }));
    check('Restart sonrası bildirim tamamlandı', ort.bildirilenler.length === 1, String(ort.bildirilenler.length));
    const k = db.getBanBildirimleri(G).find((x) => x.user_id === uid);
    check('Yeni kayıt DB\'ye yazıldı', !!k && k.ban_id === 'restart-testi' && k.ban_tarih === '1 ay önce', JSON.stringify({ id: k?.ban_id, tarih: k?.ban_tarih }));
    check('Toplam kayıt arttı', db.getBanBildirimleri(G).length === onceki + 1);
    check('Eski panel mesajındaki buton çalışıyor', !!db.getBanPanel(G)?.message_id);
  }

  /* ================================================================== */
  bolum('YAPILANDIRMA');

  {
    check('Bildirim kanalı 1559535039614689362', config.banlilarChannelId === KANAL, String(config.banlilarChannelId));
    const sc = fs.readFileSync(path.join(KOK, 'src/database/schema.js'), 'utf8');
    check('ban_bildirimleri tablosu', sc.includes('CREATE TABLE IF NOT EXISTS ban_bildirimleri'));
    check('ban_panels tablosu', sc.includes('CREATE TABLE IF NOT EXISTS ban_panels'));
    check('ban_form_oturumlari tablosu', sc.includes('CREATE TABLE IF NOT EXISTS ban_form_oturumlari'));
    check('.env dosyasına dokunulmadı', !fs.readFileSync(path.join(KOK, '.env'), 'utf8').includes('BANLILAR'));

    const bh = fs.readFileSync(path.join(KOK, 'src/handlers/buttonHandler.js'), 'utf8');
    check('Tüm bn_* butonları tek noktadan', bh.includes('ban.handleEtkilesim(interaction)'));
    check('Mazeret butonu duruyor', bh.includes('mz.CID.BILDIR'));
    check('Ticket butonu duruyor', bh.includes('tickets.OPEN_KIND[customId]'));

    const mc = fs.readFileSync(path.join(KOK, 'src/events/messageCreate.js'), 'utf8');
    check('IC onay akışı korundu', mc.includes('handleIcMessage') && mc.includes('icApprovalChannelId'));
    check(
      'messageCreate ban DİNLEMİYOR (kanal mesajı yok)',
      !/require\(.\.\/handlers\/banli.\)/.test(mc) && !mc.includes('ban.handleCevap'),
    );

    const ic = fs.readFileSync(path.join(KOK, 'src/events/interactionCreate.js'), 'utf8');
    check('Mazeret modalı duruyor', ic.includes('mz.CID.SEBEP'));
    check('Ban yazma penceresi yönlendirildi', ic.includes("ban.handleModalSubmit") && ic.includes("startsWith('bn_')"));
  }

  /* ================================================================== */
  bolum('12) MEVCUT SİSTEMLER ETKİLENMEDİ');

  {
    for (const [ad, yol, d] of [
      ['ticket handler', '../src/handlers/tickets', (m) => typeof m.handleTicketButton === 'function'],
      ['ticket views', '../src/utils/ticketViews', (m) => typeof m.buildMainPanel === 'function'],
      ['ticketkur', '../src/commands/ticketkur', (m) => m.data.name === 'ticketkur'],
      ['guard manager', '../src/guard/manager', (m) => typeof m === 'object' && m !== null],
      ['guard permissions', '../src/guard/permissions', (m) => typeof m.canManageGuard === 'function'],
      ['mazeret handler', '../src/handlers/mazeret', (m) => typeof m.handleSebepSubmit === 'function'],
      ['mazeret views', '../src/utils/mazeretViews', (m) => typeof m.buildAktifPanelEmbed === 'function'],
      ['mazeretpanel', '../src/commands/mazeretpanel', (m) => m.data.name === 'mazeretpanel'],
      ['mazeretliler', '../src/commands/mazeretliler', (m) => m.data.name === 'mazeretliler'],
      ['unban', '../src/commands/unban', (m) => m.data.name === 'unban'],
    ]) {
      let ok = false;
      try {
        ok = d(require(yol));
      } catch {
        ok = false;
      }
      check('Yüklenebiliyor: ' + ad, ok);
    }

    const t = db.getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name);
    for (const gerek of ['guard_whitelist', 'mazeret_records', 'tickets', 'ticket_panel']) {
      check('Mevcut tablo korundu: ' + gerek, t.includes(gerek));
    }
  }

  /* ================================================================== */
  yaz('\n' + '='.repeat(70));
  yaz(`  SONUÇ:  ${pass} başarılı / ${pass + fail} toplam  /  ${fail} başarısız`);
  yaz('  NOT: Bunlar MOCK testlerdir — gerçek Discord sunucusunda çalıştırılmamıştır.');
  yaz('='.repeat(70));
  fs.writeFileSync('C:/Users/PC/AppData/Local/Temp/opencode/ban-test-out.txt', cikti.join('\n'), 'utf8');

  db.closeDatabase();
  try {
    fs.unlinkSync(process.env.DB_PATH);
  } catch {
    /* yok */
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  yaz('TEST ÇÖKTÜ: ' + (e?.stack || e));
  process.exit(1);
});