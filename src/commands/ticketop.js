/**
 * /ticketop - Ticket sahiplenme liderlik tablosu.
 *
 * En çok ticket sahiplenen ilk 10 yetkiliyi, gerçek DB verileriyle üretilen
 * profesyonel bir PNG görseli olarak gösterir.
 *
 * - Sıralama YALNIZCA komutun çalıştığı sunucunun verisini kullanır.
 * - Veri yoksa hata VERMEZ; profesyonel boş durum görseli gönderir.
 * - Görsel üretimi çökerse komut düşmez; kontrollü metin tabanlı yedege düşer.
 * - Avatarlar zaman aşımlıdır ve alınamazsa baş harf rozeti kullanılır.
 * - Diskte geçici dosya oluşturulmaz; PNG doğrudan Buffer olarak eklenir.
 */
const { SlashCommandBuilder, MessageFlags, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { buildErrorEmbed } = require('../utils/embeds');
const { canManageTickets } = require('../utils/permissions');
const { getTicketTop } = require('../database/database');
const { leaderboardCiz } = require('../utils/leaderboardImage');
const logger = require('../utils/logger');

/** Avatar isteklerinin toplam süre sınırı (botu bloklamaz). */
const AVATAR_TOPLAM_MS = 15_000;

/** Veri yokken gösterilen resmi mesaj metni (görsele de yazılır). */
const BOS_DURUM_METNI = 'Henüz kaydedilmiş ticket sahiplenme istatistiği bulunmuyor.';

/**
 * Avatar eşleştirmesi. Sunucudaki kullanıcı bilgisi alınamazsa satır YİNE DE
 * listede kalır (sıralama bozulmaz); yalnızca ad/avatar boş kalır.
 */
async function satirlariHazirla(kayitlar, guild) {
  return Promise.all(
    kayitlar.map(async (k) => {
      let ad = null;
      let adGorsel = null;
      let avatarUrl = null;
      try {
        const m = await guild.members.fetch(k.user_id).catch(() => null);
        if (m) {
          ad = m.user?.username || null;
          adGorsel = m.displayName || m.user?.globalName || m.user?.username || null;
          avatarUrl = m.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || null;
        }
      } catch {
        /* üye alınamadı — satır yine de gösterilir */
      }
      if (!ad) ad = 'Bilinmeyen Kullanıcı';
      if (!adGorsel) adGorsel = ad;
      return { user_id: k.user_id, ad, adGorsel, avatarUrl, claimed_count: k.claimed_count };
    }),
  );
}

/** Sıralamayı metin olarak biçimlendirir (görsel üretilemezse yedek). */
function metinYedegi(satirlar, guildName) {
  if (!satirlar.length) return BOS_DURUM_METNI;
  const madalya = ['🥇', '🥈', '🥉'];
  const govde = satirlar
    .map((s, i) => `${madalya[i] || `**${i + 1}.**`} <@${s.user_id}> — **${s.claimed_count}** ticket`)
    .join('\n');
  return `${guildName ? '**' + guildName + '**\n\n' : ''}🎫 **TICKET LEADERBOARD**\n${govde}`;
}

module.exports = {
  openToRoleManagers: true,
  data: new SlashCommandBuilder()
    .setName('ticketop')
    .setDescription('Ticket sahiplenme liderlik tablosu — ilk 10 yetkili.')
    .addBooleanOption((o) =>
      o.setName('gizli').setDescription('Sonucu yalnızca sana göster (varsayılan: herkese açık).'),
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction
        .reply({ embeds: [buildErrorEmbed('Bu komut yalnızca sunucuda kullanılabilir.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
    if (!canManageTickets(interaction.member)) {
      return interaction
        .reply({
          embeds: [buildErrorEmbed('Bu komutu yalnızca yetkililer kullanabilir.')],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }

    // Avatar eşleştirmesi komutu bloklamasın.
    const gizli = interaction.options?.getBoolean?.('gizli') === true;
    const zamanAsimi = new Promise((r) => setTimeout(() => r(null), AVATAR_TOPLAM_MS));
    const hazirlik = satirlariHazirla(
      getTicketTop(interaction.guildId, 10),
      interaction.guild,
    ).catch((err) => {
      logger.warn(`[ticketop] üye bilgisi alınamadı: ${err?.code || err?.message}`);
      return [];
    });

    try {
      const kayitlar = getTicketTop(interaction.guildId, 10);
      const satirlar = (await Promise.race([hazirlik, zamanAsimi])) || [];
      const toplam = satirlar.reduce((t, s) => t + s.claimed_count, 0);

      let png = null;
      try {
        png = await Promise.race([
          leaderboardCiz(satirlar, { guildName: interaction.guild.name, toplam }),
          new Promise((_, red) => setTimeout(() => red(new Error('görsel zaman aşımı')), 20_000)),
        ]);
      } catch (imgErr) {
        // Görsel üretimi BAŞARISIZ olursa komut düşmez.
        logger.error(`[ticketop] PNG üretilemedi, metin yedeğine düşülüyor: ${imgErr?.message || imgErr}`);
      }

      const bos = !kayitlar.length;

      if (!png) {
        return interaction
          .reply({
            content: metinYedegi(satirlar, interaction.guild.name),
            embeds: bos ? [buildErrorEmbed(BOS_DURUM_METNI)] : [],
            flags: gizli ? MessageFlags.Ephemeral : undefined,
          })
          .catch(() => {});
      }

      const dosya = new AttachmentBuilder(png, { name: 'ticketop.png' });
      const embed = new EmbedBuilder()
        .setColor(0x7c5cff)
        .setTitle('🎫 Ticket Leaderboard')
        .setDescription(
          bos
            ? BOS_DURUM_METNI
            : `En çok ticket sahiplenen ilk ${kayitlar.length} yetkili` +
              (kayitlar.length < 10 ? ` (toplam ${kayitlar.length} yetkili kayıtlı)` : '') +
              `.\n**Toplam sahiplenme:** ${toplam}`,
        )
        .setImage('attachment://ticketop.png')
        .setFooter({ text: `WellsdAutorazer • ${interaction.guild.name}` })
        .setTimestamp();

      return interaction
        .reply({ embeds: [embed], files: [dosya], flags: gizli ? MessageFlags.Ephemeral : undefined })
        .catch((err) => {
          logger.error(`[ticketop] yanıt gönderilemedi: ${err?.code || err?.message}`);
        });
    } catch (err) {
      logger.error('Interaction failed: /ticketop.', err);
      const payload = {
        embeds: [buildErrorEmbed('Liderlik tablosu oluşturulamadı. Lütfen tekrar deneyin.')],
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  },
};

module.exports.BOS_DURUM_METNI = BOS_DURUM_METNI;