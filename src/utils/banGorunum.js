/**
 * banGorunum.js — BANLILAR BİLDİRİM SİSTEMİ görünümleri.
 *
 * Ayrı dosya: bu görünümler banli.js içindeki forma özel yardımcılardır.
 * Banlılar sistemi YALNIZCA bu görünümleri kullanır; ticket / mazeret /
 * guard sistemlerinden hiçbir şey import etmez (mevcut sistemlere
 * dokunulmamıştır).
 *
 * Akış:  /banlılarpanel paneli → 🔨 Banlıyım → bot KULLANICIYA DM ile
 *        1) Ban ID   2) Ban Sebebi   3) Ban Tarihi   sorar.
 *        Yanıtlar DM üzerinden yazılır. Kanalda hiçbir soru/cevap görünmez —
 *        yalnızca bildirim gönderilirken tek bir herkese açık onay mesajı
 *        yazılır (kanalın sakin olması için).
 */
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/** Discord embed alan sınırları. */
const KISA_MAX = 256;
const ALAN_MAX = 1024;

/* ------------------------------------------------------------------ */
/* Güvenli metin                                                       */
/* ------------------------------------------------------------------ */

/**
 * Kullanıcı metnini güvenli hale getirir — PING üretilmesini engeller.
 * @everyone/@here yok edilir, mention kodları düz metne çevrilir.
 */
function guvenliMetin(text, max = 200) {
  let s = String(text ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/@everyone/gi, '[everyone]')
    .replace(/@here/gi, '[here]')
    .replace(/<@!?(\d+)>/g, '@kullanıcı')
    .replace(/<@&(\d+)>/g, '@rol')
    .replace(/<#(\d+)>/g, '#kanal')
    .replace(/<t:(-?\d+)(:[a-zA-Z])?>/g, 'zaman')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.slice(0, max);
  return s || 'Belirtilmedi';
}

/** Discord zaman damgası. */
function ts(ms, style = 'f') {
  return `<t:${Math.floor(Number(ms) / 1000)}:${style}>`;
}

/* ------------------------------------------------------------------ */
/* 1) Panel                                                            */
/* ------------------------------------------------------------------ */

/** Başlık: BANLILAR BİLDİRİM SİSTEMİ — sade tasarım, tek buton. */
function buildPanelEmbed({ guildName = null } = {}) {
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('BANLILAR BİLDİRİM SİSTEMİ')
    .setDescription(
      'Oyun sunucusundan yasaklandıysanız ban bilgilerinizi aşağıdaki buton üzerinden bildirebilirsiniz. ' +
        'Girdiğiniz bilgileri eksiksiz ve doğru şekilde doldurunuz.',
    );

  if (guildName) embed.setFooter({ text: guildName });
  return embed;
}

/** Panel butonu: YALNIZCA "Banlıyım" */
function buildBildirRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('bn_bildir')
      .setLabel('Banlıyım')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔨'),
  );
}

/* ------------------------------------------------------------------ */
/* 2) Sorular (bot DM ile sorar)                                       */
/* ------------------------------------------------------------------ */

/**
 * SORULAR — akış sırası.
 * Ban TARİHİ serbest metindir: "1 gün önce", "2 hafta önce", "3 ay önce".
 * Tarih ayrıntılı (gün.ay.yıl saat:dakika) DEĞİL, oyuncu istediğini yazar.
 */
const SORULAR = [
  {
    adim: 'id',
    sira: '1/3',
    baslik: '🆔 BAN ID',
    aciklama: 'Ban ID’nizi yazın.',
    ipucu: 'Sunucunun size verdiği ban kimliğini yazabilirsiniz.',
    cevapOrnek: 'Örnek: `license:abc123` veya `1234567890`',
  },
  {
    adim: 'sebep',
    sira: '2/3',
    baslik: '📋 BAN SEBEBİ',
    aciklama: 'Hangi sebeple banlandığınızı yazınız.',
    ipucu: null,
    cevapOrnek: null,
  },
  {
    adim: 'tarih',
    sira: '3/3',
    baslik: '📅 BAN TARİHİ',
    aciklama: 'Ban yediğiniz tarihi yazınız.',
    ipucu: 'Ne zaman banlandığınızı yazabilirsiniz.',
    cevapOrnek: 'Örnek: `1 gün önce`, `2 hafta önce`, `3 ay önce`',
  },
];

/**
 * Botun DM'de sorduğu tek soru.
 * @param {string} adim 'id' | 'sebep' | 'tarih'
 * @param {string} komutAdi iptal komutu
 */
function buildSoruMesaji(adim, komutAdi = 'iptal') {
  const s = SORULAR.find((x) => x.adim === adim);
  if (!s) return null;
  return (
    `**${s.sira} — ${s.baslik}**\n` +
    `${s.aciklama}` +
    (s.ipucu ? `\n${s.ipucu}` : '') +
    (s.cevapOrnek ? `\n${s.cevapOrnek}` : '') +
    `\n\n*Cevabınızı bu mesajı yanıtlayarak yazın. Vazgeçerseniz "${komutAdi}" yazın.*`
  );
}

/** Geçersiz yanıt sonrası aynı soru tekrar sorulur. */
function buildTekrarMesaji(adim, hata, komutAdi = 'iptal') {
  const s = SORULAR.find((x) => x.adim === adim);
  if (!s) return `⚠️ ${hata}`;
  return (
    `**⚠️ ${s.sira} — ${s.baslik}**\n` +
    `${hata}\n\n` +
    `${s.aciklama}` +
    (s.cevapOrnek ? `\n${s.cevapOrnek}` : '') +
    `\n\n*Vazgeçerseniz "${komutAdi}" yazın.*`
  );
}

/** Butona basıldı, DM açılıyor — kullanıcıya bilgi. */
function buildBaslangicMesaji(kanalAd) {
  return (
    `🔨 **Ban bildirim formu başlatıldı**\n\n` +
    `Bundan sonraki sorulara **yalnızca bu özel mesajda** cevap vereceksiniz. ` +
    `Sunucu kanalında soru veya cevabınız görünmez.\n\n` +
    `Cevaplarınız tamamlanınca bildiriminiz yetkililere iletilecek.` +
    (kanalAd ? `\n\n*Bildirim kanalı:* #${kanalAd}` : '')
  );
}

/** DM açılamadı — kanaldaki kullanıcıya bildirilir. */
function buildDmHataMesaji(kanalId) {
  return (
    `❌ **Ban bildirim formu başlatılamadı**\n\n` +
    `Sistem sana özel mesaj (DM) açamadı. Lütfen **Sunucu Ayarları → Gizlilik ve Güvenlik → Mesaj Durumu**'nda ` +
    `"Sunucudan mesaj al" iznini aç ve tekrar dene.\n\n` +
    `Sorun devam ederse ${kanalId ? `<#${kanalId}> kanalından yetkiliye` : 'yetkiliye'} bildir.`
  );
}

/* ------------------------------------------------------------------ */
/* 3) Bildirim embed'i (bildirim kanalına gider)                       */
/* ------------------------------------------------------------------ */

/**
 * @param {{userId:string, banId:string, sebep:string, tarih:string, now:number}} p
 */
function buildBildirimEmbed(p) {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🔨 YENİ BAN BİLDİRİMİ')
    .addFields(
      { name: '👤 Kullanıcı', value: `<@${p.userId}>`, inline: false },
      { name: '🆔 Ban ID', value: guvenliMetin(p.banId, KISA_MAX), inline: false },
      { name: '📋 Ban Sebebi', value: guvenliMetin(p.sebep, ALAN_MAX), inline: false },
      { name: '📅 Ban Tarihi', value: guvenliMetin(p.tarih, KISA_MAX), inline: false },
      { name: '🕒 Bildirim Zamanı', value: `${ts(p.now)} (${new Date(p.now).toLocaleString('tr-TR')})`, inline: false },
    )
    .setFooter({ text: 'WellsdAutorazer • Ban Bildirim Sistemi' })
    .setTimestamp(p.now);
}

/** Başarılı — DM'e yazılır (yalnızca bildiren kullanıcı görür). */
function buildOnayMesaji(kanalId) {
  return (
    `✅ **Ban bildiriminiz alındı ve yetkililere iletildi.**\n\n` +
    `Girdiğiniz bilgiler ${kanalId ? `<#${kanalId}> kanalına` : 'yetkililere'} gönderildi.\n` +
    `Başka bir bildirim yapmak isterseniz paneldeki "Banlıyım" butonuna tekrar basabilirsiniz.`
  );
}

/** Gönderilemedi — DM'e yazılır. */
function buildHataMesaji(metin) {
  return `❌ **${metin}**`;
}

/** İptal edildi. */
function buildIptalMesaji() {
  return 'Ban bildirim formu iptal edildi. Paneldeki "Banlıyım" butonuna tekrar basabilirsiniz.';
}

/** Bekleme zamanı aştı. */
function buildZamanAsimiMesaji(dakika) {
  return (
    `⏳ **Süre doldu.**\n\n` +
    `Ban bildirim formu ${Math.round(dakika)} dakika boyunca yanıtsız kaldı ve kapatıldı.\n` +
    `Paneldeki "Banlıyım" butonuna tekrar basarak başlayabilirsiniz.`
  );
}

module.exports = {
  KISA_MAX,
  ALAN_MAX,
  SORULAR,
  guvenliMetin,
  ts,
  buildPanelEmbed,
  buildBildirRow,
  buildSoruMesaji,
  buildTekrarMesaji,
  buildBaslangicMesaji,
  buildDmHataMesaji,
  buildBildirimEmbed,
  buildOnayMesaji,
  buildHataMesaji,
  buildIptalMesaji,
  buildZamanAsimiMesaji,
};