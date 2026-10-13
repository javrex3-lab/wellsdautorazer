/**
 * BANLILAR BİLDİRİM SİSTEMİ — görünümler (panel embed, buton, soru mesajları, bildirim).
 *
 * Akış:  /banlılarpanel → 🔨 Banlıyım → bot soruları SIRA SORAR
 *          1) Ban ID      2) Ban Sebebi      3) Ban Tarihi
 *        → bildirim 1559535039614689362 kanalına gider.
 *
 * Bu bir OYUN (FiveM) banı bildirimi — Discord banı değil.
 * Ban ID'nin platformu/formatı bize BİLİNMEZ; kullanıcı ne yazarsa
 * "kullanıcı bildirimi" olarak saklanır, doğrulanmış gibi sunulmaz.
 *
 * Kullanıcının girdiği metinler guvenliMetin() ile sanitize edilir —
 * böylece sebep alanından @everyone / rol / kullanıcı mention PING'i oluşmaz.
 */
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

/** customId'ler tek yerden. */
const CID = {
  BILDIR: 'bn_bildir',
};

/** Discord embed alan sınırları. */
const ALAN_MAX = 1024;
const KISA_MAX = 256;

/* ------------------------------------------------------------------ */
/* Güvenli metin                                                       */
/* ------------------------------------------------------------------ */

/**
 * Kullanıcı metnini güvenli hale getirir — PING üretilmesini engeller.
 * @everyone/@here yok edilir, mention kodları düz metne çevrilir.
 */
function guvenliMetin(text, max = 200) {
  let s = String(text ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/@everyone/gi, '[everyone]')
    .replace(/@here/gi, '[here]')
    .replace(/<@!?(\d+)>/g, '@kullanıcı')
    .replace(/<@&(\d+)>/g, '@rol')
    .replace(/<#(\d+)>/g, '#kanal')
    .replace(/<t:(-?\d+)(:[a-zA-Z])?>/g, 'zaman')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.slice(0, max);
  return s || 'Belirtilmedi';
}

/** Discord zaman damgası. */
function ts(ms, style = 'f') {
  return `<t:${Math.floor(Number(ms) / 1000)}:${style}>`;
}

/* ------------------------------------------------------------------ */
/* 1) Panel                                                            */
/* ------------------------------------------------------------------ */

/** Başlık: BANLILAR BİLDİRİM SİSTEMİ — sade tasarım, tek buton. */
function buildPanelEmbed({ guildName = null } = {}) {
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c) // kırmızı — ban teması
    .setTitle('BANLILAR BİLDİRİM SİSTEMİ')
    .setDescription(
      'Oyun sunucusundan yasaklandıysanız ban bilgilerinizi aşağıdaki buton üzerinden bildirebilirsiniz. ' +
        'Girdiğiniz bilgileri eksiksiz ve doğru şekilde doldurunuz.',
    );

  if (guildName) embed.setFooter({ text: guildName });
  return embed;
}

/** Panel butonu: YALNIZCA "Banlıyım" */
function buildBildirRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CID.BILDIR)
      .setLabel('Banlıyım')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔨'),
  );
}

/* ------------------------------------------------------------------ */
/* 2) Soru mesajları (bot sırayla sorar)                              */
/* ------------------------------------------------------------------ */

/** Soru başlıkları — akış sırası bu diziye göre ilerler. */
const SORULAR = [
  {
    adim: 'id',
    sira: '1/3',
    baslik: '🆔 BAN ID',
    aciklama: 'Ban ID’nizi yazın.',
    ipucu: 'Sunucunun size verdiği ban kimliğini yazabilirsiniz.',
  },
  {
    adim: 'sebep',
    sira: '2/3',
    baslik: '📋 BAN SEBEBİ',
    aciklama: 'Hangi sebeple banlandığınızı yazınız.',
    ipucu: null,
  },
  {
    adim: 'tarih',
    sira: '3/3',
    baslik: '📅 BAN TARİHİ',
    aciklama: 'Ban yediğiniz tarih ve saati yazınız.',
    ipucu: 'Örnek: `12.10.2026 18:30`',
  },
];

/**
 * Botun sorduğu tek soru mesajı.
 * @param {{adim:string}} p SORULAR içinden bir kayıt
 * @param {string} kullaniciId yanıtlanacak kullanıcı
 */
function buildSoruMesaji(adim, kullaniciId) {
  const s = SORULAR.find((x) => x.adim === adim);
  if (!s) return null;
  return (
    `${kullaniciId ? `<@${kullaniciId}> ` : ''}**${s.sira} — ${s.baslik}**\n` +
    `${s.aciklama}` +
    (s.ipucu ? `\n${s.ipucu}` : '') +
    `\n\n*Yanıtınızı bu kanala yazın. Vazgeçerseniz "**iptal**" yazın.*`
  );
}

/** Geçersiz yanıt sonrası tekrar sorulur. */
function buildTekrarMesaji(adim, kullaniciId, hata) {
  const s = SORULAR.find((x) => x.adim === adim);
  if (!s) return `${kullaniciId ? `<@${kullaniciId}> ` : ''}⚠️ ${hata}`;
  return (
    `${kullaniciId ? `<@${kullaniciId}> ` : ''}**⚠️ ${s.sira} — ${s.baslik}**\n` +
    `${hata}\n\n\`${s.aciklama}\``
  );
}

/** Oturum başlatıldı — yönlendirme mesajı. */
function buildBaslangicMesaji(kullaniciId) {
  return (
    `<@${kullaniciId}> ban bildirim formunu başlattınız. ` +
    `Soru soracağım, **yanıtlarınızı bu kanala yazın**. ` +
    `Vazgeçerseniz **iptal** yazın.`
  );
}

/* ------------------------------------------------------------------ */
/* 3) Bildirim embed'i (kanala gönderilen)                             */
/* ------------------------------------------------------------------ */

/**
 * @param {{userId:string, banId:string, sebep:string, tarih:string, now:number}} p
 */
function buildBildirimEmbed(p) {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🔨 YENİ BAN BİLDİRİMİ')
    .addFields(
      { name: '👤 Kullanıcı', value: `<@${p.userId}>`, inline: false },
      { name: '🆔 Ban ID', value: guvenliMetin(p.banId, KISA_MAX), inline: false },
      { name: '📋 Ban Sebebi', value: guvenliMetin(p.sebep, ALAN_MAX), inline: false },
      { name: '📅 Ban Tarihi', value: guvenliMetin(p.tarih, KISA_MAX), inline: false },
      { name: '🕒 Bildirim Zamanı', value: `${ts(p.now)} (${new Date(p.now).toLocaleString('tr-TR')})`, inline: false },
    )
    .setFooter({ text: 'WellsdAutorazer • Ban Bildirim Sistemi' })
    .setTimestamp(p.now);
}

/** Başarılı — kullanıcıya (kanalda, herkese açık). */
function buildOnayMesaji({ userId, kanalId }) {
  return (
    `<@${userId}> ✅ **Ban bildiriminiz alındı ve yetkililere iletildi.**\n` +
    `Bilgileriniz${kanalId ? ` <#${kanalId}> kanalına` : ' yetkililere'} gönderildi. ` +
    `Daha fazla bildirim yapmak için yeni bir "Banlıyım" butonuna basabilirsiniz.`
  );
}

/** Gönderilemedi — kullanıcıya net bilgi. */
function buildHataMesaji(mesaj) {
  return `<@${mesaj.userId}> ❌ **${mesaj.metin}**`;
}

/** İptal edildi. */
function buildIptalMesaji(kullaniciId) {
  return `<@${kullaniciId}> Ban bildirim formu iptal edildi.`;
}

module.exports = {
  CID,
  ALAN_MAX,
  KISA_MAX,
  SORULAR,
  guvenliMetin,
  ts,
  buildPanelEmbed,
  buildBildirRow,
  buildSoruMesaji,
  buildTekrarMesaji,
  buildBaslangicMesaji,
  buildBildirimEmbed,
  buildOnayMesaji,
  buildHataMesaji,
  buildIptalMesaji,
};