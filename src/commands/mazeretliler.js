/**
 * /mazeretliler - Aktif mazeretli listesini ANINDA gösterir.
 *
 * Ne yapar:
 *   - Kalıcı depodan yalnızca bitişi gelmemiş kayıtları okur
 *   - Listeyi referans düzende (1) ⬇️ <@kullanıcı> / Süre / Sebep / Bitiş)
 *     ephemeral olarak sana gösterir — kanala mesaj yazmaz, spam yapmaz
 *   - Merkezi paneli (MAZERET_ADMIN_CHANNEL_ID) de tazeler ki orada da güncel kalsın
 *
 * NOT: Liste kişisel mazeret sebebi içerdiği için komut yetkililere açıktır.
 */
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buildErrorEmbed } = require('../utils/embeds');
const { buildMazeretliListesiEmbed } = require('../utils/mazeretViews');
const { getActiveMazerets, expireMazerets } = require('../database/database');
const { canManageTickets } = require('../utils/permissions');
const { refreshMerkeziPanel, merkeziKanalId } = require('../handlers/mazeret');
const logger = require('../utils/logger');

module.exports = {
  openToRoleManagers: true,
  data: new SlashCommandBuilder()
    .setName('mazeretliler')
    .setDescription('Aktif mazeretli memurların listesini gösterir (yalnızca yetkililer).'),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction
        .reply({
          embeds: [buildErrorEmbed('Bu komut yalnızca sunucuda kullanılabilir.')],
          flags: MessageFlags.Ephemeral,
        })
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

    try {
      // Süresi dolmuşları kapat + yalnızca HÂLÂ GEÇERLİ kayıtları oku.
      // expires_at kalıcı zaman damgasıdır (RAM timer'ı değil).
      expireMazerets(interaction.guildId);
      const rows = getActiveMazerets(interaction.guildId);

      const { embed } = buildMazeretliListesiEmbed(rows, { now: Date.now() });

      const merkezi = merkeziKanalId();
      const yanit = await interaction
        .reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
        .catch(() => null);

      if (!yanit) {
        await interaction.editReply({ embeds: [embed] }).catch(() => {});
      }

      // Merkezi paneli de tazele (oradaki tek mesaj güncellenir, yeni mesaj oluşmaz)
      let merkeziOk = null;
      try {
        merkeziOk = await refreshMerkeziPanel(interaction.client, interaction.guildId, 1);
      } catch (err) {
        logger.warn(`[mazeretliler] merkezi panel tazelenemedi: ${err.code || err.message}`);
      }
      if (merkeziOk && merkezi) {
        logger.info(
          `/mazeretliler: ${interaction.user.tag} listeyi görüntüledi (${rows.length} aktif) · merkezi panel tazelendi`,
        );
      } else {
        logger.info(`/mazeretliler: ${interaction.user.tag} listeyi görüntüledi (${rows.length} aktif)`);
      }
    } catch (err) {
      logger.error('Interaction failed: /mazeretliler.', err);
      const payload = {
        embeds: [buildErrorEmbed('Mazeret listesi alınamadı. Lütfen tekrar deneyin.')],
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  },
};