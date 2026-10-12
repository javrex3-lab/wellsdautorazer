/**
 * Mazeret embed tasarimlari.
 * - buildMazeretPanelEmbed()      : herkesin gordugu panel (butonlu)
 * - buildActiveMazeretEmbed()     : yetkili kanali - numarali liste (fotodaki duzen)
 * - buildMazeretFormEmbed()       : kullanicinin bildiriminin onayi (modal acildiktan sonra)
 */
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const { formatDuration, remainingLabel } = require('./mazeretDuration');

/** 1 -> 1️⃣, 2 -> 2️⃣ ... 10 -> 1️⃣0️⃣ (fotodaki gorsunum). */
const KEYCAP = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

function numberEmoji(n) {
  const s = String(n);
  if (s.length <= 2 && [...s].every((c) => c >= '0' && c <= '9')) {
    return [...s].map((c) => KEYCAP[Number(c)]).join('');
  }
  return `#${n}.`;
}

/**
 * Herkesin gordugu panel.
 * @param {number|null} activeCount su an mazeretli olan kisi sayisi
 */
function buildMazeretPanelEmbed({ activeCount = null } = {}) {
  const embed = new EmbedBuilder()
    .setColor(config.colors.mazeret)
    .setTitle('📋 Mazeret Bildirimi')
    .setDescription(
      'Gelemeyeceğiniz / aktif olamayacağınız zamanları buradan bildirin.\n\n' +
        'Aşağıdaki **Mazeret Bildir** butonuna basın, açılan formu doldurun.\n' +
        'Bildiriminiz yetkililerin paneline düşer ve süre dolduğunda otomatik listeden çıkar.',
    );

  if (Number.isInteger(activeCount) && activeCount > 0) {
    embed.addFields({
      name: '📊 Şu an mazeretli',
      value: `**${activeCount}** kişi aktif mazerette`,
      inline: true,
    });
  }

  embed.setFooter({ text: 'Formu doldurduktan sonra yetkililer onayını bekleyebilirsin.' });
  return embed;
}

/** Buton satiri: herkesin paneli. */
function buildMazeretOpenRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mazeret_open')
      .setLabel('Mazeret Bildir')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📝'),
  );
}

/**
 * YETKILI KANALI - aktif mazeretli listesi (fotodaki duzen).
 *
 * Ornek:
 *   1️⃣ @102- Lates Xee — 3 gün
 *      ↳ Sebep: hastaneye gidiyorum
 *      ↳ Onaylayan: @d27q
 *
 * @param {Array} rows getActiveMazerets() ciktisi
 */
function buildActiveMazeretEmbed(rows = [], { updatedUnix = null } = {}) {
  const embed = new EmbedBuilder()
    .setColor(config.colors.mazeret)
    .setTitle('🗂️ Aktif Mazeretli Memurlar')
    .setDescription(
      'Aşağıda departman bünyesinde anlık olarak mazereti (izinli) sayılan memurları görebilirsiniz.',
    );

  if (!rows.length) {
    embed.setDescription(
      'Aşağıda departman bünyesinde anlık olarak mazereti (izinli) sayılan memurları görebilirsiniz.\n\n' +
        '*Şu anda mazeretli memur bulunmuyor.*',
    );
  } else {
    // Discord aciklama limiti 4096. Basit satir tahminiyle kirp.
    const LIM = 4000;
    const out = [];
    let len = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const sure = formatDuration(r.duration_ms);
      const kalan = remainingLabel(r.expires_at);
      const sebep = String(r.reason || 'Belirtilmedi').replace(/\s+/g, ' ').slice(0, 200);
      const block =
        `${numberEmoji(i + 1)} <@${r.user_id}> — **Süre: ${sure}** · _${kalan}_\n` +
        `　↳ **Sebep:** ${sebep}\n` +
        `　↳ **Onaylayan:** <@${r.reported_by}>\n` +
        `　↳ **Bildirildi:** <t:${Math.floor(r.created_at / 1000)}:f>`;
      if (len + block.length > LIM) {
        out.push(`\n*+${rows.length - i} kişi daha listelenemedi*`);
        break;
      }
      out.push(block);
      len += block.length + 1;
    }
    embed.setDescription(
      'Aşağıda departman bünyesinde anlık olarak mazereti (izinli) sayılan memurları görebilirsiniz.\n\n' +
        out.join('\n'),
    );
  }

  embed.setFooter({
    text: `Toplam: ${rows.length} kişi · Panel otomatik güncellenir${
      updatedUnix ? ' · Son güncelleme: ' + new Date(updatedUnix).toLocaleString('tr-TR') : ''
    }`,
  });
  return embed;
}

/**
 * Kullanicinin butona basinca gonderdigi onay mesaji (kendi kanallarina dusmez,
 * modal submit'in ardindan gonderilir).
 */
function buildMazeretFormEmbed({ userId, durationText, reason, remaining = null, guessed = false }) {
  const embed = new EmbedBuilder()
    .setColor(config.colors.mazeret)
    .setTitle('📝 Mazeret Bildirimi')
    .addFields(
      { name: 'Bildiren:', value: `<@${userId}>`, inline: true },
      { name: 'Süre:', value: String(durationText || 'Belirtilmedi').slice(0, 100), inline: true },
    );

  if (remaining) embed.addFields({ name: 'Kalan:', value: remaining, inline: true });

  embed.addFields({ name: 'Sebep:', value: String(reason || 'Belirtilmedi').slice(0, 1024), inline: false });

  if (guessed) {
    embed.setFooter({
      text: 'Süre metni okunamadı için varsayılan 1 gün uygulandı — yetkili panelinden kontrol edebilirsin.',
    });
  }
  return embed;
}

/** Eski tekil bildirim embed'i (geriye uyumluluk + tek seferlik bildirimler icin). */
function buildMazeretReportEmbed({ userId, sure, text }) {
  return buildMazeretFormEmbed({ userId, durationText: sure, reason: text });
}

module.exports = {
  buildMazeretPanelEmbed,
  buildMazeretOpenRow,
  buildActiveMazeretEmbed,
  buildMazeretFormEmbed,
  buildMazeretReportEmbed,
  numberEmoji,
};
