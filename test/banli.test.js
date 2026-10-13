/**
 * banli.test.js — BANLILAR BİLDİRİM SİSTEMİ testleri (sıralı soru akışı).
 *
 * ÖNEMLİ: Bu testler SAHTE (mock) Discord nesneleriyle çalışır.
 * Gerçek Discord sunucusunda denenmemiştir; mock sonuçları gerçek test gibi sunulmaz.
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
let mSayac = 0;
/** Mesaj id'leri TUM ortamlar arasinda benzersiz olmali (DB mesaj_id UNIQUE). */
let bildirimMesajSayac = 0;

/* ------------------------------------------------------------------ */
/* Sahte Discord                                                       */
/* ------------------------------------------------------------------ */
function ortam(o = {}) {
  const gonderilen = [];
  const mesajlar = new Map();
  let n = 0;
  const mk = (id, extra = {}) => ({
    id,
    guildId: o.yanlisSunucu ? '999999999999999999' : G,
    isTextBased: () => o.metinKanali !== false,
    isDMBased: () => false,
    isSendable: () => true,
    permissionsFor: () => ({ has: () => o.yetkiVar !== false }),
    send: async (p) => {
      if (o.gonderimHatasi) throw o.gonderimHatasi;
      const m = {
        id: (id === KANAL ? 'BILDIRIM' : 'PANEL') + ++bildirimMesajSayac,
        ...p,
        edit: async (q) => Object.assign(m, q),
        reply: async (q) => {
          gonderilen.push({ kanal: id, ...q });
        },
      };
      gonderilen.push({ kanal: id, ...p });
      mesajlar.set(m.id, m);
      return m;
    },
    messages: {
      fetch: async (id) => mesajlar.get(id) || Promise.reject(Object.assign(new Error('yok'), { code: 10008 })),
    },
    ...extra,
  });

  const bildirim = mk(KANAL);
  const panel = mk(PANEL_K);

  const client = {
    channels: {
      fetch: async (id) => {
        if (o.kanalVar !== false && id === KANAL) return bildirim;
        throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
      },
    },
    guilds: { cache: new Map([[G, { id: G, members: { me: { id: 'BOT' } } }]]) },
  };

  return { bildirim, panel, client, gonderilen, mesajlar };
}

function buton(ort, o = {}) {
  ban.butonSon.clear(); // testlerde çift tıklama engelini devre dışı bırak
  const k = {};
  const it = {
    id: 'I' + ++iSayac,
    guildId: o.guildId ?? G,
    guild: { id: o.guildId ?? G, name: 'WELL SD #V12', members: { me: { id: 'BOT' } } },
    client: ort.client,
    user: { id: o.userId ?? '1056585742731726918', tag: 'd27q#0001' },
    message: { id: 'PANEL1' },
    channelId: PANEL_K,
    channel: ort.panel,
    customId: ban.CID.BILDIR,
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

function mesaj(ort, metin, o = {}) {
  const k = {};
  return {
    id: 'M' + ++mSayac,
    guildId: o.guildId ?? G,
    channelId: o.kanal ?? PANEL_K,
    client: ort.client,
    author: { id: o.userId ?? '1056585742731726918', bot: false },
    content: metin,
    reply: async (p) => {
      k.reply = p;
    },
    _k: k,
  };
}

/** Tam formu doldurur, son bildirimi döndürür. */
async function formuDoldur(ort, uid, degerler = {}) {
  await ban.handleBildirButton(buton(ort, { userId: uid }));
  await ban.handleCevap(mesaj(ort, degerler.id ?? 'license:abc123', { userId: uid }));
  await ban.handleCevap(mesaj(ort, degerler.sebep ?? 'Hile kullanımı nedeniyle yasaklandım.', { userId: uid }));
  const son = mesaj(ort, degerler.tarih ?? '12.10.2026 18:30', { userId: uid });
  await ban.handleCevap(son);
  return son;
}

(async () => {
  ban.oturumlar.clear();
  ban.butonSon.clear();

  /* ================================================================== */
  bolum('1) /banlılarpanel KOMUTU PANEL OLUŞTURUYOR MU?');

  check('Komut dosyası mevcut', fs.existsSync(path.join(KOK, 'src/commands/banlilar.js')));
  check('Komut adı /banlılarpanel', komut.data.name === 'banlılarpanel', komut.data.name);
  check('Eski ad /banlılar KALDIRILDI', komut.data.name !== 'banlılar');
  check('execute var', typeof komut.execute === 'function');
  {
    const s = fs.readFileSync(path.join(KOK, 'src/commands/banlilar.js'), 'utf8');
    check('Bot açılışında otomatik gönderim YOK', !/client\.once\(['"]ready/.test(s) && !/setInterval/.test(s));
    check('Duplicate engeli (panel kaydı)', s.includes('getBanPanel') && s.includes('upsertBanPanel'));
  }

  {
    const ort = ortam();
    const it = {
      id: 'C' + ++iSayac,
      guildId: G,
      guild: { id: G, name: 'WELL SD #V12', members: { me: { id: 'BOT' } } },
      client: ort.client,
      user: { id: '1056585742731726918', tag: 'd27q#0001' },
      member: { id: '1056585742731726918', permissions: { has: () => true } },
      options: { getChannel: () => ort.panel },
      channel: ort.panel,
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
    const panelMsaji = ort.gonderilen.find((x) => x.embeds);
    check('Panel mesajı gönderildi', !!panelMsaji);
    const e = panelMsaji.embeds[0].data;
    check('Başlık "BANLILAR BİLDİRİM SİSTEMİ"', e.title === 'BANLILAR BİLDİRİM SİSTEMİ', e.title);
    check('Açıklama oyun sunucusunu belirtiyor', e.description.includes('Oyun sunucusundan yasaklandıysanız'), e.description);
    check('Açıklama butonu yönlendiriyor', e.description.includes('aşağıdaki buton'));
    check('Discord limiti içinde', e.description.length <= 4096, String(e.description.length));

    // --- 2) Buton ---
    bolum('2) PANELDE "BANLIYIM" BUTONU');
    const row = panelMsaji.components[0];
    check('Tek action row', panelMsaji.components.length === 1);
    check('Tek buton', row.components.length === 1, String(row.components.length));
    const b = row.components[0].data ?? row.components[0];
    check('Etiket "Banlıyım"', b.label === 'Banlıyım', b.label);
    check('Emoji 🔨', b.emoji?.name === '🔨', JSON.stringify(b.emoji));
    check('Kırmızı (Danger)', b.style === 4 || b.style === 'Danger', String(b.style));
    check('customId = bn_bildir', (b.custom_id || b.customId) === ban.CID.BILDIR, b.custom_id);

    const onceki = ort.gonderilen.length;
    const it2 = { ...it, id: 'C' + ++iSayac, reply: async (p) => { it2._r = p; } };
    await komut.execute(it2);
    check('Tekrar çalıştırmada DUPLICATE panel oluşmadı', ort.gonderilen.length === onceki, `${onceki} -> ${ort.gonderilen.length}`);
  }

  /* ================================================================== */
  bolum('3) BUTONA BASILDIĞINDA BOT SORU SORAR');

  {
    const ort = ortam();
    const it = buton(ort);
    await ban.handleBildirButton(it);
    check('Oturum açıldı', ban.oturumlar.size === 1, String(ban.oturumlar.size));
    const baslangic = J(it._k.reply);
    check('Yönlendirme mesajı verildi', baslangic.includes('başlattınız'), baslangic.slice(0, 120));
    check('İptal yazılabilir', baslangic.includes('iptal'));

    const s1 = ort.gonderilen.find((x) => x.content && x.content.includes('BAN ID'));
    check('1. soru soruldu (BAN ID)', !!s1, JSON.stringify(ort.gonderilen.map((x) => x.content).filter(Boolean).join(' | ')).slice(0, 200));
    check('Soruda kullanıcı etiketlendi', (s1?.content || '').includes('<@1056585742731726918>'), s1?.content?.slice(0, 100));
    check('Soru sırası 1/3', (s1?.content || '').includes('1/3'));
    check('Ban ID formatı dayatılmıyor (örnek/şablon yok)', !/[Öö]rn[:.]/.test(s1?.content || ''), s1?.content?.slice(0, 120));
    check('Oyuncu istediğini yazabilir (ipucu veriliyor)', (s1?.content || '').includes('Sunucunun size verdiği ban kimliğini yazabilirsiniz'), s1?.content?.slice(0, 160));
    check('Kullanıcıya yazması söyleniyor', (s1?.content || '').includes('bu kanala yazın'));
  }

  /* ================================================================== */
  bolum('4) BOŞ / HATALI CEVAPLAR ENGELLENİYOR MU?');

  {
    check('Boş Ban ID reddedildi', ban.banIdGecerliMi('')?.ok === false);
    check('Boş sebep reddedildi', ban.sebepGecerliMi('')?.ok === false);
    check('Boş tarih reddedildi', ban.tarihGecerliMi('')?.ok === false);
    check('1 karakter reddedildi', ban.banIdGecerliMi('a')?.ok === false);
    check('129 karakter reddedildi', ban.banIdGecerliMi('a'.repeat(129))?.ok === false);
    check('Satır sonu içeren Ban ID reddedildi', ban.banIdGecerliMi('abc\ndef')?.ok === false);

    // "Oyuncu istediğini yazabilir" — format dayatmıyoruz
    for (const serbest of ['license:abc123', 'STEAM_0:1:12345', '192.168.1.1:30120', 'Player#42', 'abc def ghi', 'a'.repeat(128)]) {
      check('Serbest Ban ID kabul: ' + serbest, ban.banIdGecerliMi(serbest)?.ok === true, ban.banIdGecerliMi(serbest)?.mesaj);
    }
    check('Boş sebep uzunluğu sınırı', ban.sebepGecerliMi('a'.repeat(901))?.ok === false);

    // Tarih doğrulama
    const gecersiz = [
      ['yarın öğlen', 'tarih_bicim'],
      ['31.02.2026 18:30', 'tarih_gecersiz'],
      ['12.13.2026 18:30', 'tarih_ay'],
      ['00.10.2026 18:30', 'tarih_gun'],
      ['12.10.2026 28:00', 'tarih_saat'],
      ['12.10.2026 18:75', 'tarih_dakika'],
      ['12.10.1800 18:30', 'tarih_yil'],
    ];
    for (const [g, bek] of gecersiz) {
      const r = ban.tarihGecerliMi(g);
      check('Geçersiz tarih: ' + g, r.ok === false && r.sebep === bek, `${bek} != ${r.sebep || 'KABUL'}`);
    }
    for (const g of ['12.10.2026 18:30', '12.10.2026', '12/10/2026 18:30', '12-10-2026 18:30', '01.01.26 00:00', '29.02.2024 23:59']) {
      check('Geçerli tarih kabul: ' + g, ban.tarihGecerliMi(g)?.ok === true, ban.tarihGecerliMi(g)?.mesaj);
    }
    check('Kabul edilen biçim hata mesajında belirtiliyor', ban.tarihGecerliMi('xx').mesaj.includes('Gün.Ay.Yıl'));

    // Boş cevapla akış ilerlemiyor, soru tekrar soruluyor
    const ort = ortam();
    const it = buton(ort);
    await ban.handleBildirButton(it);
    const bos = mesaj(ort, '   ');
    await ban.handleCevap(bos);
    check('Boş cevap reddedildi', ort.gonderilen.filter((x) => x.content).length === 0);
    check('Aynı soru tekrar soruldu', J(bos._k.reply).includes('BAN ID'), J(bos._k.reply).slice(0, 160));
    check('Oturum hâlâ açık', ban.oturumlar.size === 1);
    await ban.handleCevap(mesaj(ort, 'license:abc'));
    check('Geçerli cevap sonrası ilerledi', ban.oturumlar.size === 1 && ban.oturumlar.get(G + ':1056585742731726918').adim === 'sebep');
    await ban.handleCevap(mesaj(ort, 'iptal'));
  }

  /* ================================================================== */
  bolum('5-8) DOĞRU CEVAPLAR + BİLDİRİM İÇERİĞİ');

  {
    const ort = ortam();
    const UID = '100000000000000001';
    await formuDoldur(ort, UID);

    const bildirim = ort.gonderilen.find((x) => x.kanal === KANAL && x.embeds);
    check('5) Üç cevap sonrası bildirim gönderildi', !!bildirim, String(ort.gonderilen.length));
    check('6) Bildirim 1559535039614689362 kanalına', !!bildirim && config.banlilarChannelId === KANAL, config.banlilarChannelId);

    const e = bildirim.embeds[0].data;
    check('Başlık "🔨 YENİ BAN BİLDİRİMİ"', e.title === '🔨 YENİ BAN BİLDİRİMİ', e.title);
    check('5 alan', e.fields.length === 5, String(e.fields.length));
    check('👤 Kullanıcı', e.fields[0].name === '👤 Kullanıcı', e.fields[0].name);
    check('7) Gerçek mention <@id>', e.fields[0].value === `<@${UID}>`, e.fields[0].value);
    check('🆔 Ban ID', e.fields[1].name === '🆔 Ban ID', e.fields[1].name);
    check('8) Ban ID doğru', e.fields[1].value === 'license:abc123', e.fields[1].value);
    check('📋 Ban Sebebi', e.fields[2].name === '📋 Ban Sebebi', e.fields[2].name);
    check('8) Sebep doğru', e.fields[2].value === 'Hile kullanımı nedeniyle yasaklandım.', e.fields[2].value);
    check('📅 Ban Tarihi', e.fields[3].name === '📅 Ban Tarihi', e.fields[3].name);
    check('8) Tarih doğru', e.fields[3].value === '12.10.2026 18:30', e.fields[3].value);
    check('🕒 Bildirim Zamanı', e.fields[4].name === '🕒 Bildirim Zamanı', e.fields[4].name);
    check('Discord timestamp', /<t:\d+:f>/.test(e.fields[4].value), e.fields[4].value);
    check('Footer doğru', e.footer.text === 'WellsdAutorazer • Ban Bildirim Sistemi', e.footer.text);
    check('Oturum kapandı', ban.oturumlar.size === 0);

    // Kalıcı kayıt
    const kayitlar = db.getBanBildirimleri(G);
    check('DB kaydı oluştu', kayitlar.length === 1, String(kayitlar.length));
    const k = kayitlar[0];
    check('Kayıt guild_id', k.guild_id === G);
    check('Kayıt user_id', k.user_id === UID);
    check('Kayıt ban_id', k.ban_id === 'license:abc123');
    check('Kayıt ban_sebep', k.ban_sebep === 'Hile kullanımı nedeniyle yasaklandım.');
    check('Kayıt ban_tarih', k.ban_tarih === '12.10.2026 18:30');
    check('Kayıt bildirim_zamani', Number(k.bildirim_zamani) > 0);
    check('Kayıt kanal_id', k.kanal_id === KANAL, k.kanal_id);
    check('Kayıt mesaj_id', typeof k.mesaj_id === 'string' && k.mesaj_id.startsWith('B'), String(k.mesaj_id));
    check('Kayıt durumu', k.durum === 'gonderildi', k.durum);
  }

  /* ================================================================== */
  bolum('9) İSTENMEYEN MENTION ENGELİ');

  {
    const ort = ortam();
    const UID = '100000000000000002';
    await ban.handleBildirButton(buton(ort, { userId: UID }));
    await ban.handleCevap(mesaj(ort, '@everyone <@&1522773972393922730> <@102- Lates> ping <#123> @here', { userId: UID }));
    await ban.handleCevap(mesaj(ort, 'Hile', { userId: UID }));
    await ban.handleCevap(mesaj(ort, '12.10.2026 18:30', { userId: UID }));

    const g = ort.gonderilen.find((x) => x.kanal === KANAL && x.embeds);
    const e = g.embeds[0].data;
    const idAlan = e.fields[1].value;
    const sbAlan = e.fields[2].value;

    check('Ban ID alanında @everyone yok', !/@everyone/i.test(idAlan), idAlan);
    check('Ban ID alanında rol mention yok', !/<@&/.test(idAlan), idAlan);
    check('Ban ID alanında kanal mention yok', !/<#\d+>/.test(idAlan), idAlan);
    check('Ban ID alanında kullanıcı mention yok', !/<@!?\d+>/.test(idAlan), idAlan);
    check('Sebep alanında @here yok', !/@here/i.test(sbAlan), sbAlan);
    check('allowedMentions.parse boş', Array.isArray(g.allowedMentions?.parse) && g.allowedMentions.parse.length === 0, JSON.stringify(g.allowedMentions));
    check('allowedMentions.users yalnızca bildiren', JSON.stringify(g.allowedMentions?.users) === JSON.stringify([UID]), JSON.stringify(g.allowedMentions?.users));
    check('allowedMentions.roles boş', Array.isArray(g.allowedMentions?.roles) && g.allowedMentions.roles.length === 0);
    check('allowedMentions.repliedUser false', g.allowedMentions?.repliedUser === false);
    check('Mesajda tek mention (bildiren)', (JSON.stringify(e).match(/<@\d+>/g) || []).length === 1);
    check('DB ham metni koruyor', db.getBanBildirimleri(G).find((x) => x.user_id === UID).ban_id === '@everyone <@&1522773972393922730> <@102- Lates> ping <#123> @here');
  }

  /* ================================================================== */
  bolum('11) KANAL BULUNAMADI / GÖNDERİM BAŞARISIZ');

  {
    const Ggonderildi = () => db.getBanBildirimleri(G).filter((x) => x.durum === 'gonderildi').length;
    const base = Ggonderildi();

    const senaryolar = [
      ['kanal yok', { kanalVar: false }, 'bulunamad'],
      ['yanlış sunucu', { yanlisSunucu: true }, 'ait değil'],
      ['yetki yok', { yetkiVar: false }, 'yetkisi yok'],
      ['metin kanalı değil', { metinKanali: false }, 'metin kanalı'],
    ];
    let i = 10;
    for (const [ad, opt, bek] of senaryolar) {
      const ort = ortam(opt);
      const uid = '1000000000000000' + i++;
      await ban.handleBildirButton(buton(ort, { userId: uid }));
      await ban.handleCevap(mesaj(ort, 'id-' + i, { userId: uid }));
      const son = mesaj(ort, '12.10.2026 18:30', { userId: uid });
      await ban.handleCevap(mesaj(ort, 'sebep metni', { userId: uid }));
      await ban.handleCevap(son);
      const cevap = J(son._k.reply);
      check('11) ' + ad + ': mesaj gönderilmedi', !ort.gonderilen.some((x) => x.kanal === KANAL && x.embeds));
      check('11) ' + ad + ': anlaşılır hata verildi', cevap.includes(bek), cevap.slice(0, 160));
      check('11) ' + ad + ': "başarılı" denmedi', !cevap.includes('Ban bildiriminiz alındı ve yetkililere iletildi'), cevap.slice(0, 160));
      check('11) ' + ad + ': "gonderildi" kaydı yazılmadı', Ggonderildi() === base, `${base} -> ${Ggonderildi()}`);
      check('11) ' + ad + ': oturum kapandı', !ban.oturumlar.has(G + ':' + uid));
    }

    // API gönderim hatası -> kayıt 'hata'
    const ort5 = ortam({ gonderimHatasi: Object.assign(new Error('Missing Permissions'), { code: 50013 }) });
    const uid5 = '100000000000000099';
    await ban.handleBildirButton(buton(ort5, { userId: uid5 }));
    await ban.handleCevap(mesaj(ort5, '50013-testi', { userId: uid5 }));
    await ban.handleCevap(mesaj(ort5, 'sebep metni', { userId: uid5 }));
    const son5 = mesaj(ort5, '12.10.2026 18:30', { userId: uid5 });
    await ban.handleCevap(son5);
    check('API hatasında "iletilemedi" deniyor', J(son5._k.reply).includes('iletilemedi'), J(son5._k.reply).slice(0, 160));
    const hatali = db.getBanBildirimleri(G).filter((x) => x.durum === 'hata');
    check('Başarısız gönderim durum=hata kaydedildi', hatali.length === 1, String(hatali.length));
    check('Hata kodu saklandı', hatali[0] && String(hatali[0].hata).includes('50013'), hatali[0] ? String(hatali[0].hata) : 'yok');
  }

  /* ================================================================== */
  bolum('ÇİFT GÖNDERİM / OTURUM KORUMASI');

  {
    const ort = ortam();
    const UID = '100000000000000200';
    const it = buton(ort, { userId: UID });
    await ban.handleBildirButton(it);
    // Çift tıklama
    ban.butonSon.delete(UID);
    const it2 = buton(ort, { userId: UID });
    it2.customId = ban.CID.BILDIR;
    await ban.handleBildirButton(it2);
    check('Açık oturum varken ikinci buton reddedildi', J(it2._k.reply).includes('Zaten'), J(it2._k.reply).slice(0, 140));
    check('Oturum sayısı 1', ban.oturumlar.size === 1);

    // İptal
    await ban.handleCevap(mesaj(ort, 'iptal', { userId: UID }));
    check('İptal oturumu kapattı', ban.oturumlar.size === 0);

    // Aynı kullanıcı + aynı Ban ID kısa sürede ikinci bildirim yapamaz
    await formuDoldur(ort, UID, { id: 'rate-limit-testi' });
    const n1 = ort.gonderilen.filter((x) => x.kanal === KANAL && x.embeds).length;
    await formuDoldur(ort, UID, { id: 'rate-limit-testi' });
    const n2 = ort.gonderilen.filter((x) => x.kanal === KANAL && x.embeds).length;
    check('Aynı Ban ID ile ikinci bildirim engellendi', n1 === 1 && n2 === 1, `${n1} -> ${n2}`);

    // Farklı Ban ID ile yeni bildirim yapılabilir
    await formuDoldur(ort, UID, { id: 'farkli-ban-id' });
    check('Farklı Ban ID ile yeni bildirim yapılabiliyor', ort.gonderilen.filter((x) => x.kanal === KANAL && x.embeds).length === 2);

    // Yanlış kanal / yanlış kullanıcı yok sayılır
    await ban.handleBildirButton(buton(ort, { userId: '100000000000000300' }));
    const r1 = await ban.handleCevap(mesaj(ort, '111', { userId: '100000000000000300', kanal: '999999999999999999' }));
    check('Yanlış kanaldaki mesaj yok sayıldı', r1 === false);
    const r2 = await ban.handleCevap(mesaj(ort, '222', { userId: '999000000000000999' }));
    check('Başka kullanıcının mesajı yok sayıldı', r2 === false);
    check('Oturum hâlâ açık (1)', ban.oturumlar.size === 1);
    await ban.handleCevap(mesaj(ort, 'iptal', { userId: '100000000000000300' }));
  }

  /* ================================================================== */
  bolum('10) YENİDEN BAŞLATMA SONRASI ÇALIŞMA');

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

    // Eski panel mesajındaki buton çalışıyor
    const ort = ortam();
    const panelId = db.getBanPanel(G)?.message_id;
    check('Panel kaydı DB\'de', !!panelId, String(panelId));
    const uid = '111000000000000111';
    ban2.butonSon.clear();
    const bt = buton(ort, { userId: uid });
    bt.message = { id: panelId || 'ESKI' };
    await ban2.handleBildirButton(bt);
    check('Eski panel mesajındaki buton oturum açıyor', ban2.oturumlar.size === 1);

    // Eski kayıtlardan sonra yeni bildirim
    await ban2.handleCevap(mesaj(ort, 'restart-testi', { userId: uid }));
    await ban2.handleCevap(mesaj(ort, 'yeniden baslatma sonrasi', { userId: uid }));
    await ban2.handleCevap(mesaj(ort, '12.10.2026 18:30', { userId: uid }));
    check('Yeniden başlatma sonrası bildirim gönderilebiliyor', ort.gonderilen.some((x) => x.kanal === KANAL && x.embeds));
    check('Yeni kayıt DB\'ye yazıldı', db.getBanBildirimleri(G).length === onceki + 1);
  }

  /* ================================================================== */
  bolum('YAPILANDIRMA');

  {
    check('Bildirim kanalı 1559535039614689362', config.banlilarChannelId === KANAL, String(config.banlilarChannelId));
    const sc = fs.readFileSync(path.join(KOK, 'src/database/schema.js'), 'utf8');
    check('ban_bildirimleri tablosu', sc.includes('CREATE TABLE IF NOT EXISTS ban_bildirimleri'));
    check('ban_panels tablosu', sc.includes('CREATE TABLE IF NOT EXISTS ban_panels'));
    check('.env dosyasına dokunulmadı', !fs.readFileSync(path.join(KOK, '.env'), 'utf8').includes('BANLILAR'));
  }

  /* ================================================================== */
  bolum('12) MEVCUT SİSTEMLER ETKİLENMEDİ');

  {
    const sistemler = [
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
    ];
    for (const [ad, yol, d] of sistemler) {
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

    const bh = fs.readFileSync(path.join(KOK, 'src/handlers/buttonHandler.js'), 'utf8');
    check('Mazeret butonu yönlendirmesi duruyor', bh.includes('mz.CID.BILDIR'));
    check('Ticket butonu yönlendirmesi duruyor', bh.includes('tickets.OPEN_KIND[customId]'));
    check('Banlılar butonu yönlendirildi', bh.includes('ban.CID.BILDIR'));

    const mc = fs.readFileSync(path.join(KOK, 'src/events/messageCreate.js'), 'utf8');
    check('IC onay akışı korundu', mc.includes('handleIcMessage') && mc.includes('icApprovalChannelId'));
    check('Ban form yanıtları bağlandı', mc.includes('ban.handleCevap'));

    const ic = fs.readFileSync(path.join(KOK, 'src/events/interactionCreate.js'), 'utf8');
    check('Mazeret modalı yönlendirmesi duruyor', ic.includes('mz.CID.SEBEP'));
    check('Ban modal referansı kalmadı', !ic.includes('ban.CID.MODAL'));
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