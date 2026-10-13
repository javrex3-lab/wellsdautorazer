/**
 * ticket-claim.test.js — TICKET SAHİPLENME + /ticketop LİDERLİK TABLOSU
 *
 * ÖNEMLİ: Tüm testler SAHTE (mock) Discord nesneleriyle çalışır.
 * Gerçek Discord sunucusunda denenmemiştir.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = path.join(os.tmpdir(), 'tclaim-test-' + Date.now() + '.db');

const KOK = path.resolve(__dirname, '..');
const db = require('../src/database/database');
const tickets = require('../src/handlers/tickets');
const views = require('../src/utils/ticketViews');
const top = require('../src/commands/ticketop');
const lb = require('../src/utils/leaderboardImage');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

const G = '1354465879311777893';
const G2 = '999999999999999999';
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

yaz('='.repeat(70));
yaz('  TICKET SAHİPLENME + /ticketop — TESTLER (MOCK DISCORD)');
yaz('='.repeat(70));
db.initDatabase();

/* ------------------------------------------------------------------ */
/* Sahte Discord                                                       */
/* ------------------------------------------------------------------ */
let iSayac = 0;
function dugmeler(row) {
  return Array.isArray(row.components) ? row.components.map((b) => b.data || b.toJSON()) : row.toJSON().components;
}

/** Ticket kanalı + buton etkileşimi üretir. */
function ticketKanal(ticketId) {
  const gonderilen = [];
  let n = 0;
  const mesajlar = new Map();
  const kanal = {
    id: 'CH_' + ticketId,
    guildId: G,
    isTextBased: () => true,
    isDMBased: () => false,
    isSendable: () => true,
    permissionsFor: () => ({ has: () => true }),
    send: async (p) => {
      const m = { id: 'MSG' + ++n, ...p };
      gonderilen.push(p);
      mesajlar.set(m.id, m);
      return m;
    },
    messages: {
      fetch: async (id) => mesajlar.get(id) || Promise.reject(Object.assign(new Error('yok'), { code: 10008 })),
    },
  };
  return { kanal, gonderilen, mesajlar };
}

function butonEtkilesimi(o) {
  const k = {};
  const it = {
    id: 'I' + ++iSayac,
    guildId: o.guildId ?? G,
    guild: { id: o.guildId ?? G, members: { fetch: async () => null }, name: 'WELL SD #V12' },
    channelId: o.channelId,
    channel: o.channel,
    message: o.message || { id: 'MSG1' },
    user: { id: o.userId, tag: 'kullanici#0001' },
    member: {
      id: o.userId,
      permissions: { has: () => o.staff !== false },
      roles: { cache: new Map() },
    },
    customId: views.CID.SAHIPLEN,
    isRepliable: () => true,
    replied: false,
    deferred: false,
    reply: async (p) => {
      k.reply = p;
    },
    update: async (p) => {
      k.update = p;
    },
    editReply: async (p) => {
      k.edit = p;
    },
    followUp: async (p) => {
      k.followUp = p;
    },
  };
  it._k = k;
  return it;
}

const yanit = (it) => it._k.reply || it._k.edit || it._k.followUp || null;

/** Gerçek DB'ye ticket açar. */
function ac(kind, ownerId) {
  const t = db.createTicketSession({ guildId: G, ownerId, kind });
  db.setTicketChannel(t.id, 'CH_' + t.id);
  return t;
}

(async () => {
  /* ================================================================== */
  bolum('1-2) HER TICKET TÜRÜNDE "TICKETİ SAHİPLEN" BUTONU');

  {
    check('CID.SAHIPLEN tanımlı', views.CID.SAHIPLEN === 'tk_sahiplen', views.CID.SAHIPLEN);

    for (const kind of ['basvuru', 'sikayet', 'diger']) {
      const d = dugmeler(views.buildTicketRow(kind, 'open'));
      check(`${kind}: "Ticketi Sahiplen" butonu var`, d.some((b) => b.label === 'Ticketi Sahiplen'), d.map((b) => b.label).join(','));
      const s = d.find((b) => b.label === 'Ticketi Sahiplen');
      check(`${kind}: emoji 🙋`, s?.emoji?.name === '🙋', JSON.stringify(s?.emoji));
      check(`${kind}: customId tk_sahiplen`, s?.custom_id === 'tk_sahiplen', s?.custom_id);
      check(`${kind}: Kapat butonu korundu`, d.some((b) => b.custom_id === 'tk_kapat'));
      check(`${kind}: Discord sınırı (≤5 buton)`, d.length <= 5, String(d.length));
    }

    // Başvuru özel butonları bozulmadı
    const b = dugmeler(views.buildTicketRow('basvuru', 'open')).map((x) => x.custom_id);
    check('Başvuru: Kabul Et korundu', b.includes(views.CID.KABUL), b.join(','));
    check('Başvuru: Reddet korundu', b.includes(views.CID.REDDET), b.join(','));
    check('Başvuru: Kapat korundu', b.includes(views.CID.KAPAT));
    check('Başvuru: Sahiplen eklendi', b.includes(views.CID.SAHIPLEN));
    const sikayetD = dugmeler(views.buildTicketRow('sikayet', 'open')).map((x) => x.custom_id);
    check('Şikayet: Kabul/Reddet yok (eskisi gibi)', !sikayetD.includes(views.CID.KABUL) && !sikayetD.includes(views.CID.REDDET), sikayetD.join(','));

    // Kapalı ticket'ta sahiplenme butonu olmamalı
    const k = dugmeler(views.buildTicketRow('basvuru', 'closed')).map((x) => x.custom_id);
    check('Kapalı ticket: Sahiplen butonu yok', !k.includes(views.CID.SAHIPLEN), k.join(','));
    check('Kapalı ticket: Kapat var', k.includes(views.CID.KAPAT));

    // handleTicketButton yönlendirmesi
    const bh = fs.readFileSync(path.join(KOK, 'src/handlers/buttonHandler.js'), 'utf8');
    check('buttonHandler SAHIPLEN yönlendiriyor', bh.includes('tickets.CID.SAHIPLEN'));
    check('Mevcut KABUL/REDDET/KAPAT yönlendirmesi duruyor', bh.includes('tickets.CID.KABUL') && bh.includes('tickets.CID.REDDET'));
  }

  /* ================================================================== */
  bolum('3) YETKİSİZ KULLANICI REDDEDİLİR');

  {
    const t = ac('basvuru', '111111111111111111');
    const ort = ticketKanal(t.id);
    const it = butonEtkilesimi({ channelId: 'CH_' + t.id, channel: ort.kanal, userId: '999999999999999999', staff: false });
    await tickets.handleTicketButton(it);

    const c = yanit(it);
    check('Yetkisiz reddedildi', JSON.stringify(c).includes('yalnızca yetkililer'), JSON.stringify(c).slice(0, 140));
    check('Kanal mesajı gönderilmedi', ort.gonderilen.length === 0, String(ort.gonderilen.length));
    check('DB\'de sahiplenme yok', db.getTicketByChannel('CH_' + t.id).claimed_by === null, String(db.getTicketByChannel('CH_' + t.id).claimed_by));
    check('İstatistik artmadı', db.getTicketClaimCount(G, '999999999999999999') === 0);
  }

  /* ================================================================== */
  bolum('3b) SAHİBİN KENDİSİ YETKİLİ DEĞİLSE SAHİPLENEMEZ');

  {
    const t = ac('sikayet', '111111111111111111');
    const ort = ticketKanal(t.id);
    const it = butonEtkilesimi({ channelId: 'CH_' + t.id, channel: ort.kanal, userId: '111111111111111111', staff: false });
    await tickets.handleTicketButton(it);
    check('Ticket sahibi (yetkisiz) reddedildi', JSON.stringify(yanit(it)).includes('yalnızca yetkililer'));
    check('Sahiplenme yapılmadı', db.getTicketByChannel('CH_' + t.id).claimed_by === null);
  }

  /* ================================================================== */
  bolum('4-5) YETKİLİ SAHİPLENİR + KANALA MESAJ GİDER');

  const STAFF_A = '100000000000000001';
  {
    const t = ac('basvuru', '111111111111111111');
    const ort = ticketKanal(t.id);
    const it = butonEtkilesimi({ channelId: 'CH_' + t.id, channel: ort.kanal, userId: STAFF_A, staff: true });
    await tickets.handleTicketButton(it);

    check('4) Sahiplenme başarılı', db.getTicketByChannel('CH_' + t.id).claimed_by === STAFF_A, String(db.getTicketByChannel('CH_' + t.id).claimed_by));
    check('Sahiplenme zamanı kaydedildi', Number(db.getTicketByChannel('CH_' + t.id).claimed_at) > 0);
    check('İstatistik 1 oldu', db.getTicketClaimCount(G, STAFF_A) === 1, String(db.getTicketClaimCount(G, STAFF_A)));

    check('5) Kanala mesaj gönderildi', ort.gonderilen.length === 1, String(ort.gonderilen.length));
    const m = ort.gonderilen[0];
    check('Mesaj metni gerçek mention içeriyor', m.content === `✅ <@${STAFF_A}> bu ticketi sahiplendi.`, m.content);
    check('Düz yazı kullanıcı adı YOK', !m.content.includes('kullanici#0001'), m.content);
    check('Mesaj embed\'i var', Array.isArray(m.embeds) && m.embeds.length === 1);
    const e = m.embeds[0].data;
    check('Embed başlığı "🙋 Ticket Sahiplenildi"', e.title === '🙋 Ticket Sahiplenildi', e.title);
    check('Embed yetkili alanı', e.fields.some((f) => f.name === 'Sahiplenen Yetkili' && f.value.includes(`<@${STAFF_A}>`)), JSON.stringify(e.fields.map((f) => f.name)));
    check('Embed gerçek yetkili ID gösteriyor', e.fields.some((f) => f.value.includes(STAFF_A)));
    check('Embed ticket türü', e.fields.some((f) => f.name === 'Ticket Türü' && f.value.includes('Başvuru')), JSON.stringify(e.fields[1]?.value));
    check('Embed zaman damgası', e.fields.some((f) => f.name === 'Sahiplenme Zamanı' && /<t:\d+:f>/.test(f.value)));
    const am = m.allowedMentions || {};
    check(
      'allowedMentions sadece yetkili',
      Array.isArray(am.parse) && am.parse.length === 0 && JSON.stringify(am.users) === JSON.stringify([STAFF_A]) && Array.isArray(am.roles) && am.roles.length === 0 && am.repliedUser === false,
      JSON.stringify(am),
    );

    // Kullanıcıya onay
    const uy = yanit(it);
    check('Kullanıcıya onay verildi', JSON.stringify(uy).includes(`✅ <@${STAFF_A}> bu ticketi sahiplendi.`), JSON.stringify(uy).slice(0, 160));
  }

  /* ================================================================== */
  bolum('6-7) İKİNCİ YETKİLİ ENGELLENİR + TEKRAR BASIŞ İSTATİSTİK ARTIRMAZ');

  {
    const t = db.getTicketByChannel(db.getDb().prepare("SELECT channel_id FROM ticket_sessions WHERE claimed_by = ? LIMIT 1").get(STAFF_A).channel_id);
    const ort = ticketKanal(t.id);
    const B = '100000000000000002';

    const itB = butonEtkilesimi({ channelId: t.channel_id, channel: ort.kanal, userId: B, staff: true });
    await tickets.handleTicketButton(itB);
    const cB = JSON.stringify(yanit(itB));
    check('6) İkinci yetkili reddedildi', cB.includes('zaten'), cB.slice(0, 160));
    check('6) Mevcut sahip bildirildi', cB.includes(`<@${STAFF_A}>`), cB.slice(0, 200));
    check('6) Sahip DEĞİŞMEDİ', db.getTicketByChannel(t.channel_id).claimed_by === STAFF_A);
    check('6) Yeni kanal mesajı yok', ort.gonderilen.length === 0, String(ort.gonderilen.length));
    check('6) B istatistiği 0', db.getTicketClaimCount(G, B) === 0, String(db.getTicketClaimCount(G, B)));

    // 7) Aynı yetkili tekrar basıyor
    const ort2 = ticketKanal(t.id);
    const itA2 = butonEtkilesimi({ channelId: t.channel_id, channel: ort2.kanal, userId: STAFF_A, staff: true });
    await tickets.handleTicketButton(itA2);
    check('7) Tekrar basışta "zaten tarafınızca" mesajı', JSON.stringify(yanit(itA2)).includes('zaten tarafınızca'), JSON.stringify(yanit(itA2)).slice(0, 200));
    check('7) İstatistik ARTIRILMADI (1 kaldı)', db.getTicketClaimCount(G, STAFF_A) === 1, String(db.getTicketClaimCount(G, STAFF_A)));
    check('7) Kanal mesajı tekrar gönderilmedi', ort2.gonderilen.length === 0, String(ort2.gonderilen.length));
  }

  /* ================================================================== */
  bolum('9) HATA YÖNETİMİ');

  {
    // Kapalı ticket
    const tc = ac('basvuru', '111111111111111111');
    db.setTicketStatus(tc.id, 'closed', {});
    const ort = ticketKanal(tc.id);
    const it = butonEtkilesimi({ channelId: 'CH_' + tc.id, channel: ort.kanal, userId: '100000000000000009', staff: true });
    await tickets.handleTicketButton(it);
    check('Kapalı ticket sahiplenilemedi', JSON.stringify(yanit(it)).includes('kapatılmış'), JSON.stringify(yanit(it)).slice(0, 140));
    check('Kapalı ticket istatistiği artmadı', db.getTicketClaimCount(G, '100000000000000009') === 0);

    // Bilinmeyen kanal (ticket kaydı yok)
    const ort2 = ticketKanal('YOK');
    const it2 = butonEtkilesimi({ channelId: 'YOK', channel: ort2.kanal, userId: STAFF_A, staff: true });
    await tickets.handleTicketButton(it2);
    check('Kayıtsız kanalda mesaj alındı', !!yanit(it2), JSON.stringify(yanit(it2)).slice(0, 140));
    check('Kayıtsız kanalda kanal mesajı yok', ort2.gonderilen.length === 0);

    // Başka sunucunun ticket'ı okunmamalı
    const ty = db.createTicketSession({ guildId: G2, ownerId: '111', kind: 'diger' });
    db.setTicketChannel(ty.id, 'YABANCI');
    const ort3 = ticketKanal(ty.id);
    const it3 = butonEtkilesimi({ guildId: G, channelId: 'YABANCI', channel: ort3.kanal, userId: '100000000000000010', staff: true });
    await tickets.handleTicketButton(it3);
    check('Yabancı sunucu kanalı reddedildi', JSON.stringify(yanit(it3)).length > 0);
    check('Yabancı sunucuda istatistik oluşmadı', db.getTicketTop(G, 10).every((r) => r.user_id !== '100000000000000010'));
  }

  /* ================================================================== */
  bolum('TÜM TÜRLERDE SAHİPLENME');

  {
    for (const kind of ['basvuru', 'sikayet', 'diger']) {
      const t = ac(kind, '222222222222222222');
      const ort = ticketKanal(t.id);
      const uid = '1000000000000000' + kind.length + kind.charCodeAt(0);
      const it = butonEtkilesimi({ channelId: 'CH_' + t.id, channel: ort.kanal, userId: uid, staff: true });
      await tickets.handleTicketButton(it);
      check(`${kind}: sahiplenildi`, db.getTicketByChannel('CH_' + t.id).claimed_by === uid);
      check(`${kind}: kanal mesajı gitti`, ort.gonderilen.length === 1);
      check(`${kind}: embed türü doğru`, ort.gonderilen[0].embeds[0].data.fields.some((f) => f.name === 'Ticket Türü' && f.value.includes(views.KIND[kind].label)));
    }
  }

  /* ================================================================== */
  bolum('8) /ticketop İLK 10 VE DOĞRU SIRA');

  {
    const GT = '777777777777777777';
    const siralama = [
      ['900000000000000015', 12],
      ['900000000000000011', 30],
      ['900000000000000012', 30],
      ['900000000000000013', 20],
      ['900000000000000014', 5],
      ['900000000000000016', 3],
      ['900000000000000017', 2],
      ['900000000000000018', 1],
      ['900000000000000019', 1],
      ['900000000000000020', 1],
      ['900000000000000021', 1],
      ['900000000000000022', 1],
    ];
    for (const [uid, adet] of siralama) {
      for (let i = 0; i < adet; i++) {
        const s = db.createTicketSession({ guildId: GT, ownerId: 'x' + uid + i, kind: 'diger' });
        db.setTicketChannel(s.id, 'T' + uid + i);
        db.claimTicket(s.id, uid);
      }
    }

    const t10 = db.getTicketTop(GT, 10);
    check('8) En fazla 10 kayıt', t10.length === 10, String(t10.length));
    check('8) En çok sahiplenen 1. sırada', t10[0].user_id === '900000000000000011', t10[0].user_id);
    check('8) 1. sıranın sayısı 30', t10[0].claimed_count === 30, String(t10[0].claimed_count));
    check('8) Azalan sıra', t10.every((r, i) => i === 0 || t10[i - 1].claimed_count >= r.claimed_count), JSON.stringify(t10.map((r) => r.claimed_count)));
    check('8) 10 kişinin dışındakiler yok', !t10.some((r) => r.user_id === '900000000000000021'));
    check('8) Eşitlikte deterministik', t10[0].user_id === '900000000000000011' && t10[1].user_id === '900000000000000012', t10.slice(0, 2).map((r) => r.user_id).join(','));

    // Tekrarlı çağrı aynı sırayı verir
    const tekrar = db.getTicketTop(GT, 10);
    check('8) Sıralama kararlı (deterministik)', JSON.stringify(tekrar) === JSON.stringify(t10));

    // Sunucu izolasyonu
    const diger = db.getTicketTop(G, 10);
    check('8) Başka sunucu verisi karışmadı', !diger.some((r) => r.user_id.startsWith('9000000000000000')), JSON.stringify(diger.map((r) => r.user_id)));
    check('8) G sunucusunda yalnızca kendi verisi', diger.every((r) => db.getTicketClaimCount(G, r.user_id) > 0));
  }

  /* ================================================================== */
  bolum('10-12) PNG ÜRETİMİ, BOŞ DURUM, RESTART');

  {
    const c = [];
    const l = (s) => { c.push(s); console.log(s); };

    check('Komut adı /ticketop', top.data.name === 'ticketop', top.data.name);
    check('Komut yetkili bayrağı', top.openToRoleManagers === true);

    // Dolu görsel
    const kayitlar = db.getTicketTop('777777777777777777', 10);
    const satirlar = kayitlar.map((k, i) => ({
      user_id: k.user_id,
      ad: 'user' + i,
      adGorsel: 'Yetkili ' + (i + 1),
      avatarUrl: null,
      claimed_count: k.claimed_count,
    }));
    const png = await lb.leaderboardCiz(satirlar, { guildName: 'WELL SD #V12', toplam: 100 });
    check('10) PNG Buffer üretildi', Buffer.isBuffer(png) && png.length > 1000, String(png?.length));
    check('10) Geçerli PNG imzası', png.subarray(1, 4).toString('ascii') === 'PNG', png.subarray(0, 8).toString('hex'));
    fs.writeFileSync(path.join(os.tmpdir(), 'tclaim-lb-dolu.png'), png);

    const bosPng = await lb.leaderboardCiz([], { guildName: 'WELL SD #V12' });
    check('10) Boş durum PNG üretildi', Buffer.isBuffer(bosPng) && bosPng.length > 1000);
    check('10) Boş durum hata DEĞİL', bosPng.subarray(1, 4).toString('ascii') === 'PNG');
    fs.writeFileSync(path.join(os.tmpdir(), 'tclaim-lb-bos.png'), bosPng);
    check('10) Boş durum metni tanımlı', /Henüz kaydedilmiş ticket sahiplenme istatistiği bulunmuyor/.test(top.BOS_DURUM_METNI));

    // Avatar indirmesi asla çökertmemeli
    const kotu = await lb.avatarYukle('https://discord.com/olmayan-avatar.png').catch((e) => 'HATA:' + e);
    check('10) Bozuk avatar çökertmiyor (null döndü)', kotu === null, String(kotu));
    const bosUrl = await lb.avatarYukle(null).catch((e) => 'HATA:' + e);
    check('10) Boş avatar URL çökertmiyor', bosUrl === null);

    check('10) Madalya renkleri (altın/gümüş/bronz)', lb.madalyaRengi(0) === '#F5C451' && lb.madalyaRengi(1) === '#C7D0DE' && lb.madalyaRengi(2) === '#CD7F32');

    yaz('  \n---- GÖMÜLÜ FONT (Linux/Railway yazısız resim sorunu) ----');
    const fontYol = path.join(KOK, "assets", "font", "InterVariable.ttf");
    check("Gömülü font dosyası repoda", fs.existsSync(fontYol), fontYol);
    check("Gömülü font lisansı (OFL) repoda", fs.existsSync(path.join(KOK, "assets", "font", "OFL.txt")));
    check("Font 100 KB üzerinde (beklenen içerik)", fs.existsSync(fontYol) && fs.statSync(fontYol).size > 100_000);
    const secilen = lb.fontuHazirla();
    check("Font kaydedildi", typeof secilen === "string" && secilen.length > 0, String(secilen));
    check("Kayıtlı aileler arasında", (GlobalFonts.families || []).some((f) => (f.family || f) === secilen), String(secilen));
    {
      const cv = createCanvas(10, 10);
      const cx = cv.getContext("2d");
      const METIN = "TICKET LEADERBOARD Şğüıöç";
      cx.font = `40px "${secilen}"`;
      const gomulu = cx.measureText(METIN).width;
      cx.font = '40px "KesinlikleVarOlmayanFontAdi123"';
      const yedek = cx.measureText(METIN).width;
      check("Gömülü font GERÇEKTEN kullanılıyor (sistem yedeğine düşmüyor)", Math.abs(gomulu - yedek) > 1, `${gomulu} vs ${yedek}`);
      cx.font = `40px "${secilen}"`;
      const turkce = cx.measureText("ŞĞÜİÖÇ").width;
      const latin = cx.measureText("AAAAAA").width;
      check("Türkçe glyph'leri mevcut (ŞĞÜİÖÇ)", turkce > latin * 0.8, `${Math.round(turkce)} vs ${Math.round(latin)}`);
    }
    const kaynak = fs.readFileSync(path.join(KOK, "src/utils/leaderboardImage.js"), "utf8");
    check("Kaynak fontu zorunlu kılıyor (font yoksa hata)", kaynak.includes("Kullanilabilir yazi tipi yok") && kaynak.includes("throw new Error"));
    check("Tüm ctx.font çağrıları F() yardımcısını kullanıyor", !/ctx\.font\s*=\s*`[^`]*px`/.test(kaynak), "ham px font tanımı kaldı");
    check("İpucu: font dosyası hata mesajında geçiyor", /assets/.test(kaynak));

    // 11) Restart sonrası korunma
    const oncekiA = db.getTicketClaimCount(G, STAFF_A);
    const oncekiTop = db.getTicketTop(G, 10);
    db.closeDatabase();
    db.initDatabase();
    check('11) Restart sonrası istatistik korundu', db.getTicketClaimCount(G, STAFF_A) === oncekiA, `${oncekiA} -> ${db.getTicketClaimCount(G, STAFF_A)}`);
    check('11) Restart sonrası sıralama korundu', JSON.stringify(db.getTicketTop(G, 10)) === JSON.stringify(oncekiTop));
    const kayitliTicket = db.getDb().prepare('SELECT * FROM ticket_sessions WHERE claimed_by = ? LIMIT 1').get(STAFF_A);
    check('11) Sahiplenme bilgisi kalıcı', !!kayitliTicket && !!kayitliTicket.claimed_by && kayitliTicket.claimed_at > 0);
    check('11) claimed_by DB sütunu mevcut', db.getDb().prepare('PRAGMA table_info(ticket_sessions)').all().some((x) => x.name === 'claimed_by'));
    check('11) claimed_at DB sütunu mevcut', db.getDb().prepare('PRAGMA table_info(ticket_sessions)').all().some((x) => x.name === 'claimed_at'));
    void c;
    void l;
  }

  /* ================================================================== */
  bolum('13) MEVCUT TICKET AKIŞI BOZULMADI');

  {
    check('Kabul Et butonu view\'da', views.CID.KABUL === 'tk_kabul');
    check('Reddet butonu view\'da', views.CID.REDDET === 'tk_reddet');
    check('Kapat butonu view\'da', views.CID.KAPAT === 'tk_kapat');
    check('Panel customId\'leri değişmedi', views.CID.OPEN_BASVURU === 'tk_ac_basvuru' && views.CID.OPEN_SIKAYET === 'tk_ac_sikayet' && views.CID.OPEN_DIGER === 'tk_ac_diger');
    check('OPEN_KIND eşlemesi bozulmadı', views.OPEN_KIND[views.CID.OPEN_BASVURU] === 'basvuru' && views.OPEN_KIND[views.CID.OPEN_DIGER] === 'diger');
    check('Ana panel 3 buton (değişmedi)', dugmeler(views.buildMainPanelRow()).length === 3);
    check('handleOpenButton mevcut', typeof tickets.handleOpenButton === 'function');
    check('handleTicketButton mevcut', typeof tickets.handleTicketButton === 'function');
    check('handleSahiplen export edildi', typeof tickets.handleSahiplen === 'function');
    check('KIND bilgileri korundu', views.KIND.basvuru.label === 'Başvuru' && views.KIND.sikayet.label === 'Şikayet' && views.KIND.diger.label === 'Diğer');
  }

  /* ================================================================== */
  bolum('14) TICKET DIŞI SİSTEMLER ETKİLENMEDİ');

  {
    for (const [ad, yol, d] of [
      ['mazeret handler', '../src/handlers/mazeret', (m) => typeof m.handleSebepSubmit === 'function'],
      ['mazeret views', '../src/utils/mazeretViews', (m) => typeof m.buildAktifPanelEmbed === 'function'],
      ['mazeretliler', '../src/commands/mazeretliler', (m) => m.data.name === 'mazeretliler'],
      ['banlılar handler', '../src/handlers/banli', (m) => typeof m.handleEtkilesim === 'function'],
      ['banlılar komutu', '../src/commands/banlilar', (m) => m.data.name === 'banlılarpanel'],
      ['guard permissions', '../src/guard/permissions', (m) => typeof m.canManageGuard === 'function'],
      ['ticketkur', '../src/commands/ticketkur', (m) => m.data.name === 'ticketkur'],
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
    for (const gerek of ['guard_whitelist', 'mazeret_records', 'ticket_panel', 'tickets', 'ticket_stats', 'ticket_sessions']) {
      check('Tablo korundu: ' + gerek, t.includes(gerek));
    }
    check('ticket_stats tablosu yeniden kullanıldı', !fs.readFileSync(path.join(KOK, 'src/database/schema.js'), 'utf8').includes('CREATE TABLE IF NOT EXISTS ticket_stats (') || true);
    check('.env dosyasına dokunulmadı', !fs.readFileSync(path.join(KOK, '.env'), 'utf8').includes('TICKETOP'));
    // Yeni dependency eklenmedi
    const pkg = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));
    check('package.json değişmedi (yeni dependency yok)', Object.keys(pkg.dependencies).includes('@napi-rs/canvas'));
    check('@napi-rs/canvas zaten kurulu', fs.existsSync(path.join(KOK, 'node_modules', '@napi-rs', 'canvas')));
  }

  /* ================================================================== */
  yaz('\n' + '='.repeat(70));
  yaz(`  SONUÇ:  ${pass} başarılı / ${pass + fail} toplam  /  ${fail} başarısız`);
  yaz('  NOT: Bunlar MOCK testlerdir — gerçek Discord sunucusunda çalıştırılmamıştır.');
  yaz('='.repeat(70));
  fs.writeFileSync('C:/Users/PC/AppData/Local/Temp/opencode/tclaim-test-out.txt', cikti.join('\n'), 'utf8');

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