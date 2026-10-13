/**
 * BANLILAR BİLDİRİM SİSTEMİ — akış yöneticisi (sıralı soru akışı).
 *
 * Akış:
 *   /banlılarpanel paneli → 🔨 "Banlıyım" butonu
 *      → bot kanalda sorar: 1) Ban ID   2) Ban Sebebi   3) Ban Tarihi
 *      → kullanıcı her soruya kanala yazarak cevap verir
 *      → bildirim 1559535039614689362 kanalına gönderilir
 *
 * TASARIM İLKELERİ
 *  - Bu bir OYUN (FiveM) banı bildirimi; Discord banı değil.
 *  - Ban ID'nin platformu/formatı bize BİLİNMEZ. Oyuncu ne yazarsa yazılmaz
 *    "kullanıcı bildirimi" olarak saklanır; hiçbir yerde banın gerçekleştiği
 *    doğrulanmış gibi sunulmaz. Harici ban sorgu kaynağı yoktur.
 *  - Bildirim, mesaj GÖNDERİLMEDEN önce DB'ye kayıt açılır (gonderiliyor).
 *    Gönderim başarısızsa kayıt 'hata' olarak kapanır → kalıcı iz kaybolmaz ve
 *    kullanıcıya "başarılı" yalanı söylenmez.
 *  - allowedMentions: { parse: [] } + yalnızca bildiren kullanıcı. Kullanıcının
 *    yazdığı metinden hiçbir şekilde rol/kullanıcı/everyone PING'i oluşamaz.
 *  - Aynı kullanıcı aynı anda tek form doldurur (tek oturum). Teknik retry
 *    iki kez bildirim gönderemez (RAM kilidi + DB mesaj_id UNIQUE).
 */
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const {
  CID,
  SORULAR,
  buildSoruMesaji,
  buildTekrarMesaji,
  buildBaslangicMesaji,
  buildBildirimEmbed,
  buildOnayMesaji,
  buildHataMesaji,
  buildIptalMesaji,
} = require('../utils/banViews');
const { buildErrorEmbed } = require('../utils/embeds');
const config = require('../config');
const db = require('../database/database');
const logger = require('../utils/logger');

/* ------------------------------------------------------------------ */
/* Ayarlar                                                             */
/* ------------------------------------------------------------------ */

/** Butona iki kez hızlı basılmasını yakalar (çift tıklama). */
const BUTON_BEKLEME_MS = 4000;
/** Bir sorudan sonra yanıt için beklenecek süre (ms). */
const OTURUM_SURE_MS = 5 * 60 * 1000;
/** Aynı kullanıcı + aynı Ban ID ile tekrar bildirim yasağı (ms). */
const GONDERIM_YASAK_MS = 20_000;

/* ------------------------------------------------------------------ */
/* Bellek içi oturumlar (RAM)                                          */
/* ------------------------------------------------------------------ */

/** anahtar: `${guildId}:${userId}` */
const oturumlar = new Map();
/** son buton basışı (çift tıklama engeli) */
const butonSon = new Map();

const anahtarUret = (guildId, userId) => `${guildId}:${userId}`;

/** Süresi dolmuş oturumları temizler — map süresiz büyümez. */
function _temizle() {
  const simdi = Date.now();
  for (const [k, v] of oturumlar) if (simdi - v.sonZaman > OTURUM_SURE_MS) oturumlar.delete(k);
  for (const [k, v] of butonSon) if (simdi - v > 600_000) butonSon.delete(k);
}

/* ------------------------------------------------------------------ */
/* Yanıt doğrulama                                                     */
/* ------------------------------------------------------------------ */

/** Kontrol karakteri (satır sonu/tab dışı) ve aşırı uzunluk engellenir. */
const KONTROL_KAR = /[\u0000-\u001F\u007F]/; // LF/CR/TAB dahil

/**
 * Ban ID — oyuncu istediğini yazabilir. Yalnızca boş/çok uzun/kontrol karakterli
 * girdiler elenir. Format Dayatılmaz, DOĞRULAMA YAPILMAZ.
 */
function banIdGecerliMi(deger) {
  const s = String(deger ?? '').trim();
  if (!s) return { ok: false, sebep: 'ban_id_bos', mesaj: 'Ban ID boş bırakılamaz.' };
  if (KONTROL_KAR.test(s))
    return { ok: false, sebep: 'ban_id_karakter', mesaj: 'Ban ID satır sonu veya özel karakter içeremez.' };
  if (s.length < 2)
    return { ok: false, sebep: 'ban_id_kisa', mesaj: 'Ban ID en az 2 karakter olmalıdır.' };
  if (s.length > 128)
    return { ok: false, sebep: 'ban_id_uzun', mesaj: 'Ban ID en fazla 128 karakter olabilir.' };
  return { ok: true, deger: s };
}

/** Ban sebebi — özgür metin. */
function sebepGecerliMi(deger) {
  const s = String(deger ?? '').trim();
  if (!s) return { ok: false, sebep: 'sebep_bos', mesaj: 'Ban sebebi boş bırakılamaz.' };
  if (KONTROL_KAR.test(s))
    return { ok: false, sebep: 'sebep_karakter', mesaj: 'Ban sebebi satır sonu veya özel karakter içeremez.' };
  if (s.length < 2)
    return { ok: false, sebep: 'sebep_kisa', mesaj: 'Ban sebebi en az 2 karakter olmalıdır.' };
  if (s.length > 900)
    return { ok: false, sebep: 'sebep_uzun', mesaj: `Ban sebebi en fazla 900 karakter olabilir (şu an ${s.length}).` };
  return { ok: true, deger: s };
}

/**
 * Tarih kabul biçimi: `Gün.Ay.Yıl Saat:dakika` (ayrılıcı: . / -)
 * Gerçek bir tarih olmalıdır (31.02 gibi sahte tarihler elenir).
 */
const TARIH_DESEN = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})(?:[\sT]+(\d{1,2})[:.](\d{2}))?$/;

function tarihGecerliMi(deger) {
  const s = String(deger ?? '').trim();
  if (!s) return { ok: false, sebep: 'tarih_bos', mesaj: 'Ban tarihi boş bırakılamaz.' };
  if (s.length > 64)
    return { ok: false, sebep: 'tarih_uzun', mesaj: 'Ban tarihi en fazla 64 karakter olabilir.' };

  const m = TARIH_DESEN.exec(s);
  if (!m)
    return {
      ok: false,
      sebep: 'tarih_bicim',
      mesaj:
        'Tarih bu biçimde olmalıdır: **Gün.Ay.Yıl Saat:dakika**\n' +
        'Örnekler: `12.10.2026 18:30` · `12.10.2026` · `12/10/2026 18:30`',
    };

  const gun = Number(m[1]);
  const ay = Number(m[2]);
  let yil = Number(m[3]);
  const saat = m[4] === undefined ? null : Number(m[4]);
  const dakika = m[5] === undefined ? null : Number(m[5]);
  if (yil < 100) yil += 2000;

  if (gun < 1 || gun > 31)
    return { ok: false, sebep: 'tarih_gun', mesaj: 'Gün 1-31 arasında olmalıdır.' };
  if (ay < 1 || ay > 12)
    return { ok: false, sebep: 'tarih_ay', mesaj: 'Ay 1-12 arasında olmalıdır.' };
  if (yil < 2000 || yil > 2100)
    return { ok: false, sebep: 'tarih_yil', mesaj: 'Yıl 2000-2100 arasında olmalıdır.' };
  if (saat !== null && (saat < 0 || saat > 23))
    return { ok: false, sebep: 'tarih_saat', mesaj: 'Saat 0-23 arasında olmalıdır.' };
  if (dakika !== null && (dakika < 0 || dakika > 59))
    return { ok: false, sebep: 'tarih_dakika', mesaj: 'Dakika 0-59 arasında olmalıdır.' };

  const d = new Date(Date.UTC(yil, ay - 1, gun));
  if (d.getUTCFullYear() !== yil || d.getUTCMonth() !== ay - 1 || d.getUTCDate() !== gun)
    return { ok: false, sebep: 'tarih_gecersiz', mesaj: 'Bu tarih gerçek değil. Lütfen doğru tarihi giriniz.' };

  return { ok: true, deger: s };
}

/** Adım bazında doğrulama. */
function alanDogrula(adim, deger) {
  if (adim === 'id') return banIdGecerliMi(deger);
  if (adim === 'sebep') return sebepGecerliMi(deger);
  if (adim === 'tarih') return tarihGecerliMi(deger);
  return { ok: false, sebep: 'bilinmeyen_adim', mesaj: 'Bilinmeyen adım.' };
}

/**
 * Üç alanın tamamını doğrular (testler ve toplu kontrol için).
 * Kullanıcının metni DEĞİŞTİRİLMEZ, yalnızca kenar boşlukları temizlenir.
 */
function formDogrula({ banId, sebep, tarih } = {}) {
  const id = banIdGecerliMi(banId);
  const sb = sebepGecerliMi(sebep);
  const tr = tarihGecerliMi(tarih);
  const hatalar = [id, sb, tr].filter((x) => !x.ok);
  if (hatalar.length) {
    return {
      ok: false,
      sebep: hatalar[0].sebep,
      mesaj:
        hatalar.length === 1
          ? hatalar[0].mesaj
          : 'Eksik/hatalı alanlar var:\n• ' + hatalar.map((x) => x.mesaj.split('\n')[0]).join('\n• '),
    };
  }
  return { ok: true, banId: id.deger, sebep: sb.deger, tarih: tr.deger, hatalar: [] };
}

/* ------------------------------------------------------------------ */
/* Bildirim kanalı çözümleme + doğrulama                                */
/* ------------------------------------------------------------------ */

const KANAL_HATASI = {
  kanal_yapilandirilmamis: 'Bildirim kanalı yapılandırılmamış. Lütfen yetkiliye bildirin.',
  kanal_bulunamadi: 'Bildirim kanalı bulunamadı. Bilgileriniz kayıt altına alındı ama iletilemedi.',
  kanal_tur_hatali: 'Bildirim kanalı bir metin kanalı değil.',
  kanal_gonderilemiyor: 'Bildirim kanalına mesaj gönderilemiyor.',
  yanlis_sunucu: 'Bildirim kanalı bu sunucuya ait değil.',
  izin_alinamadi: 'Botun bildirim kanalı için yetkisi okunamadı.',
  yetki_yok: 'Botun bildirim kanalında mesaj/embed gönderme yetkisi yok.',
};

/**
 * Kanali çeker ve gönderime uygunluğunu doğrular.
 * @returns {Promise<{ok:true, kanal:object}|{ok:false, sebep:string, detay?:string}>}
 */
async function bildirimKanaliniBul(client, guildId) {
  const kanalId = config.banlilarChannelId;
  if (!kanalId) return { ok: false, sebep: 'kanal_yapilandirilmamis' };

  let kanal;
  try {
    kanal = await client.channels.fetch(kanalId);
  } catch (err) {
    logger.warn(`[ban] bildirim kanalı çekilemedi (${kanalId}): ${err?.code || err?.message}`);
    return { ok: false, sebep: 'kanal_bulunamadi', detay: String(err?.code || err?.message || err) };
  }
  if (!kanal) return { ok: false, sebep: 'kanal_bulunamadi' };
  if (kanal.isDMBased?.()) return { ok: false, sebep: 'kanal_tur_hatali' };
  if (!kanal.isTextBased?.()) return { ok: false, sebep: 'kanal_tur_hatali' };
  if (typeof kanal.isSendable === 'function' && !kanal.isSendable())
    return { ok: false, sebep: 'kanal_gonderilemiyor' };
  if (kanal.guildId && kanal.guildId !== String(guildId)) return { ok: false, sebep: 'yanlis_sunucu' };

  const guild = client.guilds?.cache?.get(String(guildId));
  const me = guild?.members?.me;
  if (me) {
    let p = null;
    try {
      p = kanal.permissionsFor(me);
    } catch (err) {
      logger.warn(`[ban] kanal izinleri okunamadı (${kanalId}): ${err?.message}`);
    }
    if (!p) return { ok: false, sebep: 'izin_alinamadi' };
    const gerek = [
      ['ViewChannel', PermissionFlagsBits.ViewChannel],
      ['SendMessages', PermissionFlagsBits.SendMessages],
      ['EmbedLinks', PermissionFlagsBits.EmbedLinks],
    ];
    const yok = gerek.filter(([, bit]) => !p.has(bit)).map(([ad]) => ad);
    if (yok.length) return { ok: false, sebep: 'yetki_yok', detay: yok.join(',') };
  }

  return { ok: true, kanal };
}

/* ------------------------------------------------------------------ */
/* 1) Buton → oturum başlat + 1. soru                                  */
/* ------------------------------------------------------------------ */

async function handleBildirButton(interaction) {
  try {
    if (!interaction.guildId) {
      await interaction
        .reply({ embeds: [buildErrorEmbed('Bu panel yalnızca sunucuda kullanılabilir.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return true;
    }

    _temizle();
    const guildId = String(interaction.guildId);
    const uid = String(interaction.user.id);
    const simdi = Date.now();

    // Zaten açık bir form var mı?
    const mevcut = oturumlar.get(anahtarUret(guildId, uid));
    if (mevcut) {
      await interaction
        .reply({
          embeds: [
            buildErrorEmbed(
              'Zaten bir ban bildirim formu dolduruyorsunuz. Bitirin ya da **"iptal"** yazın.',
            ),
          ],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return true;
    }

    // Çift tıklama engeli
    const son = butonSon.get(uid) || 0;
    if (simdi - son < BUTON_BEKLEME_MS) {
      await interaction
        .reply({
          embeds: [buildErrorEmbed('Butona çok hızlı basıyorsun. Birkaç saniye sonra tekrar dene.')],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return true;
    }
    butonSon.set(uid, simdi);

    oturumlar.set(anahtarUret(guildId, uid), {
      guildId,
      kanalId: String(interaction.channelId),
      userId: uid,
      adim: SORULAR[0].adim,
      veri: {},
      baslangic: simdi,
      sonZaman: simdi,
    });

    await interaction.reply(buildBaslangicMesaji(uid));
    await interaction.channel.send({ content: buildSoruMesaji(SORULAR[0].adim, uid) });

    logger.info(`[ban] form başladı: ${guildId}/${uid} kanal ${interaction.channelId}`);
    return true;
  } catch (err) {
    logger.error(`[ban] oturum başlatılamadı id=${interaction.id}`, err);
    try {
      const payload = {
        embeds: [buildErrorEmbed('Ban bildirim formu başlatılamadı. Lütfen tekrar deneyin.')],
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    } catch {
      /* interaction süresi dolmuş olabilir — ASIL hata yukarıda loglandı */
    }
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* 2) Kullanıcının cevabı (messageCreate)                             */
/* ------------------------------------------------------------------ */

/**
 * Kanaldaki kullanıcı mesajını kontrol eder; aktif oturum varsa ilerletir.
 * @returns {Promise<boolean>} true = bu mesaj bir form yanıtıydı
 */
async function handleCevap(message) {
  _temizle();
  const guildId = String(message.guildId);
  const uid = String(message.author?.id);
  const anahtar = anahtarUret(guildId, uid);

  const oturum = oturumlar.get(anahtar);
  if (!oturum) return false;
  if (String(message.channelId) !== oturum.kanalId) return false; // başka kanalda — dokunma

  const metin = String(message.content || '').trim();
  oturum.sonZaman = Date.now();

  // İptal
  if (/^iptal$/i.test(metin)) {
    oturumlar.delete(anahtar);
    await message.reply({ content: buildIptalMesaji(uid) }).catch(() => {});
    logger.info(`[ban] form iptal edildi: ${guildId}/${uid}`);
    return true;
  }

  // Yanıt uygun değil → aynı soru tekrar sorulur
  const d = alanDogrula(oturum.adim, metin);
  if (!d.ok) {
    await message.reply({ content: buildTekrarMesaji(oturum.adim, uid, d.mesaj) }).catch(() => {});
    return true;
  }

  oturum.veri[oturum.adim] = d.deger;

  // Sonraki soru
  const idx = SORULAR.findIndex((s) => s.adim === oturum.adim);
  if (idx + 1 < SORULAR.length) {
    oturum.adim = SORULAR[idx + 1].adim;
    await message.reply({ content: buildSoruMesaji(oturum.adim, uid) }).catch(() => {});
    return true;
  }

  // Son soru bitti → bildirim gönder
  await _gonder(oturum, message);
  return true;
}

/* ------------------------------------------------------------------ */
/* 3) Bildirimi gönder + kalıcı kayıt                                  */
/* ------------------------------------------------------------------ */

async function _gonder(oturum, message) {
  const anahtar = anahtarUret(oturum.guildId, oturum.userId);
  const uid = oturum.userId;
  const guildId = oturum.guildId;
  const simdi = Date.now();

  const hataBildir = async (metin) => {
    oturumlar.delete(anahtar);
    await message.reply({ content: buildHataMesaji({ userId: uid, metin }) }).catch(() => {});
  };

  // --- Kanal kontrolü ---
  const k = await bildirimKanaliniBul(message.client, guildId);
  if (!k.ok) {
    logger.error(`[ban] bildirim kanalı kullanılamaz (${k.sebep}${k.detay ? ' / ' + k.detay : ''})`);
    return hataBildir(KANAL_HATASI[k.sebep] || 'Bildirim gönderilemedi.');
  }

  // --- Aynı kullanıcı + aynı Ban ID kısa süre içinde tekrar bildirim yapamaz ---
  if (db.countRecentBanBildirimi(guildId, uid, oturum.veri.id, GONDERIM_YASAK_MS) > 0) {
    return hataBildir(
      `Aynı Ban ID ile kısa süre önce bildirim gönderdiniz. ${Math.round(
        GONDERIM_YASAK_MS / 1000,
      )} saniye sonra tekrar deneyebilirsiniz.`,
    );
  }

  // --- DB kaydı ÖNCE (mesaj gönderilmeden) ---
  const kayit = db.createBanBildirimi({
    guildId,
    userId: uid,
    banId: oturum.veri.id,
    sebep: oturum.veri.sebep,
    banTarih: oturum.veri.tarih,
    kanalId: k.kanal.id,
    now: simdi,
  });
  if (!kayit.ok) {
    return hataBildir('Bildirim kaydedilemedi, bu yüzden gönderilmedi. Lütfen tekrar deneyin.');
  }

  // --- Bildirimi gönder ---
  let mesaj = null;
  let hata = null;
  try {
    mesaj = await k.kanal.send({
      embeds: [
        buildBildirimEmbed({
          userId: uid,
          banId: oturum.veri.id,
          sebep: oturum.veri.sebep,
          tarih: oturum.veri.tarih,
          now: simdi,
        }),
      ],
      // SADECE bildiren kullanıcı etiketlenebilir.
      allowedMentions: { parse: [], users: [uid], roles: [], repliedUser: false },
    });
  } catch (err) {
    hata = err;
  }

  if (!mesaj) {
    const hataKodu = String(hata?.code || hata?.message || hata).slice(0, 200);
    db.completeBanBildirimi(kayit.id, { mesajId: null, durum: 'hata', hata: hataKodu });
    logger.error(`[ban] bildirim gönderilemedi (${k.kanal.id}) user=${uid}: ${hataKodu}`);
    return hataBildir('Bildiriminiz kanala iletilemedi. Hata kayıt altına alındı, lütfen biraz sonra tekrar deneyin.');
  }

  // --- Gönderildi: kaydı tamamla ---
  const u = db.completeBanBildirimi(kayit.id, { mesajId: mesaj.id, durum: 'gonderildi' });
  oturumlar.delete(anahtar);

  logger.success(
    `/banlılarpanel bildirimi gönderildi: ${uid} → kanal ${k.kanal.id}, mesaj ${mesaj.id} (kayıt #${kayit.id})`,
  );

  if (!u.ok) {
    logger.error(`[ban] kayıt #${kayit.id} tamamlanamadı (mesaj gönderildi: ${mesaj.id})`);
    return hataBildir('Bildiriminiz kanala iletildi ancak kaydı tamamlanamadı. Yetkiliye bildirin.');
  }

  await message
    .reply({ content: buildOnayMesaji({ userId: uid, kanalId: k.kanal.id }) })
    .catch(() => {});
  return true;
}

module.exports = {
  CID,
  SORULAR,
  BUTON_BEKLEME_MS,
  OTURUM_SURE_MS,
  GONDERIM_YASAK_MS,
  banIdGecerliMi,
  sebepGecerliMi,
  tarihGecerliMi,
  alanDogrula,
  formDogrula,
  bildirimKanaliniBul,
  handleBildirButton,
  handleCevap,
  KANAL_HATASI,
  oturumlar,
  butonSon,
  _temizle,
};