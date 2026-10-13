/**
 * BANLILAR BİLDİRİM SİSTEMİ — akış yöneticisi.
 *
 * Akış:  /banlılar paneli → 🔨 Banlıyım butonu → Modal (Ban ID / Ban Sebebi / Ban Tarihi)
 *        → doğrulama → bildirim kanalına embed gönderimi → kalıcı DB kaydı
 *
 * TASARIM İLKELERİ
 *  - Bildirim, kullanıcının KENDİ bildirdiği bilgidir. Harici bir ban sorgu
 *    kaynağı (Discord/FiveM ban API'si) YOKTUR. Sistem hiçbir yerde banın
 *    gerçekleştiğini "doğrulanmış" gibi sunmaz.
 *  - Mesaj GÖNDERİLMEDEN önce DB'ye kayıt açılır (durum='gonderiliyor').
 *    Gönderim başarısız olursa kayıt 'hata' olarak kapanır → kullanıcıya
 *    yalan söylenmez, ama kalıcı iz kaybolmaz.
 *  - allowedMentions: { parse: [] } + yalnızca bildiren kullanıcı. Sebep
 *    metninden hiçbir şekilde rol/kullanıcı/ everyone PING'i oluşamaz.
 *  - Aynı interaction iki kez işlenmez; aynı kullanıcı+ban-id ikinci kez
 *    kısa sürede gönderim yapamaz (cooldown + DB sayacı).
 */
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const {
  CID,
  buildBildirModal,
  buildBildirimEmbed,
  buildOnayEmbed,
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
/** Aynı kullanıcı + aynı Ban ID için tekrar gönderim yasağı (ms). */
const GONDERIM_YASAK_MS = 20_000;
/** İşlenmiş interaction id'leri — çift işlem (40060) koruması. */
const ISLENMIS_TUT = 10 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Bellek içi korumalar (RAM)                                          */
/* ------------------------------------------------------------------ */

const butonSon = new Map();
const gonderimKilit = new Map();
const islenmis = new Map();

/** Süresi dolmuş kayıtları temizler — map'ler süresiz büyümez. */
function _temizle() {
  const sinir = Date.now() - Math.max(ISLENMIS_TUT, GONDERIM_YASAK_MS);
  for (const [k, v] of islenmis) if (v < sinir) islenmis.delete(k);
  for (const [k, v] of gonderimKilit) if (v < Date.now() - GONDERIM_YASAK_MS) gonderimKilit.delete(k);
  for (const [k, v] of butonSon) if (v < Date.now() - 600_000) butonSon.delete(k);
}

/* ------------------------------------------------------------------ */
/* Doğrulama                                                           */
/* ------------------------------------------------------------------ */

/**
 * Ban ID biçim kontrolü.
 * Projede "ban ID" kavramı Discord snowflake'idır (/unban `\d{17,20}` çıkarır)
 * ama kullanıcı farklı bir platformdan da bildirebilir; bu yüzden kabul
 * edilen karakterler geniş tutulur. Doğruluk İDDİA EDİLMEZ.
 */
const ID_DESEN = /^[A-Za-z0-9._:-]{3,64}$/;

function banIdGecerliMi(deger) {
  const s = String(deger ?? '').trim();
  if (!s) return { ok: false, sebep: 'ban_id_bos', mesaj: 'Ban ID alanı boş bırakılamaz.' };
  if (s.length < 3)
    return { ok: false, sebep: 'ban_id_kisa', mesaj: 'Ban ID en az 3 karakter olmalıdır.' };
  if (s.length > 64)
    return { ok: false, sebep: 'ban_id_uzun', mesaj: 'Ban ID en fazla 64 karakter olabilir.' };
  if (!ID_DESEN.test(s))
    return {
      ok: false,
      sebep: 'ban_id_gecersiz',
      mesaj: 'Ban ID yalnızca rakam, harf ve `. _ : -` karakterlerinden oluşmalıdır.',
    };
  return { ok: true, deger: s, snowflake: /^\d{17,20}$/.test(s) };
}

/** Tarih kabul biçimi: `Gün.Ay.Yıl Saat:dakika` (ayrılıcı: . / -) */
const TARIH_DESEN = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})(?:[\sT]+(\d{1,2})[:.](\d{2}))?$/;

function tarihGecerliMi(deger) {
  const s = String(deger ?? '').trim();
  if (!s) return { ok: false, sebep: 'tarih_bos', mesaj: 'Ban tarihi alanı boş bırakılamaz.' };
  if (s.length > 64)
    return { ok: false, sebep: 'tarih_uzun', mesaj: 'Ban tarihi en fazla 64 karakter olabilir.' };

  const m = TARIH_DESEN.exec(s);
  if (!m)
    return {
      ok: false,
      sebep: 'tarih_bicim',
      mesaj:
        'Tarih bu biçimde olmalıdır: `Gün.Ay.Yıl Saat:dakika`\n' +
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

  // Gerçekten var olan bir tarih mi? (31.02 gibi sahte tarihleri eler)
  const d = new Date(Date.UTC(yil, ay - 1, gun));
  if (d.getUTCFullYear() !== yil || d.getUTCMonth() !== ay - 1 || d.getUTCDate() !== gun)
    return { ok: false, sebep: 'tarih_gecersiz', mesaj: 'Bu tarih gerçek değil. Lütfen doğru tarihi giriniz.' };

  return { ok: true, deger: s };
}

/**
 * Form doğrulaması — üç alan da zorunludur.
 * Kullanıcının metni DEĞİŞTİRİLMEZ, yalnızca baştaki/sondaki boşluklar temizlenir.
 * @returns {{ok:true, banId:string, sebep:string, tarih:string, hatalar:[]}|{ok:false, mesaj:string, sebep:string}}
 */
function formDogrula({ banId, sebep, tarih } = {}) {
  const hatalar = [];

  const id = banIdGecerliMi(banId);
  if (!id.ok) hatalar.push(id);

  const sb = String(sebep ?? '').trim();
  if (!sb) hatalar.push({ sebep: 'sebep_bos', mesaj: 'Ban sebebi alanı boş bırakılamaz.' });
  else if (sb.length > 500)
    hatalar.push({ sebep: 'sebep_uzun', mesaj: 'Ban sebebi en fazla 500 karakter olabilir.' });
  else if (sb.length < 3)
    hatalar.push({ sebep: 'sebep_kisa', mesaj: 'Ban sebebi en az 3 karakter olmalıdır.' });

  const tr = tarihGecerliMi(tarih);
  if (!tr.ok) hatalar.push(tr);

  if (hatalar.length) {
    return {
      ok: false,
      sebep: hatalar[0].sebep,
      mesaj: hatalar.length === 1 ? hatalar[0].mesaj : 'Formda eksik/hatalı alanlar var:\n• ' + hatalar.map((x) => x.mesaj.split('\n')[0]).join('\n• '),
    };
  }

  return { ok: true, banId: id.deger, sebep: sb, tarih: tr.deger, hatalar: [] };
}

/* ------------------------------------------------------------------ */
/* Bildirim kanalı çözümleme + doğrulama                                */
/* ------------------------------------------------------------------ */

const KANAL_HATASI = {
  kanal_yapilandirilmamis: 'Bildirim kanalı yapılandırılmamış. Lütfen yetkiliye bildirin.',
  kanal_bulunamadi: 'Bildirim kanalı bulunamadı. Bilgileriniz kaydedildi ama iletilemedi.',
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
/* 1) Buton → Modal                                                    */
/* ------------------------------------------------------------------ */

/** 🔨 "Banlıyım" butonu: modalı açar (3sn ACK penceresi içinde). */
async function handleBildirButton(interaction) {
  try {
    if (!interaction.guildId) {
      await interaction
        .reply({ embeds: [buildErrorEmbed('Bu panel yalnızca sunucuda kullanılabilir.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return true;
    }

    const uid = interaction.user.id;
    const simdi = Date.now();
    _temizle();
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

    // showModal() Discord'un modal açma ACK'idir — 3sn içinde çağrılmalı.
    await interaction.showModal(buildBildirModal());
    return true;
  } catch (err) {
    logger.error(`[ban] modal açılamadı (buton) id=${interaction.id}`, err);
    try {
      const payload = {
        embeds: [buildErrorEmbed('Ban bildirim formu açılamadı. Lütfen tekrar deneyin.')],
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    } catch {
      /* interaction süresi dolmuş olabilir — sessiz geçilir ama ASIL hata yukarıda loglandı */
    }
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* 2) Modal gönderimi → doğrulama → bildirim                            */
/* ------------------------------------------------------------------ */

async function handleBildirSubmit(interaction) {
  const iid = String(interaction.id);

  // --- Aynı interaction iki kez işlenmesin (Discord 40060 koruması) ---
  _temizle();
  if (islenmis.has(iid)) {
    logger.warn(`[ban] aynı modal submit iki kez geldi, ikincisi yoksayıldı: ${iid}`);
    return;
  }
  islenmis.set(iid, Date.now());

  try {
    if (!interaction.guildId) {
      await interaction
        .reply({ embeds: [buildErrorEmbed('Bu form yalnızca sunucuda kullanılabilir.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }

    // --- Alanları oku ---
    let banId = '';
    let sebep = '';
    let tarih = '';
    try {
      banId = interaction.fields.getTextInputValue(CID.ID);
      sebep = interaction.fields.getTextInputValue(CID.SEBEP);
      tarih = interaction.fields.getTextInputValue(CID.TARIH);
    } catch (err) {
      logger.error(`[ban] modal alanları okunamadı id=${iid}`, err);
      await interaction
        .reply({ embeds: [buildErrorEmbed('Form okunamadı. Lütfen tekrar dene.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }

    // --- Doğrulama (kullanıcı metni değiştirilmez) ---
    const d = formDogrula({ banId, sebep, tarih });
    if (!d.ok) {
      logger.info(`[ban] geçersiz form (${interaction.user.id}): ${d.sebep}`);
      await interaction
        .reply({ embeds: [buildErrorEmbed(d.mesaj)], flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }

    const guildId = String(interaction.guildId);
    const uid = String(interaction.user.id);
    const anahtar = `${guildId}:${uid}:${d.banId}`;

    // --- Aynı kullanıcı + aynı Ban ID: kısa sürede ikinci gönderim yok ---
    if (gonderimKilit.has(anahtar)) {
      await interaction
        .reply({
          embeds: [buildErrorEmbed('Bu bildirim şu anda gönderiliyor. Lütfen biraz bekleyin.')],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }
    if (db.countRecentBanBildirimi(guildId, uid, d.banId, GONDERIM_YASAK_MS) > 0) {
      await interaction
        .reply({
          embeds: [
            buildErrorEmbed(
              `Aynı Ban ID ile kısa süre önce bildirim gönderdiniz. ` +
                `${Math.round(GONDERIM_YASAK_MS / 1000)} saniye sonra tekrar deneyebilirsiniz.`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    gonderimKilit.set(anahtar, Date.now());

    // --- 3sn ACK penceresi: yavaş işler için önce defer ---
    let deferOldu = false;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      deferOldu = true;
    } catch (err) {
      // 10062 Unknown Interaction: Discord 3sn içinde ACK alamadık.
      logger.warn(`[ban] defer başarısız id=${iid}: ${err?.code || err?.message}`);
      gonderimKilit.delete(anahtar);
      return;
    }
    const bitir = async (mesaj, hataMi = false) => {
      const payload = { embeds: [hataMi ? buildErrorEmbed(mesaj) : mesaj], flags: MessageFlags.Ephemeral };
      await interaction.editReply(payload).catch((e) => logger.warn(`[ban] editReply: ${e?.code || e?.message}`));
    };

    // --- Kanal kontrolü ---
    const k = await bildirimKanaliniBul(interaction.client, guildId);
    if (!k.ok) {
      logger.error(`[ban] bildirim kanalı kullanılamaz (${k.sebep}${k.detay ? ' / ' + k.detay : ''})`);
      gonderimKilit.delete(anahtar);
      await bitir(KANAL_HATASI[k.sebep] || 'Bildirim gönderilemedi.', true);
      return;
    }

    // --- DB kaydı ÖNCE (mesaj gönderilmeden) ---
    const simdi = Date.now();
    const kayit = db.createBanBildirimi({
      guildId,
      userId: uid,
      banId: d.banId,
      sebep: d.sebep,
      banTarih: d.tarih,
      kanalId: k.kanal.id,
      now: simdi,
    });
    if (!kayit.ok) {
      gonderimKilit.delete(anahtar);
      await bitir('Bildirim kaydedilemedi, bu yüzden gönderilmedi. Lütfen tekrar deneyin.', true);
      return;
    }

    // --- Bildirimi gönder ---
    let mesaj = null;
    let hata = null;
    try {
      mesaj = await k.kanal.send({
        embeds: [
          buildBildirimEmbed({
            userId: uid,
            banId: d.banId,
            reason: d.sebep,
            banDate: d.tarih,
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
      gonderimKilit.delete(anahtar);
      await bitir(
        'Bildiriminiz kanala iletilemedi. Hata kayıt altına alındı, lütfen biraz sonra tekrar deneyin.',
        true,
      );
      return;
    }

    // --- Gönderildi: kaydı tamamla ---
    const u = db.completeBanBildirimi(kayit.id, { mesajId: mesaj.id, durum: 'gonderildi' });
    gonderimKilit.delete(anahtar);

    logger.success(
      `/banlılar bildirimi gönderildi: ${uid} → kanal ${k.kanal.id}, mesaj ${mesaj.id} (kayıt #${kayit.id})`,
    );

    if (!u.ok) {
      // Mesaj GİDERİLDİ ama kayıt tamamlanamadı — bunu gizlemiyoruz.
      logger.error(`[ban] kayıt #${kayit.id} tamamlanamadı (mesaj gönderildi: ${mesaj.id})`);
      await bitir('Bildiriminiz kanala iletildi ancak kaydı tamamlanamadı. Yetkiliye bildirin.', true);
      return;
    }

    if (deferOldu) await bitir(buildOnayEmbed({ userId: uid }));
  } catch (err) {
    logger.error(`[ban] modal submit hatası id=${iid}`, err);
    try {
      const payload = {
        embeds: [buildErrorEmbed('Bildirim işlenirken bir hata oluştu. Lütfen tekrar deneyin.')],
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else if (interaction.isRepliable?.()) await interaction.reply(payload).catch(() => {});
    } catch {
      /* interaction süresi dolmuş olabilir — ASIL hata yukarıda loglandı */
    }
  }
}

module.exports = {
  CID,
  BUTON_BEKLEME_MS,
  GONDERIM_YASAK_MS,
  banIdGecerliMi,
  tarihGecerliMi,
  formDogrula,
  bildirimKanaliniBul,
  handleBildirButton,
  handleBildirSubmit,
  KANAL_HATASI,
  _temizle,
};