/**
 * BANLILAR BİLDİRİM SİSTEMİ — akış yöneticisi (EPHEMERAL, etkileşim tabanlı).
 *
 * Akış:
 *   /banlılarpanel → 🔨 "Banlıyım"
 *      → 1/3 Ban ID     : "Ban ID Yaz" düğmesi → yazma penceresi
 *      → 2/3 Ban Sebebi : "Ban Sebebi Yaz" düğmesi → yazma penceresi
 *      → 3/3 Ban Tarihi : hazır düğmeler (1 gün önce / 1 hafta önce / 1 ay önce ...)
 *      → bildirim 1559535039614689362 kanalına
 *
 * Kullanıcı KANALA MESAJ YAZMAZ. Tüm sorular ve cevaplar yalnızca ona görünür
 * (ephemeral). messageCreate dinlenmez.
 *
 * TASARIM İLKELERİ
 *  - Oyun (FiveM) banı bildirimi; Discord banı değil. Ban ID doğrulanmaz —
 *    kullanıcı ne yazarsa "kullanıcı bildirimi" olarak saklanır.
 *  - Oturum DB'de tutulur → bot yeniden başlasa bile form KAYBOLMAZ.
 *  - Mesaj gönderilmeden önce DB kaydı açılır; gönderim başarısızsa kayıt
 *    'hata' olarak kapanır → kalıcı iz kaybolmaz, "başarılı" yalanı söylenmez.
 *  - allowedMentions: { parse: [] } + yalnızca bildiren kullanıcı → PING yok.
 *  - Aynı kullanıcının tek formu olur; aynı Ban ID ile kısa sürede ikinci
 *    bildirim gönderilemez (RAM değil DB sayacı — restart'a dayanıklı).
 */
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const {
  CID,
  ADIMLAR,
  TARIH_SECENEKLERI,
  tarihSecenekBul,
  buildIdModal,
  buildSebepModal,
  buildTarihOzelModal,
  buildSoruMesaji,
  buildTamamMesaji,
  buildIptalMesaji,
  buildHataMesaji,
  buildBildirimEmbed,
} = require('../utils/banViews');
const { buildErrorEmbed } = require('../utils/embeds');
const config = require('../config');
const db = require('../database/database');
const logger = require('../utils/logger');

/* ------------------------------------------------------------------ */
/* Ayarlar                                                             */
/* ------------------------------------------------------------------ */

/** Butona iki kez hızlı basılmasını yakalar. */
const BUTON_BEKLEME_MS = 4000;
/** Aynı kullanıcı + aynı Ban ID ile tekrar bildirim yasağı. */
const GONDERIM_YASAK_MS = 20 * 60 * 1000; // 20 dk

const sonButon = new Map();

/* ------------------------------------------------------------------ */
/* Doğrulama                                                           */
/* ------------------------------------------------------------------ */

const KONTROL_KAR = /[\u0000-\u001F\u007F]/; // LF/CR/TAB dahil

/** Ban ID — oyuncu istediğini yazabilir; format dayatılmaz, doğrulama yapılmaz. */
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

/** Özel yazılan tarih: `Gün.Ay.Yıl Saat:dakika`, gerçek bir tarih olmalı. */
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
        'Örnekler: `12.10.2026 18:30` · `12.10.2026` · `12/10/2026 18:30`\n' +
        'Veya yukarıdaki hazır seçeneklerden birini kullanın.',
    };

  const gun = Number(m[1]);
  const ay = Number(m[2]);
  let yil = Number(m[3]);
  const saat = m[4] === undefined ? null : Number(m[4]);
  const dakika = m[5] === undefined ? null : Number(m[5]);
  if (yil < 100) yil += 2000;

  if (gun < 1 || gun > 31) return { ok: false, sebep: 'tarih_gun', mesaj: 'Gün 1-31 arasında olmalıdır.' };
  if (ay < 1 || ay > 12) return { ok: false, sebep: 'tarih_ay', mesaj: 'Ay 1-12 arasında olmalıdır.' };
  if (yil < 2000 || yil > 2100) return { ok: false, sebep: 'tarih_yil', mesaj: 'Yıl 2000-2100 arasında olmalıdır.' };
  if (saat !== null && (saat < 0 || saat > 23))
    return { ok: false, sebep: 'tarih_saat', mesaj: 'Saat 0-23 arasında olmalıdır.' };
  if (dakika !== null && (dakika < 0 || dakika > 59))
    return { ok: false, sebep: 'tarih_dakika', mesaj: 'Dakika 0-59 arasında olmalıdır.' };

  const d = new Date(Date.UTC(yil, ay - 1, gun));
  if (d.getUTCFullYear() !== yil || d.getUTCMonth() !== ay - 1 || d.getUTCDate() !== gun)
    return { ok: false, sebep: 'tarih_gecersiz', mesaj: 'Bu tarih gerçek değil. Lütfen doğru tarihi giriniz.' };

  return { ok: true, deger: s };
}

/* ------------------------------------------------------------------ */
/* Bildirim kanalı                                                      */
/* ------------------------------------------------------------------ */

const KANAL_HATASI = {
  kanal_yapilandirilmamis: 'Bildirim kanalı yapılandırılmamış. Lütfen yetkiliye bildirin.',
  kanal_bulunamadi: 'Bildirim kanalı bulunamadı. Bilgileriniz kayda geçti ama iletilemedi.',
  kanal_tur_hatali: 'Bildirim kanalı bir metin kanalı değil.',
  kanal_gonderilemiyor: 'Bildirim kanalına mesaj gönderilemiyor.',
  yanlis_sunucu: 'Bildirim kanalı bu sunucuya ait değil.',
  izin_alinamadi: 'Botun bildirim kanalı için yetkisi okunamadı.',
  yetki_yok: 'Botun bildirim kanalında mesaj/embed gönderme yetkisi yok.',
};

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
/* Oturum yardımcıları                                                 */
/* ------------------------------------------------------------------ */

const EPH = { flags: MessageFlags.Ephemeral };

/** Oturumu getirir; yoksa kullanıcıya "baştan başla" mesajı verir. */
function _oturum(interaction) {
  const o = db.getBanOturum(interaction.guildId, interaction.user.id);
  if (!o) return null;
  return { guildId: String(o.guild_id), userId: String(o.user_id), kanalId: String(o.kanal_id), adim: o.adim, veri: o.veri || {} };
}

async function _hata(interaction, metin) {
  const p = { ...buildHataMesaji(metin), ...EPH };
  try {
    if (interaction.isRepliable?.()) {
      if (interaction.replied || interaction.deferred) await interaction.followUp(p);
      else await interaction.reply(p);
    }
  } catch (e) {
    logger.warn(`[ban] hata mesajı gösterilemedi: ${e?.code || e?.message}`);
  }
  return true;
}

/** Sonraki adımı gösterir; son adımdaysa bildirimi gönderir. */
async function _ilerle(interaction, oturum) {
  const idx = ADIMLAR.findIndex((s) => s.adim === oturum.adim);
  if (idx + 1 < ADIMLAR.length) {
    oturum.adim = ADIMLAR[idx + 1].adim;
    db.upsertBanOturum({
      guildId: oturum.guildId,
      userId: oturum.userId,
      kanalId: oturum.kanalId,
      adim: oturum.adim,
      veri: oturum.veri,
    });
    const g = buildSoruMesaji(oturum.adim, oturum.veri);
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp({ ...g, ...EPH });
      else await interaction.reply({ ...g, ...EPH });
    } catch (e) {
      logger.warn(`[ban] sonraki soru gösterilemedi: ${e?.code || e?.message}`);
    }
    return true;
  }
  return _gonder(interaction, oturum);
}

/* ------------------------------------------------------------------ */
/* 1) Panel butonu → 1. soru                                           */
/* ------------------------------------------------------------------ */

async function handleBildirButton(interaction) {
  try {
    if (!interaction.guildId) {
      return interaction
        .reply({ embeds: [buildErrorEmbed('Bu panel yalnızca sunucuda kullanılabilir.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    const guildId = String(interaction.guildId);
    const uid = String(interaction.user.id);
    db.temizleBanOturumlar();

    // Zaten açık bir form var mı?
    if (db.getBanOturum(guildId, uid)) {
      return interaction
        .reply({
          embeds: [
            buildErrorEmbed(
              'Zaten bir ban bildirim formu dolduruyorsunuz. Kaldığınız yerden devam edin ya da **İptal** düğmesini kullanın.',
            ),
          ],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }

    // Çift tıklama engeli
    const simdi = Date.now();
    const son = sonButon.get(uid) || 0;
    if (simdi - son < BUTON_BEKLEME_MS) {
      return interaction
        .reply({
          embeds: [buildErrorEmbed('Düğmeye çok hızlı basıyorsun. Birkaç saniye sonra tekrar dene.')],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
    sonButon.set(uid, simdi);

    const kaydedildi = db.upsertBanOturum({
      guildId,
      userId: uid,
      kanalId: String(interaction.channelId),
      adim: ADIMLAR[0].adim,
      veri: {},
    });
    if (!kaydedildi) return _hata(interaction, 'Form başlatılamadı. Lütfen tekrar deneyin.');

    const g = buildSoruMesaji(ADIMLAR[0].adim, {});
    await interaction.reply({ ...g, ...EPH }).catch(() => {});
    logger.info(`[ban] form başladı: ${guildId}/${uid} kanal ${interaction.channelId}`);
    return true;
  } catch (err) {
    logger.error(`[ban] oturum başlatılamadı id=${interaction.id}`, err);
    return _hata(interaction, 'Ban bildirim formu başlatılamadı. Lütfen tekrar deneyin.');
  }
}

/* ------------------------------------------------------------------ */
/* 2) Butonlar: yazma penceresi / tarih seçimi / iptal                 */
/* ------------------------------------------------------------------ */

async function handleButon(interaction) {
  const customId = String(interaction.customId || '');

  // İptal
  if (customId === CID.IPTAL) {
    db.deleteBanOturum(interaction.guildId, interaction.user.id);
    const p = { ...buildIptalMesaji(), ...EPH };
    if (interaction.replied || interaction.deferred) await interaction.followUp(p).catch(() => {});
    else await interaction.reply(p).catch(() => {});
    return true;
  }

  const oturum = _oturum(interaction);
  if (!oturum) {
    return _hata(interaction, 'Bu form artık açık değil. Panel üzerindeki **Banlıyım** düğmesiyle tekrar başlayın.');
  }

  // Yazma pencereleri (yalnızca metin girdisi için)
  if (customId === CID.ID_YAZ) {
    if (oturum.adim !== 'id') return _hata(interaction, 'Bu adımda değilsiniz. Lütfen formu baştan başlatın.');
    await interaction.showModal(buildIdModal()).catch((e) => logger.warn(`[ban] modal: ${e?.code || e?.message}`));
    return true;
  }
  if (customId === CID.SEBEP_YAZ) {
    if (oturum.adim !== 'sebep') return _hata(interaction, 'Bu adımda değilsiniz. Lütfen formu baştan başlatın.');
    await interaction.showModal(buildSebepModal()).catch((e) => logger.warn(`[ban] modal: ${e?.code || e?.message}`));
    return true;
  }
  if (customId === CID.TARIH_OZEL_YAZ) {
    if (oturum.adim !== 'tarih') return _hata(interaction, 'Bu adımda değilsiniz. Lütfen formu baştan başlatın.');
    await interaction.showModal(buildTarihOzelModal()).catch((e) => logger.warn(`[ban] modal: ${e?.code || e?.message}`));
    return true;
  }

  // Hazır tarih seçimi: bn_tarih:<id>
  if (customId.startsWith(CID.TARIH_SEC + ':')) {
    const secenekId = customId.slice(CID.TARIH_SEC.length + 1);
    const o = tarihSecenekBul(secenekId);
    if (!o) return _hata(interaction, 'Geçersiz tarih seçeneği.');
    if (oturum.adim !== 'tarih') return _hata(interaction, 'Bu adımda değilsiniz. Lütfen formu baştan başlatın.');
    if (!oturum.veri.id || !oturum.veri.sebep) return _hata(interaction, 'Önce Ban ID ve Ban Sebebi girilmeli.');
    oturum.veri.tarih = o.etiket;
    logger.info(`[ban] ${interaction.user.tag} tarih seçti: ${o.etiket}`);
    return _ilerle(interaction, oturum);
  }

  return false;
}

/* ------------------------------------------------------------------ */
/* 3) Yazma penceresi gönderimi                                        */
/* ------------------------------------------------------------------ */

async function handleModalSubmit(interaction) {
  const customId = String(interaction.customId || '');
  const adim = customId === CID.ID_MODAL ? 'id' : customId === CID.SEBEP_MODAL ? 'sebep' : customId === CID.TARIH_OZEL_MODAL ? 'tarih' : null;
  if (!adim) return false;

  const oturum = _oturum(interaction);
  if (!oturum) return _hata(interaction, 'Bu form artık açık değil. Panel üzerindeki **Banlıyım** düğmesiyle tekrar başlayın.');
  if (oturum.adim !== adim)
    return _hata(interaction, 'Bu adımda değilsiniz. Lütfen formu baştan başlatın.');

  let ham = '';
  try {
    ham = interaction.fields.getTextInputValue('deger');
  } catch (err) {
    logger.error(`[ban] modal alanı okunamadı: ${customId}`, err);
    return _hata(interaction, 'Yazdığınız bilgi okunamadı. Lütfen tekrar deneyin.');
  }

  const d = adim === 'id' ? banIdGecerliMi(ham) : adim === 'sebep' ? sebepGecerliMi(ham) : tarihGecerliMi(ham);
  if (!d.ok) {
    logger.info(`[ban] geçersiz girdi (${adim}, ${interaction.user.id}): ${d.sebep}`);
    const g = buildSoruMesaji(adim, oturum.veri);
    g.embeds[0].addFields({ name: '⚠️ Girdiniz kabul edilmedi', value: d.mesaj });
    const p = { ...g, ...EPH };
    if (interaction.replied || interaction.deferred) await interaction.followUp(p).catch(() => {});
    else await interaction.reply(p).catch(() => {});
    return true;
  }

  oturum.veri[adim] = d.deger;
  return _ilerle(interaction, oturum);
}

/* ------------------------------------------------------------------ */
/* 4) Bildirimi gönder + kalıcı kayıt                                  */
/* ------------------------------------------------------------------ */

async function _gonder(interaction, oturum) {
  const uid = oturum.userId;
  const guildId = oturum.guildId;
  const simdi = Date.now();

  const hataBildir = async (metin) => {
    db.deleteBanOturum(guildId, uid);
    await _hata(interaction, metin);
    return true;
  };

  // Kanal kontrolü
  const k = await bildirimKanaliniBul(interaction.client, guildId);
  if (!k.ok) {
    logger.error(`[ban] bildirim kanalı kullanılamaz (${k.sebep}${k.detay ? ' / ' + k.detay : ''})`);
    return hataBildir(KANAL_HATASI[k.sebep] || 'Bildirim gönderilemedi.');
  }

  // Aynı kullanıcı + aynı Ban ID kısa sürede tekrar bildirim yapamaz
  if (db.countRecentBanBildirimi(guildId, uid, oturum.veri.id, GONDERIM_YASAK_MS) > 0) {
    return hataBildir(
      'Aynı Ban ID ile kısa süre önce bildirim gönderdiniz. Lütfen biraz sonra tekrar deneyin.',
    );
  }

  // DB kaydı ÖNCE (mesaj gönderilmeden)
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

  // Gönder
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
      allowedMentions: { parse: [], users: [uid], roles: [], repliedUser: false },
    });
  } catch (err) {
    hata = err;
  }

  if (!mesaj) {
    const hataKodu = String(hata?.code || hata?.message || hata).slice(0, 200);
    db.completeBanBildirimi(kayit.id, { mesajId: null, durum: 'hata', hata: hataKodu });
    logger.error(`[ban] bildirim gönderilemedi (${k.kanal.id}) user=${uid}: ${hataKodu}`);
    return hataBildir('Bildiriminiz kanala iletilemedi. Sorun kayda geçti, lütfen biraz sonra tekrar deneyin.');
  }

  const u = db.completeBanBildirimi(kayit.id, { mesajId: mesaj.id, durum: 'gonderildi' });
  db.deleteBanOturum(guildId, uid);

  logger.success(
    `/banlılarpanel bildirimi gönderildi: ${uid} → kanal ${k.kanal.id}, mesaj ${mesaj.id} (kayıt #${kayit.id})`,
  );

  if (!u.ok) {
    logger.error(`[ban] kayıt #${kayit.id} tamamlanamadı (mesaj gönderildi: ${mesaj.id})`);
    return hataBildir('Bildiriminiz kanala iletildi ancak kaydı tamamlanamadı. Yetkiliye bildirin.');
  }

  const p = { ...buildTamamMesaji({ userId: uid, kanalId: k.kanal.id }), ...EPH };
  if (interaction.replied || interaction.deferred) await interaction.followUp(p).catch(() => {});
  else await interaction.reply(p).catch(() => {});
  return true;
}

/* ------------------------------------------------------------------ */
/* Tek giriş noktası (buttonHandler + interactionCreate çağırır)        */
/* ------------------------------------------------------------------ */

async function handleEtkilesim(interaction) {
  if (typeof interaction.customId !== 'string') return false;
  const cid = interaction.customId;
  const bizim =
    cid === CID.BILDIR ||
    cid === CID.IPTAL ||
    cid === CID.ID_YAZ ||
    cid === CID.SEBEP_YAZ ||
    cid === CID.TARIH_OZEL_YAZ ||
    cid.startsWith(CID.TARIH_SEC + ':') ||
    cid === CID.ID_MODAL ||
    cid === CID.SEBEP_MODAL ||
    cid === CID.TARIH_OZEL_MODAL;
  if (!bizim) return false;

  if (cid === CID.BILDIR) return handleBildirButton(interaction);
  if (cid === CID.ID_MODAL || cid === CID.SEBEP_MODAL || cid === CID.TARIH_OZEL_MODAL)
    return handleModalSubmit(interaction);
  return handleButon(interaction);
}

module.exports = {
  CID,
  ADIMLAR,
  TARIH_SECENEKLERI,
  BUTON_BEKLEME_MS,
  GONDERIM_YASAK_MS,
  banIdGecerliMi,
  sebepGecerliMi,
  tarihGecerliMi,
  bildirimKanaliniBul,
  handleEtkilesim,
  handleBildirButton,
  handleButon,
  handleModalSubmit,
  KANAL_HATASI,
  sonButon,
};