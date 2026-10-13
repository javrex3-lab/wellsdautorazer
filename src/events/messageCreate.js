/**
 * messageCreate - IC isim onay kanalı takibi.
 * Sadece ayarlı kanaldaki bot-dışı mesajlarla ilgilenir; diğer mesajlar yoksayılır.
 *
 * NOT: Banlılar bildirim formu ARTIK kanal mesajıyla çalışmaz —
 * tüm sorular ephemeral etkileşimlerdir (bkz. handlers/banli.js).
 */
const config = require('../config');
const logger = require('../utils/logger');
const { handleIcMessage } = require('../handlers/icHandler');

module.exports = {
  name: 'messageCreate',

  async execute(message) {
    try {
      if (!message?.guild || message.author?.bot) return;
      const watchId = config.icApprovalChannelId;
      if (!watchId || message.channelId !== watchId) return;
      await handleIcMessage(message);
    } catch (err) {
      logger.error('messageCreate failed.', err);
    }
  },
};