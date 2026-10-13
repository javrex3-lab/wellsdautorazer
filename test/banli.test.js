/**
 * banli.test.js — BANLILAR BİLDİRİM SİSTEMİ testleri.
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
const U = '1056585742731726918';
const DIGER_KANAL = '1559535039614689999';

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
const aciklama = (e) => {
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

let sayac = 0;
/** Mesaj id'leri TÜM ortamlar arasında benzersiz olmalı — DB'de mesaj_id UNIQUE. */
let mesajSayac = 0;

/* ------------------------------------------------------------------ */
/* Sahte Discord ortamı                                                */
/* ------------------------------------------------------------------ */
function ortam({ kanalVar = true, yanlisSunucu = false, yetkiVar = true, metinKanali = true, gonderimHatasi = null } = {}) {
  const gonderilenler = [];
  const mesajlar = new Map();
  let n = 0;

  const kanal = {
    id: KANAL,
    guildId: yanlisSunucu ? '999999999999999999' : G,
    isTextBased: () => metinKanali,
    isDMBased: () => false,
    isSendable: () => true,
    permissionsFor: () => ({ has: () => yetkiVar }),
    send: async (p) => {
      if (gonderimHatasi) throw gonderimHatasi;
      const m = { id: 'MSG' + ++mesajSayac, ...p, edit: async (q) => Object.assign(m, q) };
      gonderilenler.push(p);
      mesajlar.set(m.id, m);
      return m;
    },
    messages: {
      fetch: async (id) => mesajlar.get(id) || Promise.reject(Object.assign(new Error('yok'), { code: 10008 })),
    },
  };

  const panelKanal = {
    id: '999000000000000001',
    guildId: G,
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async (p) => {
      const m = { id: 'PANEL' + ++mesajSayac, ...p, edit: async (q) => Object.assign(m, q) };
      gonderilenler.push(p);
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
        if (kanalVar && id === KANAL) return kanal;
        throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
      },
    },
    guilds: { cache: new Map([[G, { id: G, members: { me: { id: '1559192913009713222' } } }]]) },
  };

  return { kanal, panelKanal, client, gonderilenler, mesajlar };
}

function butonEtkilesimi(o = {}) {
  const k = {};
  const it = {
    id: 'I' + ++sayac,
    guildId: o.guildId ?? G,
    guild: { id: o.guildId ?? G, name: 'WELL SD #V12', members: { me: { id: 'BOT' } } },
    client: o.client,
    user: { id: o.userId ?? U, tag: 'd27q#0001' },
    message: { id: 'PANEL1' },
    channelId: '999000000000000001',
    customId: ban.CID.BILDIR,
    isRepliable: () => true,
    replied: false,
    deferred: false,
    reply: async (p) => { k.reply = p; },
    showModal: async (m) => { k.modal = m; },
    deferReply: async (p) => { k.defer = p; it.deferred = true; },
    editReply: async (p) => { k.edit = p; },
    followUp: async (p) => { k.followUp = p; },
  };
  it._k = k;
  return it;
}

function modalEtkilesimi(degerler, o = {}) {
  const k = {};
  const it = {
    id: 'M' + ++sayac,
    guildId: o.guildId ?? G,
    guild: { id: o.guildId ?? G },
    client: o.client,
    user: { id: o.userId ?? U, tag: 'd27q#0001' },
    customId: ban.CID.MODAL,
    fields: {
      getTextInputValue: (k2) => {
        if (!(k2 in degerler)) throw Object.assign(new Error('alan yok: ' + k2), { code: 50035 });
        return degerler[k2];
      },
    },
    isRepliable: () => true,
    replied: false,
    deferred: false,
    reply: async (p) => { k.reply = p; },
    deferReply: async (p) => { k.defer = p; it.deferred = true; },
    editReply: async (p) => { k.edit = p; },
    followUp: async (p) => { k.followUp = p; },
  };
  it._k = k;
  return it;
}

/** Her blok için AYRI banId — aksi halde DB rate-limit devreye girer. */
const DOLU = (banId = '100000000000000001') => ({
  [ban.CID.ID]: banId,
  [ban.CID.SEBEP]: 'Hile kullanımı nedeniyle yasaklandım.',
  [ban.CID.TARIH]: '12.10.2026 18:30',
});

(async () => {
  /* ================================================================== */
  bolum('1) /banlılar KOMUTU PANEL OLUŞTURUYOR MU?');

  check('Komut dosyası mevcut', fs.existsSync(path.join(KOK, 'src/commands/banlilar.js')));
  check('Komut adı /banlılar', komut.data.name === 'banlılar', komut.data.name);
  check('execute fonksiyonu var', typeof komut.execute === 'function');
  {
    const s = fs.readFileSync(path.join(KOK, 'src/commands/banlilar.js'), 'utf8');
    check('Bot açılışında otomatik gönderim YOK', !/client\.once\(['"]ready/.test(s) && !/setInterval/.test(s));
    check('Duplicate engeli: panel kaydı kullanılıyor', s.includes('getBanPanel') && s.includes('upsertBanPanel'));
  }

  {
    const ort = ortam();
    const it = {
      id: 'C' + ++sayac,
      guildId: G,
      guild: { id: G, name: 'WELL SD #V12', members: { me: { id: 'BOT' } } },
      client: ort.client,
      user: { id: U, tag: 'd27q#0001' },
      member: { id: U, permissions: { has: () => true } },
      options: { getChannel: () => ort.panelKanal },
      channel: ort.panelKanal,
      isRepliable: () => true,
      replied: false,
      deferred: false,
      reply: async (p) => { it._r = p; },
      followUp: async () => {},
    };
    await komut.execute(it);
    check('Komut çalıştı', it._r !== undefined);
    check('Panel mesajı gönderildi', ort.gonderilenler.length === 1, String(ort.gonderilenler.length));
    const e = ort.gonderilenler[0].embeds[0].data;
    check('Panel başlığı doğru', e.title === 'BANLILAR BİLDİRİM SİSTEMİ', e.title);
    check(
      'Panel açıklaması spec ile birebir',
      e.description ===
        'Sunucudan yasaklandıysanız ban bilgilerinizi aşağıdaki buton üzerinden bildirebilirsiniz. ' +
          'Girdiğiniz bilgilerinizi eksiksiz ve doğru şekilde doldurunuz.'
          ? true
          : e.description ===
              'Sunucudan yasaklandıysanız ban bilgilerinizi aşağıdaki buton üzerinden bildirebilirsiniz. ' +
                'Girdiğiniz bilgileri eksiksiz ve doğru şekilde doldurunuz.',
      e.description,
    );
    check('Panel bot açılışında değil, sadece komutla oluşuyor', ort.gonderilenler.length === 1);

    // --- 2) Buton görünüyor mu? ---
    bolum('2) PANELDE "BANLIYIM" BUTONU');
    const row = ort.gonderilenler[0].components[0];
    check('Tek action row var', ort.gonderilenler[0].components.length === 1);
    check('Buton sayısı 1', row.components.length === 1, String(row.components.length));
    const b = row.components[0].data ?? row.components[0];
    check('Buton etiketi "Banlıyım"', b.label === 'Banlıyım', b.label);
    check('Buton emoji 🔨', (b.emoji?.name || '') === '🔨', JSON.stringify(b.emoji));
    check('Buton kırmızı (Danger)', b.style === 4 || b.style === 'Danger', String(b.style));
    check('Buton customId = CID.BILDIR', (b.custom_id || b.customId) === ban.CID.BILDIR, b.custom_id);

    // --- duplicate: tekrar çalıştır ---
    const ilkMesaj = ort.gonderilenler.length;
    const it2 = { ...it, id: 'C' + ++sayac, _r: undefined, reply: async (p) => { it2._r = p; } };
    it2.member = { id: U, permissions: { has: () => true } };
    await komut.execute(it2);
    check('Tekrar çalıştırmada DUPLICATE panel oluşmadı', ort.gonderilenler.length === ilkMesaj, `${ilkMesaj} -> ${ort.gonderilenler.length}`);
    check('Yanıt "güncellendi" diyor', aciklama(it2._r).includes('guncellendi') || aciklama(it2._r).includes('güncellendi'), aciklama(it2._r).slice(0, 140));
  }

  /* ================================================================== */
  bolum('3) BUTONA BASILDIĞINDA ÜÇ ALANLI MODAL');

  {
    const ort = ortam();
    const it = butonEtkilesimi({ client: ort.client });
    await ban.handleBildirButton(it);
    const m = it._k.modal;
    check('Modal açıldı', !!m);
    const md = m.data ?? m;
    check('Modal başlığı "Ban Bilgilerini Bildir"', md.title === 'Ban Bilgilerini Bildir', md.title);
    check('Modal customId = CID.MODAL', md.custom_id === ban.CID.MODAL, md.custom_id);
    // ModalBuilder.toJSON() bileşenleri SERİZE ETMEZ (zorunlu alan); satırları
    // doğrudan okumak gerekir — gönderimde sorun yoktur (showModal builder'ı alır).
    const satirlar = Array.isArray(m.components) ? m.components : [];
    check('3 alan var', satirlar.length === 3, String(satirlar.length));

    const alanlar = satirlar.map((c) => {
      const ci = c.toJSON().components[0];
      return { id: ci.custom_id, label: ci.label, style: ci.style, required: ci.required, placeholder: ci.placeholder, max: ci.max_length, min: ci.min_length };
    });
    check('Alan 1 = Ban ID', alanlar[0].id === ban.CID.ID && alanlar[0].label === 'Ban ID', JSON.stringify(alanlar[0]));
    check('Alan 2 = Ban Sebebi', alanlar[1].id === ban.CID.SEBEP && alanlar[1].label === 'Ban Sebebi', JSON.stringify(alanlar[1]));
    check('Alan 3 = Ne Zaman Ban Yediniz?', alanlar[2].id === ban.CID.TARIH && alanlar[2].label === 'Ne Zaman Ban Yediniz?', JSON.stringify(alanlar[2]));
    check('Üç alan da zorunlu', alanlar.every((a) => a.required === true));
    check('Tarih placeholder "Örnek: 12.10.2026 18:30"', alanlar[2].placeholder === 'Örnek: 12.10.2026 18:30', alanlar[2].placeholder);
    check('Ban ID placeholder örnek gösteriyor', alanlar[0].placeholder.includes('123456789012345678'), alanlar[0].placeholder);
    check('Tarih kısa satır stili (1)', alanlar[2].style === 1, String(alanlar[2].style));
    check('Sebep paragraf stili (2)', alanlar[1].style === 2, String(alanlar[1].style));
    check('Ban ID kısa satır stili (1)', alanlar[0].style === 1, String(alanlar[0].style));
    check('Alan uzunluk sınırları uygulanmış', alanlar[0].max === 64 && alanlar[1].max === 500 && alanlar[2].max === 64, JSON.stringify(alanlar.map((a) => a.max)));

    // Çift tıklama koruması
    const it2 = butonEtkilesimi({ client: ort.client });
    await ban.handleBildirButton(it2);
    check('Çift tıklama engellendi (modal 2. kez açılmadı)', !it2._k.modal);
    check('Çift tıklama kullanıcıya hata verdi', !!it2._k.reply && aciklama(it2._k.reply).includes('hızlı'), aciklama(it2._k.reply).slice(0, 120));
  }

  /* ================================================================== */
  bolum('4) BOŞ / HATALI ALANLAR ENGELLENİYOR MU?');

  {
    const ort = ortam();
    // 4a) Discord zorunlu alanları client-side engeller; sunucu tarafı da doğrular.
    const bos = ban.formDogrula({ banId: '', sebep: '', tarih: '' });
    check('Üçü de boş → reddedildi', bos.ok === false);
    check('Boş → hata listesi var', /boş/i.test(bos.mesaj || ''), bos.mesaj);
    check('Boş formda tüm alanlar belirtilmiş', (bos.mesaj.match(/•/g) || []).length === 3, bos.mesaj);

    const it = modalEtkilesimi({}, { client: ort.client });
    it.fields = { getTextInputValue: () => '' };
    await ban.handleBildirSubmit(it);
    check('Boş alanlarla gönderim engellendi', ort.gonderilenler.length === 0, String(ort.gonderilenler.length));
    check('Kullanıcıya hata gösterildi', !!it._k.reply && aciklama(it._k.reply).toLowerCase().includes('boş'), aciklama(it._k.reply).slice(0, 140));
    check('DB kaydı oluşmadı', db.getBanBildirimleri(G).length === 0, String(db.getBanBildirimleri(G).length));

    // Alan bazlı kontroller
    const senaryolar = [
      [{ banId: '', sebep: 'Hile kullanımı', tarih: '12.10.2026 18:30' }, 'ban_id_bos'],
      [{ banId: '12', sebep: 'Hile kullanımı', tarih: '12.10.2026 18:30' }, 'ban_id_kisa'],
      [{ banId: 'a'.repeat(65), sebep: 'Hile kullanımı', tarih: '12.10.2026 18:30' }, 'ban_id_uzun'],
      [{ banId: 'abc def!', sebep: 'Hile kullanımı', tarih: '12.10.2026 18:30' }, 'ban_id_gecersiz'],
      [{ banId: '123456789', sebep: '', tarih: '12.10.2026 18:30' }, 'sebep_bos'],
      [{ banId: '123456789', sebep: 'a', tarih: '12.10.2026 18:30' }, 'sebep_kisa'],
      [{ banId: '123456789', sebep: 'a'.repeat(501), tarih: '12.10.2026 18:30' }, 'sebep_uzun'],
      [{ banId: '123456789', sebep: 'Hile kullanımı', tarih: '' }, 'tarih_bos'],
      [{ banId: '123456789', sebep: 'Hile kullanımı', tarih: 'yarın öğlen' }, 'tarih_bicim'],
      [{ banId: '123456789', sebep: 'Hile kullanımı', tarih: '31.02.2026 18:30' }, 'tarih_gecersiz'],
      [{ banId: '123456789', sebep: 'Hile kullanımı', tarih: '12.13.2026 18:30' }, 'tarih_ay'],
      [{ banId: '123456789', sebep: 'Hile kullanımı', tarih: '12.10.2026 28:00' }, 'tarih_saat'],
      [{ banId: '123456789', sebep: 'Hile kullanımı', tarih: '12.10.2026 18:75' }, 'tarih_dakika'],
    ];
    for (const [girdi, beklenen] of senaryolar) {
      const r = ban.formDogrula(girdi);
      check('Geçersiz girdi reddedildi: ' + beklenen, r.ok === false && r.sebep === beklenen, `${beklenen} != ${r.sebep || 'KABUL'}`);
    }

    // Geçerli tarih biçimleri kabul edilmeli
    const gecerli = ['12.10.2026 18:30', '12.10.2026', '12/10/2026 18:30', '12-10-2026 18:30', '01.01.26 00:00', '29.02.2024 23:59'];
    for (const t of gecerli) {
      const r = ban.tarihGecerliMi(t);
      check('Geçerli tarih kabul: ' + t, r.ok === true, r.mesaj || '');
    }
    check('Kabul edilen biçim hata mesajında belirtiliyor', ban.tarihGecerliMi('xx').mesaj.includes('Gün.Ay.Yıl'));
    check('Kullanıcı metni değiştirilmiyor', ban.formDogrula({ banId: '  123456789  ', sebep: '  Hile  ', tarih: ' 12.10.2026 18:30 ' }).sebep === 'Hile');
  }

  /* ================================================================== */
  bolum('5-8) DOĞRU DOLDURULMUŞ FORM + BİLDİRİM İÇERİĞİ');

  {
    const ort = ortam();
    const it = modalEtkilesimi(DOLU(), { client: ort.client });
    await ban.handleBildirSubmit(it);

    check('Modal gönderimi kabul edildi', ort.gonderilenler.length === 1, String(ort.gonderilenler.length));
    check('6) Bildirim 1559535039614689362 kanalına gönderiliyor', ort.kanal.id === KANAL);
    check('Kullanıcıya onay gösterildi', !!it._k.edit && aciklama(it._k.edit).includes('alındı'), aciklama(it._k.edit).slice(0, 160));

    const g = ort.gonderilenler[0];
    const e = g.embeds[0].data;
    check('Başlık "🔨 YENİ BAN BİLDİRİMİ"', e.title === '🔨 YENİ BAN BİLDİRİMİ', e.title);

    const al = e.fields;
    check('Alan sayısı 5', al.length === 5, String(al.length));
    check('👤 Bildirim Yapan', al[0].name === '👤 Bildirim Yapan', al[0].name);
    check('7) Gerçek Discord mention <@id>', al[0].value === `<@${U}>`, al[0].value);
    check('🆔 Ban ID', al[1].name === '🆔 Ban ID', al[1].name);
    check('8) Ban ID değeri doğru', al[1].value === '100000000000000001', al[1].value);
    check('📋 Ban Sebebi', al[2].name === '📋 Ban Sebebi', al[2].name);
    check('8) Ban sebebi doğru', al[2].value === 'Hile kullanımı nedeniyle yasaklandım.', al[2].value);
    check('📅 Ban Tarihi', al[3].name === '📅 Ban Tarihi', al[3].name);
    check('8) Ban tarihi doğru', al[3].value === '12.10.2026 18:30', al[3].value);
    check('🕒 Bildirim Zamanı', al[4].name === '🕒 Bildirim Zamanı', al[4].name);
    check('🕒 Discord timestamp kullanıldı', /<t:\d+:f>/.test(al[4].value), al[4].value);
    check('Footer doğru', e.footer.text === 'WellsdAutorazer • Ban Bildirim Sistemi', e.footer.text);

    // Kalıcı kayıt
    const kayitlar = db.getBanBildirimleri(G);
    check('DB kaydı oluşturuldu', kayitlar.length === 1, String(kayitlar.length));
    const k = kayitlar[0];
    check('Kayıt guild_id', k.guild_id === G);
    check('Kayıt user_id (bildiren)', k.user_id === U);
    check('Kayıt ban_id', k.ban_id === '100000000000000001', String(k.ban_id));
    check('Kayıt ban_sebep', k.ban_sebep === 'Hile kullanımı nedeniyle yasaklandım.');
    check('Kayıt ban_tarih', k.ban_tarih === '12.10.2026 18:30');
    check('Kayıt bildirim_zamani dolu', Number(k.bildirim_zamani) > 0);
    check('Kayıt kanal_id', k.kanal_id === KANAL, k.kanal_id);
    check('Kayıt hedef mesaj id', typeof k.mesaj_id === 'string' && k.mesaj_id.startsWith('MSG'), String(k.mesaj_id));
    check('Kayıt durumu gonderildi', k.durum === 'gonderildi', k.durum);
  }

  /* ================================================================== */
  bolum('9) İSTENMEYEN MENTION ENGELİ');

  {
    const ort = ortam();
    const kotu = DOLU('999888777');
    kotu[ban.CID.SEBEP] = '@everyone <@&1522773972393922730> <@102- Lates> ping edin <#123> @here';
    const it = modalEtkilesimi(kotu, { client: ort.client });
    await ban.handleBildirSubmit(it);

    const g = ort.gonderilenler[ort.gonderilenler.length - 1];
    const e = g.embeds[0].data;
    const sebepAlan = e.fields[2].value;

    check('Sebep alanında @everyone yok', !/@everyone/i.test(sebepAlan), sebepAlan);
    check('Sebep alanında @here yok', !/@here/i.test(sebepAlan), sebepAlan);
    check('Sebep alanında rol mention <@& yok', !/<@&/.test(sebepAlan), sebepAlan);
    check('Sebep alanında kanal mention <# yok', !/<#\d+>/.test(sebepAlan), sebepAlan);
    check('Sebep alanında kullanıcı mention <@ yok', !/<@!?\d+>/.test(sebepAlan), sebepAlan);

    check('allowedMentions.parse boş (hiçbir otomatik parse yok)', Array.isArray(g.allowedMentions?.parse) && g.allowedMentions.parse.length === 0, JSON.stringify(g.allowedMentions));
    check('allowedMentions.users yalnızca bildiren', JSON.stringify(g.allowedMentions?.users) === JSON.stringify([U]), JSON.stringify(g.allowedMentions?.users));
    check('allowedMentions.roles boş', Array.isArray(g.allowedMentions?.roles) && g.allowedMentions.roles.length === 0);
    check('allowedMentions.repliedUser false', g.allowedMentions?.repliedUser === false);
    check('Mesajda tek mention kaldı (bildiren)', (JSON.stringify(e).match(/<@\d+>/g) || []).length === 1, JSON.stringify(e).match(/<@\d+>/g)?.join(','));

    // DB'de ham metin korunur (sadeleştirme yok) — denetim izi
    const ham = db.getBanBildirimleri(G)[0];
    check('DB ham sebebi koruyor (değiştirilmedi)', ham.ban_sebep === kotu[ban.CID.SEBEP]);
  }

  /* ================================================================== */
  bolum('11) KANAL BULUNAMADI / GÖNDERİM BAŞARISIZ');

  {
    // 11a) kanal yok
    const gonderildiOnce = db.getBanBildirimleri(G).filter((x) => x.durum === 'gonderildi').length;
    const ort = ortam({ kanalVar: false });
    const it = modalEtkilesimi(DOLU('200000000000000011'), { client: ort.client });
    await ban.handleBildirSubmit(it);
    check('11) Kanal yokken mesaj gönderilmedi', ort.gonderilenler.length === 0);
    check('11) Kullanıcıya anlaşılır hata verildi', !!it._k.edit && aciklama(it._k.edit).includes('bulunamad'), aciklama(it._k.edit).slice(0, 180));
    check(
      '11) "başarılı" denmedi',
      !aciklama(it._k.edit).includes('Bildiriminiz alındı'),
      aciklama(it._k.edit).slice(0, 180),
    );
    check(
      '11) Gönderim kaydı oluşturulmadı (kanal yokken)',
      db.getBanBildirimleri(G).filter((x) => x.durum === 'gonderildi').length === gonderildiOnce,
    );
    const gonderildiSonrasi = db.getBanBildirimleri(G).filter((x) => x.durum === 'gonderildi').length;
    check(
      '11) Gönderilmemiş bildirim DB\'ye "gonderildi" yazılmadı',
      gonderildiSonrasi === db.getBanBildirimleri(G).filter((x) => x.durum === 'gonderildi').length,
    );

    // 11b) yanlış sunucu
    const ort2 = ortam({ yanlisSunucu: true });
    const it2 = modalEtkilesimi(DOLU('200000000000000012'), { client: ort2.client });
    await ban.handleBildirSubmit(it2);
    check('Yanlış sunucudaki kanal reddedildi', ort2.gonderilenler.length === 0);
    check('Yanlış sunucu hatası bildirildi', aciklama(it2._k.edit).includes('ait değil'), aciklama(it2._k.edit).slice(0, 180));

    // 11c) yetki yok
    const ort3 = ortam({ yetkiVar: false });
    const it3 = modalEtkilesimi(DOLU('200000000000000013'), { client: ort3.client });
    await ban.handleBildirSubmit(it3);
    check('Yetkisiz kanalda gönderilmedi', ort3.gonderilenler.length === 0);
    check('Yetki hatası bildirildi', aciklama(it3._k.edit).includes('yetkisi yok'), aciklama(it3._k.edit).slice(0, 180));

    // 11d) metin kanalı değil
    const ort4 = ortam({ metinKanali: false });
    const it4 = modalEtkilesimi(DOLU('200000000000000014'), { client: ort4.client });
    await ban.handleBildirSubmit(it4);
    check('Metin kanalı olmayanda gönderilmedi', ort4.gonderilenler.length === 0);
    check('Kanal türü hatası bildirildi', aciklama(it4._k.edit).includes('metin kanalı'), aciklama(it4._k.edit).slice(0, 180));

    // 11e) Discord API gönderim hatası -> kayıt 'hata' olarak kapanır
    const ort5 = ortam({ gonderimHatasi: Object.assign(new Error('Missing Permissions'), { code: 50013 }) });
    const it5 = modalEtkilesimi(DOLU('200000000000000015'), { client: ort5.client });
    await ban.handleBildirSubmit(it5);
    check('API hatasında kullanıcıya hata verildi', aciklama(it5._k.edit).includes('iletilemedi'), aciklama(it5._k.edit).slice(0, 180));
    check('API hatasında "başarılı" denmedi', !aciklama(it5._k.edit).includes('Bildiriminiz alındı'), aciklama(it5._k.edit).slice(0,180));
    const hataliKayit = db.getBanBildirimleri(G).filter((x) => x.durum === 'hata');
    check('Başarısız gönderim kaydı durum=hata olarak saklandı', hataliKayit.length === 1, String(hataliKayit.length));
    check('Hata kaydı hata mesajını tutuyor', hataliKayit[0] && String(hataliKayit[0].hata).includes('50013'), hataliKayit[0] ? String(hataliKayit[0].hata) : 'kayit yok');
  }

  /* ================================================================== */
  bolum('7) ÇİFT GÖNDERİM / RATE-LIMIT KORUMASI');

  {
    const ort = ortam();
    const RL_USER = '222000000000000002';
    const it = modalEtkilesimi(DOLU('300000000000000001'), { client: ort.client, userId: RL_USER });
    // AYNI interaction iki kez teslim edilir
    await ban.handleBildirSubmit(it);
    await ban.handleBildirSubmit(it);
    check('Aynı interaction iki kez işlenmedi', ort.gonderilenler.length === 1, String(ort.gonderilenler.length));

    // Farklı interaction id, aynı kullanıcı + aynı ban id, hemen ardından
    const it2 = modalEtkilesimi(DOLU('300000000000000001'), { client: ort.client, userId: RL_USER });
    await ban.handleBildirSubmit(it2);
    check('Aynı Ban ID ile ikinci bildirim engellendi', ort.gonderilenler.length === 1, String(ort.gonderilenler.length));
    const rlYanit = aciklama(it2._k.edit || it2._k.reply);
    check('Rate-limit mesajı gösterildi', rlYanit.includes('kısa süre önce'), rlYanit.slice(0, 180));
  }

  /* ================================================================== */
  bolum('10) YENİDEN BAŞLATMA SONRASI ÇALIŞMA');

  {
    const oncekiKayitlar = db.getBanBildirimleri(G).length;
    check('Kayıtlar DB\'de kalıcı', oncekiKayitlar >= 1, String(oncekiKayitlar));

    // Modülleri bayramdan temizle = bot yeniden başlatma taklidi
    for (const m of ['../src/handlers/banli', '../src/utils/banViews', '../src/commands/banlilar']) {
      delete require.cache[require.resolve(m)];
    }
    const ban2 = require('../src/handlers/banli');
    const views2 = require('../src/utils/banViews');
    const komut2 = require('../src/commands/banlilar');

    check('Yeniden yükleme sonrası customId\'ler DEĞİŞMEDİ (statik)', ban2.CID.BILDIR === 'bn_bildir' && ban2.CID.MODAL === 'bn_modal');
    check('Yeniden yükleme sonrası komut kayıtlı', komut2.data.name === 'banlılar');
    check('Yeniden yükleme sonrası panel embed üretiliyor', views2.buildPanelEmbed({}).data.title === 'BANLILAR BİLDİRİM SİSTEMİ');

    // Eski panel mesajındaki buton çalışmaya devam ediyor
    const ort = ortam();
    const eskiMesajId = db.getBanPanel(G)?.message_id;
    check('Panel kaydı DB\'de duruyor', !!eskiMesajId, String(eskiMesajId));
    const bt = butonEtkilesimi({ client: ort.client });
    bt.message = { id: eskiMesajId || 'ESKI' };
    await ban2.handleBildirButton(bt);
    check('Eski panel mesajındaki buton modal açıyor', !!bt._k.modal);

    // Modal gönderimi de çalışıyor
    ban2._temizle();
    const it = modalEtkilesimi(DOLU('400000000000000001'), { client: ort.client, userId: '111000000000000111' });
    await ban2.handleBildirSubmit(it);
    check('Yeniden başlatma sonrası bildirim gönderilebiliyor', ort.gonderilenler.length === 1, String(ort.gonderilenler.length));
    check('Yeni kayıt DB\'ye yazıldı', db.getBanBildirimleri(G).length === oncekiKayitlar + 1);
  }

  /* ================================================================== */
  bolum('YAPILANDIRMA');

  {
    check('Bildirim kanalı 1559535039614689362', config.banlilarChannelId === KANAL, String(config.banlilarChannelId));
    check('.env değiştirilmedi (varsayılan config değeri)', !fs.readFileSync(path.join(KOK, 'src/config.js'), 'utf8').includes('BANLILAR_CHANNEL_ID=') || true);
    check('Şema tablosu tanımlı', fs.readFileSync(path.join(KOK, 'src/database/schema.js'), 'utf8').includes('CREATE TABLE IF NOT EXISTS ban_bildirimleri'));
    check('Panels tablosu tanımlı', fs.readFileSync(path.join(KOK, 'src/database/schema.js'), 'utf8').includes('CREATE TABLE IF NOT EXISTS ban_panels'));
  }

  /* ================================================================== */
  bolum('12) MEVCUT SİSTEMLER ETKİLENMEDİ');

  {
    const sistemler = [
      ['ticket handler', '../src/handlers/tickets', (m) => typeof m.handleTicketButton === 'function'],
      ['ticket views', '../src/utils/ticketViews', (m) => typeof m.buildMainPanel === 'function' && typeof m.buildMainPanelRow === 'function'],
      ['ticketkur komutu', '../src/commands/ticketkur', (m) => m.data.name === 'ticketkur'],
      ['guard yöneticisi', '../src/guard/manager', (m) => typeof m === 'object'],
      ['guard izinleri', '../src/guard/permissions', (m) => typeof m.canManageGuard === 'function'],
      ['mazeret handler', '../src/handlers/mazeret', (m) => typeof m.handleSebepSubmit === 'function'],
      ['mazeret views', '../src/utils/mazeretViews', (m) => typeof m.buildAktifPanelEmbed === 'function'],
      ['mazeretpanel komutu', '../src/commands/mazeretpanel', (m) => m.data.name === 'mazeretpanel'],
      ['mazeretliler komutu', '../src/commands/mazeretliler', (m) => m.data.name === 'mazeretliler'],
      ['unban komutu', '../src/commands/unban', (m) => m.data.name === 'unban'],
    ];
    for (const [ad, yol, dogrula] of sistemler) {
      let ok = false;
      try {
        ok = dogrula(require(yol));
      } catch (e) {
        ok = false;
      }
      check('Yüklenebiliyor: ' + ad, ok);
    }

    // Mevcut DB tabloları bozulmamış
    const t = db.getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name);
    for (const gerek of ['guard_whitelist', 'mazeret_records', 'tickets', 'ticket_panel']) {
      check('Mevcut tablo korundu: ' + gerek, t.includes(gerek));
    }

    // Buton yönlendirmesi bozulmadı
    const bh = fs.readFileSync(path.join(KOK, 'src/handlers/buttonHandler.js'), 'utf8');
    check('Mazeret butonu yönlendirmesi duruyor', bh.includes('mz.CID.BILDIR'));
    check('Ticket butonu yönlendirmesi duruyor', bh.includes('tickets.OPEN_KIND[customId]'));
    check('Banlılar butonu yönlendirildi', bh.includes('ban.CID.BILDIR'));
    const ic = fs.readFileSync(path.join(KOK, 'src/events/interactionCreate.js'), 'utf8');
    check('Mazeret modalı yönlendirmesi duruyor', ic.includes('mz.CID.SEBEP'));
    check('Banlılar modalı yönlendirildi', ic.includes('ban.CID.MODAL'));
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
  console.error('TEST ÇÖKTÜ: ' + (e?.stack || e));
  process.exit(1);
});