/**
 * /mazeretpanel - Mazeret bildirim panelini gönderir (yalnızca yetkililer).
 *
 * Panelde TEK buton vardır: 🔔 Mazeret Bildir
 *   → süre select menüsü → sebep modalı → kayıt → merkezi aktif-liste paneli
 *
 * Kurallar:
 *  - Kayıtlı panel mesajı varsa DÜZENLENİR (duplicate oluşmaz)
 *  - Panel mesajı silinmişse yeni mesaj gönderilir ve kayıt güncellenir
 *  - Bot açılışında/redeploy'da otomatik panel GÖNDERİLMEZ
 */
const { SlashCommandBuilder, MessageFlags, ChannelType, PermissionFlagsBits } = require('discord.js');
const { buildErrorEmbed, buildSuccessEmbed } = require('../utils/embeds');
const { buildPanelEmbed, buildBildirRow } = require('../utils/mazeretViews');
const { panelGorseli, panelDosyalari } = require('../utils/panelImage');
const {
  getActiveMazerets,
  upsertMazeretActivePanel,
  getMazeretActivePanel,
} = require('../database/database');
const { canManageTickets } = require('../utils/permissions');
const { refreshMerkeziPanel } = require('../handlers/mazeret');
const logger = require('../utils/logger');

module.exports = {
  // Yetki kontrolü komutun kendi içinde (canManageTickets) + global kapıdan muaf.
  openToRoleManagers: true,
  data: new SlashCommandBuilder()
    .setName('mazeretpanel')
    .setDescription('Mazeret bildirim panelini gönderir (yalnızca yetkililer).')
    .addChannelOption((opt) =>
      opt
        .setName('kanal')
        .setDescription('Panelin gönderileceği kanal (boşsa bu kanal)')
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

    const guildId = interaction.guildId;
    let hedef;
    try {
      hedef = interaction.options.getChannel('kanal') || null;
    } catch {
      hedef = null;
    }
    hedef = hedef || interaction.channel;
    if (!hedef?.isTextBased?.() || hedef.isDMBased?.()) {
      return interaction
        .reply({ embeds: [buildErrorEmbed('Panel yalnızca metin kanalına gönderilebilir.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    try {
      const me = interaction.guild.members?.me;
      if (me) {
        const p = hedef.permissionsFor(me);
        if (!p?.has(PermissionFlagsBits.SendMessages) || !p?.has(PermissionFlagsBits.EmbedLinks)) {
          return interaction
            .reply({
              embeds: [buildErrorEmbed('Bu kanala mesaj/embed gönderme iznim yok.')],
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
        }
      }

      const aktif = getActiveMazerets(guildId).length;
    // Panel görseli: repo içindeki dosya mesaja eklenir (attachment://).
    const gorsel = panelGorseli();
    const embed = buildPanelEmbed({
      guildName: interaction.guild.name,
      activeCount: aktif,
      imageUrl: gorsel.imageUrl || null,
    });
      const row = buildBildirRow();

      // Duplicate engeli: aynı kanalda kayıtlı panel varsa DÜZENLE
      const kayit = getMazeretActivePanel(guildId, 'public');
      let mesaj = null;
      let eylem = 'gonderildi';
      if (kayit && kayit.channel_id === hedef.id) {
        mesaj = await hedef.messages.fetch(kayit.message_id).catch(() => null);
        if (mesaj) {
          await mesaj.edit({ embeds: [embed], components: [row] });
          eylem = 'guncellendi';
        }
      }
      if (!mesaj) {
      const files = panelDosyalari(gorsel, true);
      mesaj = await hedef.send({
        embeds: [embed],
        components: [row],
        ...(files.length ? { files } : {}),
      });
        upsertMazeretActivePanel(guildId, 'public', hedef.id, mesaj.id);
      }

      // Merkezi aktif-liste panelini de tazele (yoksa oluşturur)
      const merkeziOk = await refreshMerkeziPanel(interaction.client, guildId, 1);

      logger.success(`/mazeretpanel: ${eylem} (kanal ${hedef.id}, mesaj ${mesaj.id}) — ${aktif} aktif kayıt`);

      return interaction
        .reply({
          embeds: [
            buildSuccessEmbed(
              `Mazeret paneli hazır (${eylem === 'guncellendi' ? 'mevcut panel güncellendi' : 'yeni mesaj gönderildi'}).\n` +
                `**Kanal:** <#${hedef.id}>\n` +
                `**Aktif mazeretli:** ${aktif} kişi` +
                (merkeziOk ? '' : '\n⚠️ Merkezi liste paneli güncellenemedi (kanal ayarını kontrol et).'),
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