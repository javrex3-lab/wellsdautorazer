/**
 * BANLILAR BİLDİRİM SİSTEMİ — görünümler (panel embed, buton, modal, bildirim embed).
 *
 * Mimari: src/utils/mazeretViews.js ile aynı deseni kullanır.
 * Kullanıcının girdiği metinler guvenliMetin() ile sanitize edilir —
 * böylece sebep alanından @everyone / rol / kullanıcı mention PING'i oluşmaz.
 */
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

/** customId'ler tek yerden. */
const CID = {
  BILDIR: 'bn_bildir',
  MODAL: 'bn_modal',
  ID: 'bn_id',
  SEBEP: 'bn_sebep',
  TARIH: 'bn_tarih',
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
      'Sunucudan yasaklandıysanız ban bilgilerinizi aşağıdaki buton üzerinden bildirebilirsiniz. ' +
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
/* 2) Modal                                                            */
/* ------------------------------------------------------------------ */

/** Modal başlığı: "Ban Bilgilerini Bildir" — üç zorunlu alan. */
function buildBildirModal() {
  return new ModalBuilder()
    .setCustomId(CID.MODAL)
    .setTitle('Ban Bilgilerini Bildir')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(CID.ID)
          .setLabel('Ban ID')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('örn: 123456789012345678')
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(64),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(CID.SEBEP)
          .setLabel('Ban Sebebi')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Hangi sebeple banlandığınızı yazınız.')
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(500),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(CID.TARIH)
          .setLabel('Ne Zaman Ban Yediniz?')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Örnek: 12.10.2026 18:30')
          .setRequired(true)
          .setMinLength(5)
          .setMaxLength(64),
      ),
    );
}

/* ------------------------------------------------------------------ */
/* 3) Bildirim embed'i (kanala gönderilen)                             */
/* ------------------------------------------------------------------ */

/**
 * Kanal mesajı — spec alan sırası birebir korunur.
 * @param {{userId:string, banId:string, reason:string, banDate:string, now:number}} p
 */
function buildBildirimEmbed(p) {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🔨 YENİ BAN BİLDİRİMİ')
    .addFields(
      { name: '👤 Bildirim Yapan', value: `<@${p.userId}>`, inline: false },
      { name: '🆔 Ban ID', value: guvenliMetin(p.banId, KISA_MAX), inline: false },
      { name: '📋 Ban Sebebi', value: guvenliMetin(p.reason, ALAN_MAX), inline: false },
      { name: '📅 Ban Tarihi', value: guvenliMetin(p.banDate, KISA_MAX), inline: false },
      { name: '🕒 Bildirim Zamanı', value: `${ts(p.now)} (${new Date(p.now).toLocaleString('tr-TR')})`, inline: false },
    )
    .setFooter({ text: 'WellsdAutorazer • Ban Bildirim Sistemi' })
    .setTimestamp(p.now);
}

/** Kullanıcıya dönen onay (ephemeral). */
function buildOnayEmbed({ userId }) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ Bildiriminiz alındı')
    .setDescription(
      `Ban bildiriminiz yetkililere iletildi.\n\nBildiren: <@${userId}>\n` +
        'Yanıt sürecinde bu konuşma üzerinden bilgilendirileceksiniz.',
    )
    .setFooter({ text: 'WellsdAutorazer • Ban Bildirim Sistemi' });
}

module.exports = {
  CID,
  ALAN_MAX,
  KISA_MAX,
  guvenliMetin,
  ts,
  buildPanelEmbed,
  buildBildirRow,
  buildBildirModal,
  buildBildirimEmbed,
  buildOnayEmbed,
};