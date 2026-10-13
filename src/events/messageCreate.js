/**
 * messageCreate - IC isim onay kanalı takibi + Banlılar bildirim formu yanıtları.
 *
 * 1) IC isim onayı: Sadece ayarlı kanaldaki bot-dışı mesajlarla ilgilenir.
 * 2) Banlılar formu: kullanıcının "Banlıyım" butonuna basmasıyla açılan soru
 *    akışında, kendisine sorulan sorulara verdiği yanıtlar. Yalnızca formun
 *    başlatıldığı kanalda, yalnızca formu başlatan kullanıcının mesajları
 *    işlenir — diğer mesajlara dokunulmaz.
 */
const config = require('../config');
const logger = require('../utils/logger');
const { handleIcMessage } = require('../handlers/icHandler');
const ban = require('../handlers/banli');

module.exports = {
  name: 'messageCreate',

  async execute(message) {
    try {
      if (!message?.guild || message.author?.bot) return;

      // --- 1) IC isim onay kanalı (mevcut davranış, bozulmadı) ---
      const watchId = config.icApprovalChannelId;
      if (watchId && message.channelId === watchId) {
        await handleIcMessage(message);
        return;
      }

      // --- 2) Banlılar bildirim formu yanıtları ---
      if (await ban.handleCevap(message)) return;
    } catch (err) {
      logger.error('messageCreate failed.', err);
    }
  },
};