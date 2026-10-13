/**
 * /mazeretliler - Aktif mazeretli listesini gösterir.
 *
 * Ne yapar:
 *   - Kalıcı depodan yalnızca bitişi gelmemiş kayıtları okur
 *   - Listeyi referans düzende (1) ⬇️ <@kullanıcı> / Süre / Sebep / Bitiş)
 *     HERKESİN GÖREBİLECEĞİ bir mesaj olarak gönderir
 *   - Merkezi paneli (MAZERET_ADMIN_CHANNEL_ID) de tazeler ki orada da güncel kalsın
 *
 * NOT: Liste herkese açıktır — komut ve yanıt ephemeral DEĞİLDİR.
 */
const { SlashCommandBuilder } = require('discord.js');
const { buildErrorEmbed } = require('../utils/embeds');
const { buildMazeretliListesiEmbed } = require('../utils/mazeretViews');
const { getActiveMazerets, expireMazerets } = require('../database/database');
const { refreshMerkeziPanel } = require('../handlers/mazeret');
const logger = require('../utils/logger');

module.exports = {
  // HERKES kullanabilir (global komut kapısı bu bayrla atlanır).
  openToEveryone: true,
  data: new SlashCommandBuilder()
    .setName('mazeretliler')
    .setDescription('Aktif mazeretli memurların listesini gösterir.'),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction
        .reply({ embeds: [buildErrorEmbed('Bu komut yalnızca sunucuda kullanılabilir.')] })
        .catch(() => {});
    }

    try {
      // Süresi dolmuşları kapat + yalnızca HÂLÂ GEÇERLİ kayıtları oku.
      // expires_at kalıcı zaman damgasıdır (RAM timer'ı değil).
      expireMazerets(interaction.guildId);
      const rows = getActiveMazerets(interaction.guildId);

      const { embed } = buildMazeretliListesiEmbed(rows, { now: Date.now() });

      // HERKES görsün diye ephemeral DEĞİL — normal mesaj.
      await interaction.reply({ embeds: [embed] }).catch(() => {});

      // Merkezi paneli de tazele (oradaki tek mesaj güncellenir, yeni mesaj oluşmaz)
      let merkeziOk = null;
      try {
        merkeziOk = await refreshMerkeziPanel(interaction.client, interaction.guildId, 1);
      } catch (err) {
        logger.warn(`[mazeretliler] merkezi panel tazelenemedi: ${err.code || err.message}`);
      }

      logger.info(
        `/mazeretliler: ${interaction.user.tag} listesi gösterildi (${rows.length} aktif) · merkezi panel=${merkeziOk ? 'tazelendi' : 'güncellenemedi'}`,
      );
    } catch (err) {
      logger.error('Interaction failed: /mazeretliler.', err);
      const payload = { embeds: [buildErrorEmbed('Mazeret listesi alınamadı. Lütfen tekrar deneyin.')] };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  },
};