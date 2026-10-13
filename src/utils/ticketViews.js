/**
 * YENİ ticket sistemi — görünümler (embed + buton satırları).
 *
 * ESKİ `src/utils/ticketEmbeds.js` silindi; bu dosya onun yerine geçer.
 * Panelde SADECE 3 seçenek vardır: 📝 Başvuru / 📢 Şikayet / 📩 Diğer.
 */
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');

/** Tüm ticket butonlarının customId'leri tek yerden. */
const CID = {
  OPEN_BASVURU: 'tk_ac_basvuru',
  OPEN_SIKAYET: 'tk_ac_sikayet',
  OPEN_DIGER: 'tk_ac_diger',
  KABUL: 'tk_kabul',
  REDDET: 'tk_reddet',
  KAPAT: 'tk_kapat',
  SAHIPLEN: 'tk_sahiplen',
};

/** Panel butonlarının customId → ticket türü eşlemesi. */
const OPEN_KIND = {
  [CID.OPEN_BASVURU]: 'basvuru',
  [CID.OPEN_SIKAYET]: 'sikayet',
  [CID.OPEN_DIGER]: 'diger',
};

/** Ticket türü görünümleri. */
const KIND = {
  basvuru: { label: 'Başvuru', emoji: '📝', color: 0x5865f2, onaylanabilir: true },
  sikayet: { label: 'Şikayet', emoji: '📢', color: 0xe67e22, onaylanabilir: false },
  diger: { label: 'Diğer', emoji: '📩', color: 0x9b59b6, onaylanabilir: false },
};

const isKnownKind = (k) => Object.prototype.hasOwnProperty.call(KIND, k);

function kindOf(k) {
  return KIND[k] || KIND.diger;
}

function safe(text, max) {
  return String(text ?? '—')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max) || '—';
}

/* ------------------------------------------------------------------ */
/* 1) ANA PANEL — yalnızca /ticketkur ile gönderilir                    */
/* ------------------------------------------------------------------ */

/**
 * Ana panel. Tek mesajda üç seçenek (buton olarak).
 * @param {{ guildName?: string, imageUrl?: string|null }} opts
 */
function buildMainPanel({ guildName = null, imageUrl = null } = {}) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎫 Ticket Sistemi')
    .setDescription(
      'Merhaba! Destek, başvuru veya görüşmek istediğin bir konu için ' +
        'aşağıdaki seçeneklerden birini seçerek ticket açabilirsin.\n\n' +
        '**📝 Başvuru** — Sunucuya başvurmak / üyelik için\n' +
        '**📢 Şikayet** — Bir sorun, haksızlık veya şikâyet bildirmek için\n' +
        '**📩 Diğer** — Yukarıdakiler dışındaki her konu için',
    );

  if (imageUrl) embed.setImage(imageUrl);
  if (guildName) embed.setFooter({ text: guildName });

  return { embed, row: buildMainPanelRow() };
}

/** Ana panel buton satırı: tam olarak 3 buton. */
function buildMainPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CID.OPEN_BASVURU)
      .setLabel('Başvuru')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📝'),
    new ButtonBuilder()
      .setCustomId(CID.OPEN_SIKAYET)
      .setLabel('Şikayet')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📢'),
    new ButtonBuilder()
      .setCustomId(CID.OPEN_DIGER)
      .setLabel('Diğer')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📩'),
  );
}

/* ------------------------------------------------------------------ */
/* 2) TICKET KANALI EMBED'İ                                           */
/* ------------------------------------------------------------------ */

/**
 * Ticket açılış mesajı.
 * @param {object} p
 * @param {string} p.kind      basvuru | sikayet | diger
 * @param {string} p.ownerId
 * @param {string} p.ownerTag
 * @param {string} p.channelName
 * @param {string} [p.status]  open | accepted | rejected | closed
 * @param {string|null} [p.actorId]  kararı veren yetkili
 * @param {Array<{roleId:string, ok:boolean, note?:string}>} [p.roles]
 */
function buildTicketEmbed(p) {
  const k = kindOf(p.kind);
  const status = p.status || 'open';

  const STATUS = {
    open: { text: '🟡 AÇIK', color: k.color },
    accepted: { text: '✅ KABUL EDİLDİ', color: 0x2ecc71 },
    rejected: { text: '❌ REDDEDİLDİ', color: 0xe74c3c },
    closed: { text: '🔒 KAPATILDI', color: 0x95a5a6 },
  };
  const st = STATUS[status] || STATUS.open;

  const embed = new EmbedBuilder()
    .setColor(st.color)
    .setAuthor({
      name: `${k.emoji} ${k.label} Ticket`,
      iconURL: null,
    })
    .addFields(
      { name: 'Sahip', value: `<@${p.ownerId}>\n\`${safe(p.ownerTag, 40)}\``, inline: true },
      { name: 'Tür', value: `${k.emoji} ${k.label}`, inline: true },
      { name: 'Durum', value: st.text, inline: true },
    );

  // 🙋 Sahiplenme alanı — sahiplenildiyse her ticket görünümünde görünür.
  if (p.claimedBy) {
    embed.addFields({
      name: '🙋 Ticket Sahibi Yetkili',
      value:
        `Yetkili: <@${p.claimedBy}>\n` +
        `Durum: Sahiplenildi` +
        (p.claimedAt ? `\nSahiplenme zamanı: <t:${Math.floor(Number(p.claimedAt) / 1000)}:f>` : ''),
      inline: false,
    });
  }

  if (status === 'accepted' || status === 'rejected') {
    embed.addFields({
      name: status === 'accepted' ? 'Kabul Eden' : 'Reddeden',
      value: p.actorId ? `<@${p.actorId}>` : '—',
      inline: true,
    });
  }

  // Kabulde verilen rollerin sonucu (kısmi başarı açıkça raporlanır)
  if (Array.isArray(p.roles) && p.roles.length) {
    const okAll = p.roles.every((r) => r.ok);
    const lines = p.roles.map((r) => `${r.ok ? '✅' : '❌'} <@&${r.roleId}>${r.note ? ` — ${r.note}` : ''}`);
    embed.addFields({
      name: okAll ? '🎁 Verilen Roller' : '⚠️ Roller (KISMEN VERİLDİ)',
      value: lines.join('\n').slice(0, 1024),
      inline: false,
    });
  }

  if (status === 'open') {
    embed.setDescription(
      k.onaylanabilir
        ? 'Yetkili ekibimiz başvurunuzu inceleyecek. Sabırlı olduğunuz için teşekkürler.'
        : 'Yetkili ekibimiz en kısa sürede sizinle iletişime geçecek. Sabırlı olduğunuz için teşekkürler.',
    );
  } else if (status === 'accepted') {
    embed.setDescription('Başvurunuz kabul edildi. Tebrikler! 🎉');
  } else if (status === 'rejected') {
    embed.setDescription('Başvurunuz reddedildi. Sorunuz varsa yetkili ekibimize yazabilirsiniz.');
  } else {
    embed.setDescription('Bu ticket kapatıldı.');
  }

  embed.setFooter({ text: 'Ticket kapatmak için 🔒 Kapat butonunu kullanın.' });
  return embed;
}

/**
 * Ticket kanalındaki buton satırı.
 * Başvuru → Sahiplen / Kabul / Reddet / Kapat
 * Şikayet & Diğer → Sahiplen / Kapat
 *
 * Sahiplenme butonu HER TÜRDE vardır ve her zaman AKTİF kalır: tekrar basıldığında
 * "şu anda <@x> sahiplenmiş" bilgisi verilir (istatistik artmaz). Kapalı
 * ticket'ta satır yalnızca Kapat'a düşer.
 *
 * @param {string} kind basvuru | sikayet | diger
 * @param {string} status open | accepted | rejected | closed
 * @param {{claimedBy?:string|null}} [o]
 */
function buildTicketRow(kind, status = 'open', o = {}) {
  const k = kindOf(kind);
  const row = new ActionRowBuilder();
  const kapali = status === 'closed';

  if (!kapali) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(CID.SAHIPLEN)
        .setLabel('Ticketi Sahiplen')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🙋'),
    );
  }

  if (k.onaylanabilir && status === 'open') {
    row.addComponents(
      new ButtonBuilder().setCustomId(CID.KABUL).setLabel('Kabul Et').setStyle(ButtonStyle.Success).setEmoji('✅'),
      new ButtonBuilder().setCustomId(CID.REDDET).setLabel('Reddet').setStyle(ButtonStyle.Danger).setEmoji('❌'),
    );
  }

  row.addComponents(
    new ButtonBuilder().setCustomId(CID.KAPAT).setLabel('Kapat').setStyle(ButtonStyle.Secondary).setEmoji('🔒'),
  );
  return row;
}

/**
 * Sahiplenme sonrası kanalda gönderilen profesyonel embed.
 * @param {{claimerId:string, kind:string, at:number, ownerId?:string}} p
 */
function buildSahiplenmeEmbed(p) {
  const k = kindOf(p.kind);
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🙋 Ticket Sahiplenildi')
    .addFields(
      { name: 'Sahiplenen Yetkili', value: `<@${p.claimerId}>\n\`${p.claimerId}\``, inline: true },
      { name: 'Ticket Türü', value: `${k.emoji} ${k.label}`, inline: true },
      {
        name: 'Sahiplenme Zamanı',
        value: `<t:${Math.floor(Number(p.at) / 1000)}:f> (<t:${Math.floor(Number(p.at) / 1000)}:R>)`,
        inline: true,
      },
    )
    .setFooter({ text: 'Bu ticket artık sahiplenen yetkili tarafından takip ediliyor.' })
    .setTimestamp(Number(p.at));
}

module.exports = {
  CID,
  OPEN_KIND,
  KIND,
  isKnownKind,
  kindOf,
  buildMainPanel,
  buildMainPanelRow,
  buildTicketEmbed,
  buildTicketRow,
  buildSahiplenmeEmbed,
};
