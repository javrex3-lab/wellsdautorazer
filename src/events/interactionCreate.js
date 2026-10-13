/**
 * interactionCreate - tüm slash command + button interaction'ları tek noktadan yönetilir.
 * Hiçbir hata crash'e yol açmaz; kullanıcıya teknik detay gösterilmez.
 * Her etkileşimin süresi loglanır: 3sn Discord ACK penceresini aşanlar terminalde belli olur.
 */
const { MessageFlags } = require('discord.js');
const { buildErrorEmbed } = require('../utils/embeds');
const { hasCommandAccess, canManageRoles, canManageBan } = require('../utils/permissions');
const { canManageGuard } = require('../guard/permissions');
const { handleButton } = require('../handlers/buttonHandler');
const mz = require('../handlers/mazeret');
const ban = require('../handlers/banli');
const logger = require('../utils/logger');

function labelOf(interaction) {
  try {
    if (interaction.isChatInputCommand()) return `/${interaction.commandName}`;
    if (interaction.isButton()) return `[buton:${interaction.customId}]`;
    if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) return `[select:${interaction.customId}]`;
    if (interaction.isModalSubmit()) return `[modal:${interaction.customId}]`;
  } catch {
    /* ignore */
  }
  return '[bilinmeyen-etkileşim]';
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    const label = labelOf(interaction);

    // Her etkileşim gelişinde id loglanır. AYNI id iki kez görünürse
    // etkileşim çift işleniyor demektir (40060 sebebi).
    try {
      logger.info(`GELEN ETKİLEŞİM id=${interaction.id} tip=${interaction.type} customId=${interaction.customId || '-'} user=${interaction.user?.id}`);
    } catch {}
    const start = Date.now();

    try {
      // --- Butonlar ---
      if (interaction.isButton()) {
        const handled = await handleButton(interaction);
        if (!handled) {
          logger.warn(`Bilinmeyen buton customId: ${interaction.customId}`);
          if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ embeds: [buildErrorEmbed('Bilinmeyen buton.')], flags: MessageFlags.Ephemeral }).catch(() => {});
          }
        }
        logger.info(`Interaction handled: ${label} (${Date.now() - start}ms)`);
        return;
      }


      // --- Select menüleri (mazeret süre seçimi) ---
      if (interaction.isAnySelectMenu && interaction.isAnySelectMenu()) {
        if (interaction.customId === mz.CID.SURE) {
          await mz.handleSureSelect(interaction);
        } else {
          logger.warn(`Bilinmeyen select customId: ${interaction.customId}`);
          if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction
              .reply({ embeds: [buildErrorEmbed('Bilinmeyen liste.')], flags: MessageFlags.Ephemeral })
              .catch(() => {});
          }
        }
        logger.info(`Interaction handled: ${label} (${Date.now() - start}ms)`);
        return;
      }

      // --- Modal gönderimleri (mazeret sebebi) ---
      if (interaction.isModalSubmit()) {
          /* Banlılar: yalnızca Ban ID / Ban Sebebi / özel tarih için metin girdisi */
          if (interaction.customId.startsWith('bn_')) {
            await ban.handleModalSubmit(interaction);
          } else if (interaction.customId === mz.CID.SEBEP) {
            await mz.handleSebepSubmit(interaction);
        } else {
          logger.warn(`Bilinmeyen modal customId: ${interaction.customId}`);
          if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction
              .reply({ embeds: [buildErrorEmbed('Bilinmeyen form.')], flags: MessageFlags.Ephemeral })
              .catch(() => {});
          }
        }
        logger.info(`Interaction handled: ${label} (${Date.now() - start}ms)`);
        return;
      }

      // --- Slash komutlar ---
      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands?.get(interaction.commandName);
        if (!command) {
          logger.warn(`Bilinmeyen komut: /${interaction.commandName}`);
          return interaction.reply({ embeds: [buildErrorEmbed('Bu komut bulunamadı.')], flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        // Global erişim kapısı: liste doluysa sadece izinli roller + adminler.
        // İstisnalar: openToEveryone (herkes), openToRoleManagers (/rolver+/rolal),
        // openToBanManagers (/ban+/unban), openToGuardManagers (guard komutları).
        // İşaretli komutlar ilgili kitleye de açıktır.
        const globalOk = hasCommandAccess(interaction.member);
        const everyoneOk = command.openToEveryone === true;
        const roleOk = command.openToRoleManagers === true && canManageRoles(interaction.member);
        const banOk = command.openToBanManagers === true && canManageBan(interaction.member);
        const guardOk = command.openToGuardManagers === true && canManageGuard(interaction.member);
        if (!globalOk && !everyoneOk && !roleOk && !banOk && !guardOk) {
          return interaction.reply({ embeds: [buildErrorEmbed('Bu botu kullanma yetkin yok.')], flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        await command.execute(interaction);
        const ms = Date.now() - start;
        if (ms > 2500) logger.warn(`Interaction YAVAŞ: ${label} ${ms}ms sürdü (Discord 3sn penceresine yakın!)`);
        else logger.info(`Interaction handled: ${label} (${ms}ms)`);
        return;
      }
    } catch (err) {
      const ms = Date.now() - start;
      // 10062 = Unknown interaction: Discord 3sn içinde ACK almadığı için etkileşimi düşürdü.
      // Kullanıcı "Uygulama yanıt vermedi" görür. Sebep: ağ yavaşlığı veya bot gecikmesi.
      if (err?.code === 10062 || err?.status === 404) {
        logger.error(
          `Interaction EXPIRED: ${label} ACK ${ms}ms'de tamamlanamadı — kullanıcı "Uygulama yanıt vermedi" gördü. ` +
            `Sebep genelde yavaş ağdır (bakın: REST heartbeat logları).`,
        );
        return;
      }
      logger.error(`Interaction failed: ${label} (${ms}ms)`, err);
      try {
        const payload = { embeds: [buildErrorEmbed('Bir hata oluştu. Lütfen tekrar deneyin.')], flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
        else if (interaction.isRepliable()) await interaction.reply(payload).catch(() => {});
      } catch {
        /* son çare sessiz geç */
      }
    }
  },
};
