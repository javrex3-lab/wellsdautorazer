/**
 * YENİ MAZERET SİSTEMİ — görünümler (embed, buton, select, modal).
 *
 * ESKİ `src/utils/mazeretEmbeds.js` ve `src/utils/mazeretDuration.js` SİLİNDİ.
 * Süre artık serbest metin değil, SABİT seçenek listesidir (select menu),
 * bu yüzden ayrıştırıcıya gerek yoktur.
 */
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../config');

/* ------------------------------------------------------------------ */
/* Süre seçenekleri (sabit, gerçek zamanlı hesaplanır)                 */
/* ------------------------------------------------------------------ */

const SAAT = 3600_000;
const GUN = 24 * SAAT;

/** key, etiket, ms — expires_at = started_at + ms */
const SURELER = [
  { key: 's1', label: '1 saat', ms: 1 * SAAT },
  { key: 's3', label: '3 saat', ms: 3 * SAAT },
  { key: 's6', label: '6 saat', ms: 6 * SAAT },
  { key: 's12', label: '12 saat', ms: 12 * SAAT },
  { key: 'g1', label: '1 gün', ms: 1 * GUN },
  { key: 'g2', label: '2 gün', ms: 2 * GUN },
  { key: 'g3', label: '3 gün', ms: 3 * GUN },
  { key: 'h1', label: '1 hafta', ms: 7 * GUN },
];

const SURE_BY_KEY = new Map(SURELER.map((s) => [s.key, s]));
const sureBul = (key) => SURE_BY_KEY.get(String(key)) || null;

/** ms -> okunur metin (1 gün -> "1 gün 3 saat"). */
function sureMetni(ms) {
  const n = Math.max(0, Math.round(Number(ms) || 0));
  if (n === 0) return '0 dakika';
  const g = Math.floor(n / GUN);
  const sa = Math.floor((n % GUN) / SAAT);
  const dk = Math.floor((n % SAAT) / 60000);
  const parca = [];
  if (g) parca.push(`${g} gün`);
  if (sa) parca.push(`${sa} saat`);
  if (dk && !g) parca.push(`${dk} dakika`);
  return parca.length ? parca.join(' ') : '1 dakika';
}

/** Kalan süre etiketi (süre dolmuşsa "Süresi doldu"). */
function kalanEtiket(expiresAt, now = Date.now()) {
  const kalan = Number(expiresAt) - now;
  if (kalan <= 0) return 'Süresi doldu';
  return sureMetni(kalan) + ' kaldı';
}

/* ------------------------------------------------------------------ */
/* Güvenli metin                                                       */
/* ------------------------------------------------------------------ */

/**
 * Kullanıcı metnini güvenli hale getirir:
 *  - @everyone / @here kaldırılır (ping engellenir)
 *  - mention kodları (<@..>, <@&..>, <#..>) görsel metne çevrilir
 *  - uzunluk kırpılır, boşsa "Belirtilmedi"
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

/** Discord timestamp (dinamik, yerel dile göre). */
function ts(ms, style = 'f') {
  return `<t:${Math.floor(Number(ms) / 1000)}:${style}>`;
}

/* ------------------------------------------------------------------ */
/* 1) Bildirim paneli (herkese açık)                                   */
/* ------------------------------------------------------------------ */

/** Başlık sabit: MAZERET BİLDİRİM SİSTEMİ */
function buildPanelEmbed({ guildName = null, activeCount = null } = {}) {
  const embed = new EmbedBuilder()
    .setColor(config.colors.mazeret)
    .setTitle('MAZERET BİLDİRİM SİSTEMİ')
    .setDescription(
      'İzinli olacağınız süre boyunca mazeretinizi bildirmek için aşağıdaki butonu kullanabilirsiniz. ' +
        'Mazeret sürenizi seçin ve sebebinizi belirtin.',
    )
    .addFields(
      {
        name: '📋 Nasıl çalışır?',
        value: [
          '**1.** Aşağıdaki **🔔 Mazeret Bildir** butonuna basın.',
          '**2.** Sürenizi seçin (1 saat – 1 hafta).',
          '**3.** Sebebinizi yazıp gönderin.',
        ].join('\n'),
        inline: false,
      },
      {
        name: '⚠️ Önemli',
        value: 'Bir kişinin aynı anda yalnızca **1 aktif mazereti** olabilir. Süre dolmadan yeni mazeret bildiremezsiniz.',
        inline: false,
      },
    );

  if (Number.isInteger(activeCount) && activeCount > 0) {
    embed.addFields({ name: '📊 Şu an mazeretli', value: `**${activeCount}** kişi`, inline: true });
  }
  if (guildName) embed.setFooter({ text: guildName });

  return embed;
}

/** Panel butonu: YALNIZCA "Mazeret Bildir". */
function buildBildirRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mz_bildir')
      .setLabel('Mazeret Bildir')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔔'),
  );
}

/* ------------------------------------------------------------------ */
/* 2) Süre select menu                                                 */
/* ------------------------------------------------------------------ */

/** Süre seçim menüsü (8 sabit seçenek). */
function buildSureSelectRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('mz_sure')
      .setPlaceholder('⏱️ Mazeret sürenizi seçin…')
      .addOptions(
        SURELER.map((s) => ({
          label: s.label,
          value: s.key,
          description: `${sureMetni(s.ms)} mazeret`,
          emoji: s.ms <= 12 * SAAT ? '⏳' : '📆',
        })),
      ),
  );
}

/** Süre seçildikten sonra kullanıcıya gösterilen bilgi (seçenekten sonra kapanır). */
function buildSureSecildiEmbed({ label }) {
  return new EmbedBuilder()
    .setColor(config.colors.mazeret)
    .setTitle('✅ Süre seçildi')
    .setDescription(`Mazeret süreniz **${label}** olarak ayarlandı.\nŞimdi sebebinizi yazın.`)
    .setFooter({ text: 'Bir sonraki adımda sebep penceresi açılacak.' });
}

/* ------------------------------------------------------------------ */
/* 3) Sebep modalı                                                     */
/* ------------------------------------------------------------------ */

/** Modal: başlık "Mazeret Sebebi", etiket "Mazeret nedeniniz nedir?" */
function buildSebepModal(sureKey) {
  const s = sureBul(sureKey);
  return new ModalBuilder()
    .setCustomId('mz_sebep')
    .setTitle('Mazeret Sebebi')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('mz_neden')
          .setLabel('Mazeret nedeniniz nedir?')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder(
            s ? `Örn. Hastane randevum var — süre: ${s.label}` : 'Mazeretinizin sebebini yazın…',
          )
          .setRequired(true)
          .setMinLength(5)
          .setMaxLength(500),
      ),
    );
}

/* ------------------------------------------------------------------ */
/* 4) Kullanıcı onayı (ephemeral)                                      */
/* ------------------------------------------------------------------ */

function buildKayitOnayEmbed({ rec, sureLabel }) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ Mazeret bildiriminiz kaydedildi.')
    .addFields(
      { name: 'Süre', value: String(sureLabel || sureMetni(rec.duration_ms)).slice(0, 100), inline: true },
      { name: 'Başlangıç', value: ts(rec.started_at ?? rec.created_at), inline: true },
      { name: 'Bitiş', value: ts(rec.expires_at), inline: true },
      { name: 'Sebep', value: guvenliMetin(rec.reason, 1000), inline: false },
    )
    .setFooter({ text: 'Süre dolduğunda listeden otomatik çıkarılırsınız.' })
    .setTimestamp();
}

/* ------------------------------------------------------------------ */
/* 5) AKTİF MAZERETLİ MEMURLAR — merkezi panel (sayfalı)               */
/* ------------------------------------------------------------------ */

/**
 * @param {Array} rows aktif kayıtlar
 * @param {{page:number, pageCount:number, now:number}} o
 * @returns {{embed:EmbedBuilder, toplamSayfa:number}} her zaman bu tipi döner
 */
/**
 * AKTİF MAZERETLİ MEMURLAR — merkezi panel (sayfalı).
 *
 * Format (spec):  1) 👤 @Kullanıcı  /  Süre / Bitiş / Sebep
 * Bitiş Discord göreli zaman damgasıyla (<t:unix:R>) gösterilir.
 * Sebep guvenliMetin() ile sanitize edilir — mention PING oluşturmaz.
 *
 * @param {Array} rows aktif kayıtlar
 * @param {{page:number, now:number}} o
 * @returns {{embed:EmbedBuilder, toplamSayfa:number, sayfa:number}}
 */
function buildAktifPanelEmbed(rows = [], { page = 1, now = Date.now() } = {}) {
  const embed = new EmbedBuilder()
    .setColor(config.colors.mazeret)
    .setTitle('Aktif Mazeretli Memurlar')
    .setDescription('Aşağıda departman bünyesinde aktif olarak mazeretli olan kullanıcıları görebilirsiniz.');

  if (!rows.length) {
    embed.setDescription(
      'Aşağıda departman bünyesinde aktif olarak mazeretli olan kullanıcıları görebilirsiniz.\n\n' +
      'Şu anda aktif mazeretli kullanıcı bulunmuyor.'
    );
    embed.setFooter({ text: 'Panel otomatik güncellenir' });
    return { embed, toplamSayfa: 1, sayfa: 1 };
  }

  // Discord embed açıklaması sınırı 4096. Sığmayan kayıt yeni sayfaya TAŞINIR
  // (kesilmez — hiçbir aktif kayıt sessizce kaybolmaz).
  const LIM = 3800;
  const blok = (r, no) =>
    `**${no}) 👤** <@${r.user_id}>\n` +
    `     ├ **Süre:** ${sureMetni(r.duration_ms)}\n` +
    `     ├ **Bitiş:** <t:${Math.floor(r.expires_at / 1000)}:R> (${ts(r.expires_at)})\n` +
    `     └ **Sebep:** ${guvenliMetin(r.reason, 300)}`;

  const sayfalar = [];
  let cur = [];
  let len = 0;
  rows.forEach((r, i) => {
    const b = blok(r, i + 1);
    if (len + b.length > LIM && cur.length) {
      sayfalar.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(b);
    len += b.length + 2;
  });
  if (cur.length) sayfalar.push(cur);

  const toplamSayfa = sayfalar.length;
  const p = Math.min(Math.max(1, Number(page) || 1), toplamSayfa);

  embed.setDescription(
    'Aşağıda departman bünyesinde aktif olarak mazeretli olan kullanıcıları görebilirsiniz.\n\n' +
    sayfalar[p - 1].join('\n\n')
  );

  embed.setFooter({
    text:
      `Aktif: ${rows.length} kişi · Sayfa ${p}/${toplamSayfa} · ` +
      `Son güncelleme ${new Date(now).toLocaleString('tr-TR')}`,
  });
  return { embed, toplamSayfa, sayfa: p };
}

/** Sayfalama butonları (tek sayfada ise boş döner). */
function buildSayfalamaRow(page = 1, pageCount = 1) {
  if (pageCount <= 1) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mz_onceki')
      .setLabel('Önceki')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⬅️')
      .setDisabled(page <= 1),
    new ButtonBuilder().setCustomId('mz_sayfa').setLabel(`${page} / ${pageCount}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder()
      .setCustomId('mz_sonraki')
      .setLabel('Sonraki')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('➡️')
      .setDisabled(page >= pageCount),
  );
}

module.exports = {
  SURELER,
  sureBul,
  sureMetni,
  kalanEtiket,
  guvenliMetin,
  ts,
  buildPanelEmbed,
  buildBildirRow,
  buildSureSelectRow,
  buildSureSecildiEmbed,
  buildSebepModal,
  buildKayitOnayEmbed,
  buildAktifPanelEmbed,
  buildSayfalamaRow,
};