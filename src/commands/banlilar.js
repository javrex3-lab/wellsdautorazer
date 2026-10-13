/**
 * /banlılarpanel - Banlılar bildirim panelini gönderir (yalnızca yetkililer).
 *
 * Panelde TEK buton vardır: 🔨 Banlıyım
 *   → Modal (Ban ID / Ban Sebebi / Ban Tarihi) → doğrulama
 *   → bildirim kanalına profesyonel embed → kalıcı DB kaydı
 *
 * Kurallar:
 *  - Kayıtlı panel mesajı varsa DÜZENLENİR (duplicate oluşmaz)
 *  - Panel mesajı silinmişse yeni mesaj gönderilir ve kayıt güncellenir
 *  - Bot açılışında / redeploy'da otomatik panel GÖNDERİLMEZ
 *  - Kurulum yetkililere açıktır; panelden bildirim yapan KULLANICI olabilir
 */
const { SlashCommandBuilder, MessageFlags, ChannelType, PermissionFlagsBits } = require('discord.js');
const { buildErrorEmbed, buildSuccessEmbed } = require('../utils/embeds');
const { buildPanelEmbed, buildBildirRow } = require('../utils/banViews');
const { panelGorseli, panelDosyalari } = require('../utils/panelImage');
const { getBanPanel, upsertBanPanel, getBanBildirimleri } = require('../database/database');
const { canManageTickets } = require('../utils/permissions');
const config = require('../config');
const logger = require('../utils/logger');

module.exports = {
  // Yetki kontrolü komutun kendi içinde (canManageTickets) + global kapıdan muaf.
  openToRoleManagers: true,
  data: new SlashCommandBuilder()
    .setName('banlılarpanel')
    .setDescription('Banlılar bildirim panelini gönderir (yalnızca yetkililer).')
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
        .reply({
          embeds: [buildErrorEmbed('Bu komutu yalnızca yetkililer kullanabilir.')],
          flags: MessageFlags.Ephemeral,
        })
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

    // Panel görseli: repo içindeki dosya mesaja eklenir (attachment://).
    const gorsel = panelGorseli();
    const embed = buildPanelEmbed({ guildName: interaction.guild.name, imageUrl: gorsel.imageUrl || null });
      const row = buildBildirRow();

      // Duplicate engeli: kayıtlı panel varsa DÜZENLE, yeni mesaj gönderme.
      const kayit = getBanPanel(guildId);
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
        upsertBanPanel(guildId, hedef.id, mesaj.id);
      }

      // Bildirim kanalı hazır mı? (panel çalışır ama bildirim gidemezse kullanıcı uyarılır)
      let kanalUyarisi = '';
      const bildirimKanali = config.banlilarChannelId;
      if (!bildirimKanali) {
        kanalUyarisi = '\n⚠️ Bildirim kanalı yapılandırılmamış — bildirimler gönderilemeyecek.';
      } else {
        const bk = await interaction.client.channels.fetch(bildirimKanali).catch(() => null);
        if (!bk || !bk.isTextBased?.()) {
          kanalUyarisi = `\n⚠️ Bildirim kanalı (<#${bildirimKanali}>) bulunamadı veya metin kanalı değil.`;
        }
      }

      const toplam = getBanBildirimleri(guildId, 1).length;
      logger.success(`/banlılarpanel: panel ${eylem} (kanal ${hedef.id}, mesaj ${mesaj.id})`);

      return interaction
        .reply({
          embeds: [
            buildSuccessEmbed(
              `Banlılar bildirim paneli hazır (${eylem === 'guncellendi' ? 'mevcut panel güncellendi' : 'yeni mesaj gönderildi'}).\n` +
                `**Panel kanalı:** <#${hedef.id}>\n` +
                `**Bildirim kanalı:** ${bildirimKanali ? `<#${bildirimKanali}>` : 'yapılandırılmamış'}\n` +
                `**Kayıtlı bildirim:** ${toplam} adet` +
                kanalUyarisi,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    } catch (err) {
      logger.error('Interaction failed: /banlılarpanel.', err);
      const payload = {
        embeds: [buildErrorEmbed('Panel gönderilirken bir hata oluştu.')],
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  },
};