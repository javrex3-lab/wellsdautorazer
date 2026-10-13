/**
 * BANLILAR BİLDİRİM SİSTEMİ — görünümler.
 *
 * Akış:  /banlılarpanel → 🔨 Banlıyım → sorular (TAMAMI EPHEMERAL)
 *          1) 🆔 Ban ID     → "Ban ID Yaz" düğmesi → yazma penceresi
 *          2) 📋 Ban Sebebi → "Ban Sebebi Yaz" düğmesi → yazma penceresi
 *          3) 📅 Ban Tarihi → hazır seçenek düğmeleri (1 gün önce / 1 hafta önce / ...)
 *        → bildirim 1559535039614689362 kanalına gider.
 *
 * Kullanıcı KANALA MESAJ YAZMAZ; her şey yalnızca kendisine görünür.
 *
 * Bu bir OYUN (FiveM) banı bildirimi — Discord banı değil. Ban ID'nin
 * platformu bize bilinmez; kullanıcı ne yazarsa "kullanıcı bildirimi"
 * olarak saklanır, doğrulanmış gibi sunulmaz.
 */
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

/** customId'ler tek yerden. */
const CID = {
  BILDIR: 'bn_bildir', // panel üzerindeki "Banlıyım"
  ID_YAZ: 'bn_id_yaz', // "Ban ID Yaz" düğmesi
  ID_MODAL: 'bn_id_modal', // Ban ID yazma penceresi
  SEBEP_YAZ: 'bn_sebep_yaz', // "Ban Sebebi Yaz" düğmesi
  SEBEP_MODAL: 'bn_sebep_modal', // sebep yazma penceresi
  TARIH_SEC: 'bn_tarih', // "bn_tarih:<id>" hazır seçenek
  TARIH_OZEL_YAZ: 'bn_tarih_ozel_yaz',
  TARIH_OZEL_MODAL: 'bn_tarih_ozel_modal',
  IPTAL: 'bn_iptal',
};

const ALAN_MAX = 1024;
const KISA_MAX = 256;

/* ------------------------------------------------------------------ */
/* Güvenli metin                                                       */
/* ------------------------------------------------------------------ */

/** Kullanıcı metnini güvenli hale getirir — PING üretilmesini engeller. */
function guvenliMetin(text, max = 200) {
  let s = String(text ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
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

function ts(ms, style = 'f') {
  return `<t:${Math.floor(Number(ms) / 1000)}:${style}>`;
}

/* ------------------------------------------------------------------ */
/* 1) Panel                                                            */
/* ------------------------------------------------------------------ */

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

function buildBildirRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CID.BILDIR).setLabel('Banlıyım').setStyle(ButtonStyle.Danger).setEmoji('🔨'),
  );
}

/* ------------------------------------------------------------------ */
/* 2) Soru adımları                                                    */
/* ------------------------------------------------------------------ */

/** Akış sırası. */
const ADIMLAR = [
  {
    adim: 'id',
    sira: '1/3',
    baslik: '🆔 BAN ID',
    metin: 'Ban ID’nizi aşağıdaki düğmeye basarak yazın.',
    ipucu: 'Sunucunun size verdiği ban kimliğini yazabilirsiniz.',
  },
  {
    adim: 'sebep',
    sira: '2/3',
    baslik: '📋 BAN SEBEBİ',
    metin: 'Hangi sebeple banlandığınızı aşağıdaki düğmeye basarak yazın.',
    ipucu: null,
  },
  {
    adim: 'tarih',
    sira: '3/3',
    baslik: '📅 BAN TARİHİ',
    metin: 'Ne zaman ban yediğinizi aşağıdan seçin.',
    ipucu: null,
  },
];

/** Hazır ban tarihi seçenekleri. */
const TARIH_SECENEKLERI = [
  { id: '1g', etiket: '1 gün önce', gun: 1 },
  { id: '3g', etiket: '3 gün önce', gun: 3 },
  { id: '1h', etiket: '1 hafta önce', gun: 7 },
  { id: '2h', etiket: '2 hafta önce', gun: 14 },
  { id: '1a', etiket: '1 ay önce', gun: 30 },
  { id: '3a', etiket: '3 ay önce', gun: 90 },
  { id: '6a', etiket: '6 ay önce', gun: 180 },
  { id: '1y', etiket: '1 yıl önce', gun: 365 },
];

const TARIH_GUN_MS = 86_400_000;

/** Seçenek etiketine karşılık gün sayısı (özel yazılanlar için yok). */
function tarihSecenekBul(id) {
  return TARIH_SECENEKLERI.find((x) => x.id === id) || null;
}

/* ------------------------------------------------------------------ */
/* 3) Yazma pencereleri (modal) — yalnızca metin girdisi için          */
/* ------------------------------------------------------------------ */

function buildIdModal() {
  return new ModalBuilder()
    .setCustomId(CID.ID_MODAL)
    .setTitle('Ban ID')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('deger')
          .setLabel('Ban ID')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Sunucunun verdiği ban kimliği')
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(128),
      ),
    );
}

function buildSebepModal() {
  return new ModalBuilder()
    .setCustomId(CID.SEBEP_MODAL)
    .setTitle('Ban Sebebi')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('deger')
          .setLabel('Ban Sebebi')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Hangi sebeple banlandığınızı yazınız.')
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(900),
      ),
    );
}

function buildTarihOzelModal() {
  return new ModalBuilder()
    .setCustomId(CID.TARIH_OZEL_MODAL)
    .setTitle('Ban Tarihi')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('deger')
          .setLabel('Ban Tarihi')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Örnek: 12.10.2026 18:30')
          .setRequired(true)
          .setMinLength(5)
          .setMaxLength(64),
      ),
    );
}

/* ------------------------------------------------------------------ */
/* 4) Soru mesajları (EPHEMERAL — yalnızca tıklayan kişi görür)       */
/* ------------------------------------------------------------------ */

const IPTAL_DUGME = () =>
  new ButtonBuilder().setCustomId(CID.IPTAL).setLabel('İptal').setStyle(ButtonStyle.Secondary).setEmoji('❌');

/**
 * Bir adımın tam görünümü.
 * @param {string} adim 'id' | 'sebep' | 'tarih'
 * @param {{id?:string, sebep?:string, tarih?:string}} veri şu ana kadar girilenler
 * @returns {{content:string, embeds:object[], components:object[]}}
 */
/** Bu adim icin veri girilmis mi? */
function ONCEKILER_GIRDI_mi(adim, veri) {
  return Boolean(String(veri[adim] ?? '').trim());
}

function buildSoruMesaji(adim, veri = {}) {
  const s = ADIMLAR.find((x) => x.adim === adim);
  if (!s) return null;

  const d = (v) => (v ? `• ${v}` : '_henüz girilmedi_');

  let aciklama = s.metin;
  if (adim === 'id') aciklama += `\n\n**Ban ID:** ${d(veri.id)}`;
  if (adim === 'sebep') aciklama += `\n\n**Ban Sebepi:** ${d(veri.sebep)}`;
  if (adim === 'tarih') aciklama += `\n\n**Ban Tarihi:** ${d(veri.tarih)}`;

  // Onceki adimda girilenler kisaltik olarak gosterilir (kullanici ne kadar
  // ilerledigini gorur, veri kaybini onler).
  const ONCEKILER = [
    ['id', 'Ban ID', veri.id],
    ['sebep', 'Ban Sebepi', veri.sebep],
    ['tarih', 'Ban Tarihi', veri.tarih],
  ].filter(([a]) => a !== adim && ONCEKILER_GIRDI_mi(a, veri));
  if (ONCEKILER.length) {
    aciklama +=
      '\n\n*Şu ana kadar girdikleriniz:*\n' +
      ONCEKILER.map(([, ad, v]) => `• ${ad}: ${v}`).join('\n');
  }

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`${s.sira} — ${s.baslik}`)
    .setDescription(aciklama)
    .setFooter({ text: 'Bu sorular yalnızca size görünür. Kanala yazmanız gerekmez.' });

  if (adim === 'id') {
    if (s.ipucu) embed.addFields({ name: 'Bilmeniz gereken', value: s.ipucu, inline: false });
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(CID.ID_YAZ)
          .setLabel(veri.id ? 'Ban ID’yi Değiştir' : 'Ban ID Yaz')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('✏️'),
      )
      .addComponents(IPTAL_DUGME());
    return { content: '', embeds: [embed], components: [row] };
  }

  if (adim === 'sebep') {
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(CID.SEBEP_YAZ)
          .setLabel(veri.sebep ? 'Ban Sebebini Değiştir' : 'Ban Sebebi Yaz')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('✏️'),
      )
      .addComponents(IPTAL_DUGME());
    return { content: '', embeds: [embed], components: [row] };
  }

  // tarih — hazır seçenekler (5'li satırlar) + özel yaz + iptal
  const dugmeler = TARIH_SECENEKLERI.map((o) =>
    new ButtonBuilder()
      .setCustomId(`${CID.TARIH_SEC}:${o.id}`)
      .setLabel(o.etiket)
      .setStyle(veri.tarih === o.etiket ? ButtonStyle.Success : ButtonStyle.Secondary),
  );
  const satirlar = [];
  for (let i = 0; i < dugmeler.length; i += 5) {
    satirlar.push(new ActionRowBuilder().addComponents(dugmeler.slice(i, i + 5)));
  }
  satirlar.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CID.TARIH_OZEL_YAZ)
        .setLabel('Kendim Yazacağım')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✏️'),
      IPTAL_DUGME(),
    ),
  );
  return { content: '', embeds: [embed], components: satirlar };
}

/** Tamamlandı — kullanıcıya özel onay. */
function buildTamamMesaji({ userId, kanalId }) {
  return {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Ban bildiriminiz alındı')
        .setDescription(
          `Bilgileriniz ${kanalId ? `<#${kanalId}> kanalına` : 'yetkililere'} iletildi.\n\n` +
            'İnceleme sonrası sonuçlandırılacaktır.',
        )
        .setFooter({ text: `Bildiren: <@${userId}>` }),
    ],
    components: [],
  };
}

function buildIptalMesaji() {
  return {
    content: '',
    embeds: [
      new EmbedBuilder()
        .setColor(0x95a5a6)
        .setDescription('Ban bildirim formu iptal edildi. Panel üzerindeki **Banlıyım** düğmesiyle tekrar başlayabilirsiniz.'),
    ],
    components: [],
  };
}

function buildHataMesaji(metin) {
  return {
    content: '',
    embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription(`❌ **${metin}**`)],
    components: [],
  };
}

/* ------------------------------------------------------------------ */
/* 5) Bildirim embed'i (kanala gönderilen)                             */
/* ------------------------------------------------------------------ */

/** Seçilen etiketten yaklaşık tarihi hesaplar (yoksa null). */
function yaklasikTarih(etiket, now = Date.now()) {
  const o = TARIH_SECENEKLERI.find((x) => x.etiket === etiket);
  if (!o) return null;
  return now - o.gun * TARIH_GUN_MS;
}

function buildBildirimEmbed(p) {
  const yak = yaklasikTarih(p.tarih, p.now);
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🔨 YENİ BAN BİLDİRİMİ')
    .addFields(
      { name: '👤 Kullanıcı', value: `<@${p.userId}>`, inline: false },
      { name: '🆔 Ban ID', value: guvenliMetin(p.banId, KISA_MAX), inline: false },
      { name: '📋 Ban Sebebi', value: guvenliMetin(p.sebep, ALAN_MAX), inline: false },
      {
        name: '📅 Ban Tarihi',
        value: guvenliMetin(p.tarih, KISA_MAX) + (yak ? `\n${ts(yak)} *(tahmini)*` : ''),
        inline: false,
      },
      { name: '🕒 Bildirim Zamanı', value: `${ts(p.now)} (${new Date(p.now).toLocaleString('tr-TR')})`, inline: false },
    )
    .setFooter({ text: 'WellsdAutorazer • Ban Bildirim Sistemi' })
    .setTimestamp(p.now);
}

module.exports = {
  CID,
  ALAN_MAX,
  KISA_MAX,
  ADIMLAR,
  TARIH_SECENEKLERI,
  TARIH_GUN_MS,
  tarihSecenekBul,
  yaklasikTarih,
  guvenliMetin,
  ts,
  buildPanelEmbed,
  buildBildirRow,
  buildIdModal,
  buildSebepModal,
  buildTarihOzelModal,
  buildSoruMesaji,
  buildTamamMesaji,
  buildIptalMesaji,
  buildHataMesaji,
  buildBildirimEmbed,
};