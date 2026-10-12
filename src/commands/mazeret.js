/**
 * /mazeret - ESKİ komut. Artık herkesin kullanabileceği /mazeretpanel var.
 * Geriye uyumluluk için aynı işi yapar, kullanıcıyı yeni komuta yönlendirir.
 */
const { MessageFlags } = require('discord.js');
const { buildErrorEmbed } = require('../utils/embeds');
const logger = require('../utils/logger');

module.exports = {
  data: {
    name: 'mazeret',
    description: '[ESKİ] Mazeret paneli — artık /mazeretpanel kullanın.',
    options: [],
    toJSON() {
      return {
        name: this.name,
        description: this.description,
        options: this.options,
      };
    },
  },
  openToEveryone: true,
  deprecated: true,

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction
        .reply({ embeds: [buildErrorEmbed('Bu komut yalnızca sunucuda kullanılabilir.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
    try {
      const yeni = interaction.client.commands?.get('mazeretpanel');
      if (yeni) return await yeni.execute(interaction);
      return interaction
        .reply({
          content: 'Lütfen `/mazeretpanel` komutunu kullanın.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    } catch (err) {
      logger.error('Interaction failed: /mazeret.', err);
    }
  },
};
