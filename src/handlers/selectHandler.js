/**
 * Select menu interaction yönlendirici (StringSelect + UserSelect).
 * Button'larla aynı desen: statik customId, restart-safe.
 */
const { MessageFlags } = require('discord.js');
const { buildErrorEmbed } = require('../utils/embeds');
const { buildCategoryMenu } = require('../utils/ticketEmbeds');
const { createTicketFromSelect, handleAddUserSelect } = require('./ticketHandler');
const logger = require('../utils/logger');

async function handleSelectMenu(interaction) {
  try {
    // --- String Select: ticket kategori menüsü ---
    if (interaction.isStringSelectMenu()) {
      logger.info(`[SELECT GIRDI] customId=${interaction.customId} degerler=${JSON.stringify(interaction.values)}`);
      if (interaction.customId !== 'ticket_category') {
        logger.warn(`[SELECT REDDEDILDI] customId=${interaction.customId} (ticket_category değil)`);
        return false;
      }

      const value = interaction.values?.[0];

      // Seçimi sıfırla: SADECE menü ilk haline döner.
      // Embed'e bilinçli olarak DOKUNULMAZ (panel görseli neyse korunur).
      if (value === 'ticket_reset') {
        // Hatalar YUTULMAZ: aynı etkileşimde update() de 404 alıyorsa
        // sorun deferReply'ye değil, etkileşimin kendisine demektir.
        try {
          await interaction.update({ components: [buildCategoryMenu()] });
          logger.info('[SELECT RESET] update başarılı — etkileşim GEÇERLİ');
        } catch (err) {
          logger.error(`[SELECT RESET] update BAŞARISIZ code=${err.code} status=${err.status} msg=${err.message}`);
          throw err;
        }
        try {
          await interaction.followUp({ content: '🔄 Seçim sıfırlandı.', flags: MessageFlags.Ephemeral });
          logger.info('[SELECT RESET] followUp başarılı');
        } catch (err) {
          logger.warn(`[SELECT RESET] followUp BAŞARISIZ code=${err.code} msg=${err.message}`);
        }
        return true;
      }

      // Kategori seçimi: ticketcat:<key>
      if (typeof value === 'string' && value.startsWith('ticketcat:')) {
        const key = value.slice('ticketcat:'.length);
        logger.info(`[SELECT] ticket açılacak: key=${key}`);
        try {
          await createTicketFromSelect(interaction, key);
          logger.info(`[SELECT] createTicketFromSelect döndü, key=${key}`);
        } catch (err) {
          logger.error(`[SELECT] createTicketFromSelect PATLADI: ${err.code || ''} ${err.message}`);
          throw err;
        }
        return true;
      }

      return false;
    }

    // --- User Select: ticket'a kullanıcı ekleme ---
    if (interaction.isUserSelectMenu()) {
      if (interaction.customId !== 'ticket_adduser_select') return false;
      await handleAddUserSelect(interaction);
      return true;
    }

    return false;
  } catch (err) {
    if (err?.code === 10062) {
      logger.error('Interaction EXPIRED: [select] — kullanıcı "Uygulama yanıt vermedi" gördü.');
      return true;
    }
    logger.error(`Interaction failed: select ${interaction.customId}`, err);
    try {
      const payload = { embeds: [buildErrorEmbed('İşlem sırasında bir hata oluştu.')], flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else if (interaction.isRepliable()) await interaction.reply(payload).catch(() => {});
    } catch {
      /* sessiz geç */
    }
    return true;
  }
}

module.exports = { handleSelectMenu };
