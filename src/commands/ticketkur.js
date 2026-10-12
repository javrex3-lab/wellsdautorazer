/**
 * /ticketkur - YENİ ANA TICKET PANELİNİ gönderir.
 *
 * Panelin gönderilebildiği TEK yol budur. Bot açılışında, restart'ta,
 * redeploy'da veya herhangi bir event'te panel OTOMATİK gönderilmez.
 */
const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../config');
const { buildErrorEmbed, buildSuccessEmbed } = require('../utils/embeds');
const { canManageTickets } = require('../utils/permissions');
const { sendMainPanel, resolveTicketCategory } = require('../handlers/tickets');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticketkur')
    .setDescription('Ana ticket panelini gönderir (Başvuru / Şikayet / Diğer).')
    .addChannelOption((opt) =>
      opt
        .setName('kanal')
        .setDescription('Panelin gönderileceği kanal (boşsa ayarlı kanal veya bu kanal)')
        .addChannelTypes(ChannelType.GuildText),
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction
        .reply({ embeds: [buildErrorEmbed('Bu komut yalnızca sunucuda kullanılabilir.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
    if (!canManageTickets(interaction.member)) {
      return interaction
        .reply({ embeds: [buildErrorEmbed('Bu komutu yalnızca yetkililer kullanabilir.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    // Kategori doğrulanır — yanlış yere panel/ticket açılmasın.
    const cat = await resolveTicketCategory(interaction.guild);
    if (!cat.ok) {
      logger.error(`/ticketkur: kategori uygun değil (${cat.reason})`);
      return interaction
        .reply({
          embeds: [buildErrorEmbed('Ticket kategorisi doğrulanamadı. Yöneticinize bildirin.')],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }

    let target = interaction.options.getChannel('kanal') || null;
    if (!target && config.ticket.panelChannelId) {
      target = await interaction.guild.channels.fetch(config.ticket.panelChannelId).catch(() => null);
    }
    target = target || interaction.channel;
    if (!target?.isTextBased()) {
      return interaction
        .reply({ embeds: [buildErrorEmbed('Panel yalnızca metin kanalına gönderilebilir.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    const me = interaction.guild.members.me;
    if (me) {
      const p = target.permissionsFor(me);
      if (!p?.has(PermissionFlagsBits.SendMessages) || !p?.has(PermissionFlagsBits.EmbedLinks)) {
        return interaction
          .reply({
            embeds: [buildErrorEmbed('Bu kanala mesaj/embed gönderme iznim yok.')],
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      }
    }

    const r = await sendMainPanel(interaction.client, interaction.guild, target);
    if (!r.ok) {
      return interaction
        .reply({ embeds: [buildErrorEmbed('Panel gönderilemedi.')] , flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    const mesaj = r.action === 'guncellendi' ? 'Mevcut panel güncellendi.' : 'Panel gönderildi.';
    logger.success(`/ticketkur: ${mesaj} (${target.id}, mesaj ${r.messageId})`);
    return interaction
      .reply({
        embeds: [
          buildSuccessEmbed(
            `${mesaj}\n` +
              `Kanal: <#${target.id}>\n` +
              `Seçenekler: **📝 Başvuru** · **📢 Şikayet** · **📩 Diğer**\n` +
              `Ticket kategorisi: <#${config.ticket.categoryId}>`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  },
};
