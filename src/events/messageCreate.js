/**
 * messageCreate - IC isim onay kanalı takibi.
 * Sadece ayarlı kanaldaki bot-dışı mesajlarla ilgilenir; diğer mesajlar yoksayılır.
 *
 * NOT: Banlılar bildirim formu ARTIK kanal mesajıyla çalışmaz —
 * tüm sorular ephemeral etkileşimlerdir (bkz. handlers/banli.js).
 */
const config = require('../config');
const logger = require('../utils/logger');

// Yapılandırma hatası her mesajda loglanırsa günlük spam olur; bu yüzden
// yalnızca BİR kez uyarılır. Ama HİÇ loglanmaması da hatadır: sistem
// sessizce ölüyken kullanıcı panel bekliyordu ve nedeni görünmüyordu.
let eksikKanalUyarildi = false;
const { handleIcMessage } = require('../handlers/icHandler');

module.exports = {
  name: 'messageCreate',

  async execute(message) {
    try {
      if (!message?.guild || message.author?.bot) return;
      const watchId = config.icApprovalChannelId;
if (!watchId) {
  if (!eksikKanalUyarildi) {
    eksikKanalUyarildi = true;
    logger.error(
      'IC İSİM SİSTEMİ KAPALI: IC_APPROVAL_CHANNEL_ID ayarlanmamış. ' +
        'Kanala yazılan mesajlar işlenmiyor ve onay paneli açılmıyor.',
    );
  }
  return;
}
if (message.channelId !== watchId) return;
      await handleIcMessage(message);
    } catch (err) {
      logger.error('messageCreate failed.', err);
    }
  },
};