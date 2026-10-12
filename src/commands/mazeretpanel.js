/**
 * /mazeretpanel - Herkesin mazeret bildirebileceği paneli gönderir.
 *
 * Panel tek bir buton taşır: "Mazeret Bildir" -> modal (süre + sebep).
 * Bildirim yetkili kanalındaki (MAZERET_ADMIN_CHANNEL_ID) listeye düşer.
 *
 * Aynı kanalda zaten bir panel varsa YENİSİ GÖNDERİLMEZ, eskisi güncellenir
 * (herkes kullanabilsin diye spam koruması şart).
 */
const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildErrorEmbed, buildSuccessEmbed } = require('../utils/embeds');
const { buildMazeretPanelEmbed, buildMazeretOpenRow } = require('../utils/mazeretEmbeds');
const { getActiveMazerets, upsertMazeretActivePanel, getMazeretActivePanel } = require('../database/database');
const { refreshAdminPanel } = require('../handlers/mazeretHandler');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mazeretpanel')
    .setDescription('Mazeret bildirimi panelini bu kanala gönderir (herkes kullanabilir).'),
  openToEveryone: true,

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction
        .reply({ embeds: [buildErrorEmbed('Bu komut yalnızca sunucuda kullanılabilir.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    try {
      const guildId = interaction.guildId;
      const aktif = getActiveMazerets(guildId).length;

      // --- Aynı kanalda panel var mı? ---
      const kayit = getMazeretActivePanel(guildId, 'public');
      let mesaj = null;
      if (kayit && kayit.channel_id === interaction.channelId) {
        mesaj = await interaction.channel.messages.fetch(kayit.message_id).catch(() => null);
      }

      if (mesaj) {
        await mesaj.edit({ embeds: [buildMazeretPanelEmbed({ activeCount: aktif })], components: [buildMazeretOpenRow()] });
      } else {
        mesaj = await interaction.channel.send({
          embeds: [buildMazeretPanelEmbed({ activeCount: aktif })],
          components: [buildMazeretOpenRow()],
        });
        upsertMazeretActivePanel(guildId, 'public', interaction.channelId, mesaj.id);
      }

      // Yetkili listesi panelini de tazele (yoksa oluşturur).
      const adminOk = await refreshAdminPanel(interaction.client, guildId);

      logger.success(`Mazeret paneli gönderildi (#${interaction.channel?.name || interaction.channelId})`);
      return interaction
        .reply({
          embeds: [
            buildSuccessEmbed(
              'Mazeret paneli hazır.\n' +
                'Artık herkes bu butona basarak mazeret bildirebilir.\n' +
                (adminOk ? '' : '\n⚠️ Yetkili listesi paneli güncellenemedi (kanal ayarını kontrol et).'),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    } catch (err) {
      logger.error('Interaction failed: /mazeretpanel.', err);
      const payload = {
        embeds: [buildErrorEmbed('Panel gönderilirken bir hata oluştu.')],
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  },
};
