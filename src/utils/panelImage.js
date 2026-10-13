/**
 * Ortak panel görseli (BANLILAR + MAZERET panelleri).
 *
 * Dosya repoda GÖMÜLÜDÜR ve mesaja attachment olarak eklenir;
 * adresine bağlanır (CDN 404 riski yok — mesaj silinmeden görsel hep erişilebilir).
 * Bu, ticket sistemindeki mevcut desenin aynısıdır.
 *
 * Yapılandırma:
 *  - kaynak: dosya -> mesaja yüklenir (en sağlam, varsayılan)
 *  - kaynak: yok   -> görselsiz panel (sistem ÇÖKMEZ, panel yine gider)
 *
 * ! ÖNEMLİ: discord.js ham ReadStream verildiğinde dosya adını YOLUN BASENAME'inden
 *   üretir (MessagePayload.resolveFile -> findName). Bu yüzden dosya adı AYRI
 *   olarak açıkça verilir; aksi halde `attachment://<ad>` çözülmez ve görsel
 *   embed içinde GÖRÜNMEZ. İki değer birbirinden bağımsız olduğu için bu
 *   ayrım kritiktir.
 *
 * Not: Ticket paneli kendi kopyasını (tickets.js) kullanır;
 */
const fs = require('fs');
const path = require('path');

/** Gömülü görselin yolu ve attachment adı. */
const PANEL_GORSEL_DOSYA = path.join(__dirname, '..', '..', 'assets', 'ticket-panel.png');
const PANEL_GORSEL_ADI = 'panel-gorsel.png';

/**
 * Panel görselini çözer.
 * @returns {{kaynak:'dosya'|'yok', yol?:string, imageUrl?:string, ad?:string}}
 */
function panelGorseli() {
  try {
    if (fs.existsSync(PANEL_GORSEL_DOSYA)) {
      return {
        kaynak: 'dosya',
        yol: PANEL_GORSEL_DOSYA,
        ad: PANEL_GORSEL_ADI,
        imageUrl: `attachment://${PANEL_GORSEL_ADI}`,
      };
    }
  } catch {
    /* dosya okunamadi -> gorselsiz devam */
  }
  return { kaynak: 'yok' };
}

/**
 * Discord payload için `files` dizisi üretir (dosya yoksa boş).
 * Mesaj ZATEN gönderilmişse ekleme yapılmamalıdır: `attachment://`
 * adresi mesaja eklenmiş dosyaya çözümlenir, düzenlemede tekrar yükleme
 * gerekmez (ve Discord gereksiz bant genişliği harcar).
 *
 * @param {{kaynak:string, yol?:string, ad?:string}} g
 * @param {boolean} ilkGonderim mesaj yeni mi oluşturuluyor
 */
function panelDosyalari(g, ilkGonderim) {
  if (!g || g.kaynak !== 'dosya' || !ilkGonderim) return [];
  try {
    // Ad AÇIKÇA verilir: ham ReadStream'de discord.js basename'i kullanır ve bu
    // ad attachment:// referansıyla örtüşmezse görsel embed içinde görünmez.
    return [{ attachment: fs.createReadStream(g.yol), name: g.ad }];
  } catch {
    return [];
  }
}

module.exports = { PANEL_GORSEL_DOSYA, PANEL_GORSEL_ADI, panelGorseli, panelDosyalari };