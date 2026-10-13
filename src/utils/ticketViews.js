/**
 * YENİ ticket sistemi — görünümler (embed + buton satırları).
 *
 * ESKİ `src/utils/ticketEmbeds.js` silindi; bu dosya onun yerine geçer.
 * Panelde SADECE 3 seçenek vardır: 📝 Başvuru / 📢 Şikayet / 📩 Diğer.
 */
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
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
    // Kapatma ikiye ayrıldı: yetkili kendi kararı, oyuncu sadece kendi ticketını.
    KAPAT_YETKILI: 'tk_kapat_yetkili',
    KAPAT_OYUNCU: 'tk_kapat_oyuncu',
    VIDEO_YUKLE: 'tk_video_yukle',
  // Ana paneldeki kategori secim menusu (dropdown).
  AC_KATEGORI: 'tk_ac_kategori',
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

/** Paneldeki kategori seçim menüsü seçenekleri. `value` doğrudan ticket türüdür. */
const KATEGORI_SECENEKLERI = [
  { value: 'basvuru', label: 'Başvuru', emoji: '📝', description: 'Sunucuya başvurmak / üyelik için' },
  { value: 'sikayet', label: 'Şikayet', emoji: '📢', description: 'Sorun, haksızlık veya şikâyet bildirmek için' },
  { value: 'diger', label: 'Diğer', emoji: '📩', description: 'Yukarıdakiler dışındaki her konu için' },
];

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
 * Ana panel — iki satır: "Kurallar" bağlantısı + kategori seçim menüsü.
 * (Eski 3 butonlu düzen örnek görsele göre seçim menüsüne çevrildi.)
 *
 * @param {{guildName?:string|null, imageUrl?:string|null, iconUrl?:string|null, rulesUrl?:string|null}} opts
 * @returns {{embed: EmbedBuilder, rows: ActionRowBuilder[]}}
 */
function buildMainPanel({ guildName = null, imageUrl = null, iconUrl = null, rulesUrl = null } = {}) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📌 ${guildName || 'Ticket Sistemi'}`)
    .setDescription(
      '✦ **Ticket Sistemi Hakkında:**\n' +
        'Aşağıdaki seçeneklerden uygun olanı seçerek hemen bir ticket oluşturabilirsiniz.\n\n' +
        '👉 **Bildiğiniz:**\n' +
        '⚠️ Sunucu kurallarımızı okumayı unutmayınız!',
    );

  // Sağ üstte sunucu arması (örnek düzende olduğu gibi).
  if (iconUrl) embed.setThumbnail(iconUrl);

  // Banner embed’in İÇİNDE; mesaja attachment olarak eklenir.
  if (imageUrl) embed.setImage(imageUrl);

  return { embed, rows: buildMainPanelRows({ rulesUrl }) };
}

/**
 * Panel bileşenleri: "Kurallar" linki (rulesUrl varsa) + kategori seçim menüsü.
 * rulesUrl yoksa link satırı hiç eklenmez — menü her zaman ilk sıradadır.
 *
 * @param {{rulesUrl?:string|null}} opts
 * @returns {ActionRowBuilder[]}
 */
function buildMainPanelRows({ rulesUrl = null } = {}) {
  const rows = [];

  if (rulesUrl) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Kurallar').setStyle(ButtonStyle.Link).setURL(rulesUrl).setEmoji('📖'),
      ),
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CID.AC_KATEGORI)
        .setPlaceholder('TICKET OLUŞTURMAK İÇİN KATEGORİ SEÇİNİZ')
        .addOptions(
          KATEGORI_SECENEKLERI.map((o) => ({
            label: o.label,
            value: o.value,
            description: o.description,
            emoji: o.emoji,
          })),
        ),
    ),
  );

  return rows;
}

/* ------------------------------------------------------------------ */
/* 2) TICKET KANALI EMBED'İ                                           */
/* ------------------------------------------------------------------ */

/** Paneldeki ince ayırıcı (Discord yatay çizgi desteklemez). */
const AYRA = '\n────────────────────────────\n';

/**
 * Durum metni — "Destek Durumu" kutusunda gösterilir.
 * Sahiplenildiyse yetkili adı yazılır; hiçbir zaman tahmin edilmez.
 * @param {{status:string, claimedBy?:string|null}} p
 * @returns {string}
 */
function durumMetni(p) {
  if (p.status === 'closed') return 'Bu ticket kapatıldı.';
  if (p.status === 'rejected') return 'Talebiniz reddedildi.';
  if (p.status === 'accepted') return 'Talebiniz kabul edildi. 🎉';
  if (p.claimedBy) return `<@${p.claimedBy}> talebinizi inceliyor.`;
  return 'Yetkili bekleniyor...';
}

/**
 * Ortalama yanıt süresini okunur biçime çevirir.
 * VERİ YOKSA null döner — ölçülmemiş bir süre UYDURULMAZ.
 * @param {number|null} ms
 * @returns {string|null}
 */
function sureMetni(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} saniye`;
  const dk = Math.round(s / 60);
  if (dk < 60) return `${dk} dakika`;
  return `${Math.round(dk / 60)} saat`;
}

/**
 * Ticket açılış mesajı — örnek düzen.
 *
 * Düzen: başlık (tür + numara) → sağ üst arma → açılış cümlesi →
 * "Destek bilgileri" (ID / kategori / ortalama yanıt) → "Destek Durumu".
 *
 * @param {object} p
 * @param {'basvuru'|'sikayet'|'diger'} p.kind
 * @param {string} p.ownerId
 * @param {string} [p.ownerTag]
 * @param {string} [p.ownerAvatarUrl] sağ üstteki arma
 * @param {number|string} [p.ticketId] "Destek ID"de gösterilen numara
 * @param {number} [p.createdAt] açılış zamanı (ms)
 * @param {number|null} [p.avgResponseMs] ortalama ilk yanıt (ms)
 * @param {'open'|'accepted'|'rejected'|'closed'} [p.status]
 * @param {string|null} [p.claimedBy]
 * @param {number|null} [p.claimedAt]
 * @param {string|null} [p.actorId]
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

  // Örnekteki biçim: "<emoji> <Tür> Talebi #<id>". Numara yoksa atlanır.
  const no = p.ticketId === undefined || p.ticketId === null ? null : String(p.ticketId).trim();
  const baslik = `${k.emoji} ${k.label} Talebi${no ? ` #${no}` : ''}`;

  const embed = new EmbedBuilder().setColor(st.color).setTitle(baslik);

  // Sağ üstte açan kişinin arması (örnekteki kare görsel).
  if (p.ownerAvatarUrl) embed.setThumbnail(p.ownerAvatarUrl);

  const zaman =
    Number.isFinite(Number(p.createdAt)) && Number(p.createdAt) > 0
      ? ` <t:${Math.floor(Number(p.createdAt) / 1000)}:F> tarihinde`
      : '';
  const ort = sureMetni(p.avgResponseMs);

  embed.setDescription(
    `<@${p.ownerId}> tarafından ${k.label} talebi${zaman} oluşturuldu. ` +
      'Yetkililer size ile ilgilenecektir.' +
      AYRA +
      '**Destek bilgileri**\n' +
      `🔹 **Destek ID** ${no ? `#${no}` : '—'}\n` +
      `#️⃣ **Destek Kategorisi** **${k.label}**\n` +
      `⏱ **Ortalama Yanıt Süresi** ${ort ? `\`${ort}\`` : '*henüz veri yok*'}` +
      AYRA +
      '**Destek Durumu**\n' +
      `\`\`\`${durumMetni({ status, claimedBy: p.claimedBy })}\`\`\``,
  );

  // --- Örnekte olmayan ama SİLİNMEYECEK ek bilgiler ---
  if (p.claimedBy) {
    embed.addFields({
      name: '🙋 Ticket Sahibi Yetkili',
      value:
        `Yetkili: <@${p.claimedBy}>\n` +
        'Durum: Sahiplenildi' +
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

  embed.setFooter({ text: `Ticket #${no || '-'} · Durum: ${st.text}` });
  return embed;
}

/**
 * Ticket kanalındaki buton satırları.
 *
 * Satır 1: 👤 Yetkili - Sahiplen · (Başvuru ise) ✅ Kabul · ❌ Reddet
 * Satır 2: 💻 Yetkili - Kapat · 🔴 Oyuncu - Kapat · 🎥 Video Yükle
 *
 * Kapatma ikiye ayrıldı: yetkili kendi kararıyla, oyuncu sadece kendi
 * ticketını. İkisi de aynı kapanış akışını çalıştırır (handleClose).
 *
 * @param {string} kind
 * @param {'open'|'accepted'|'rejected'|'closed'} status
 * @param {{claimedBy?:string|null}} [o]
 * @returns {ActionRowBuilder[]}
 */
function buildTicketRows(kind, status = 'open', o = {}) {
  const k = kindOf(kind);
  const kapali = status === 'closed';

  // Kapalı ticketta satır yalnızca kapanış bilgisine düşer.
  if (kapali) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CID.KAPAT)
          .setLabel('Kapat')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🔒')
          .setDisabled(true),
      ),
    ];
  }

  const ana = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CID.SAHIPLEN)
      .setLabel('Yetkili - Sahiplen')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('👤'),
  );

  if (k.onaylanabilir && status === 'open') {
    ana.addComponents(
      new ButtonBuilder().setCustomId(CID.KABUL).setLabel('Kabul Et').setStyle(ButtonStyle.Success).setEmoji('✅'),
      new ButtonBuilder().setCustomId(CID.REDDET).setLabel('Reddet').setStyle(ButtonStyle.Danger).setEmoji('❌'),
    );
  }

  const alt = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CID.KAPAT_YETKILI)
      .setLabel('Yetkili - Kapat')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('💻'),
    new ButtonBuilder()
      .setCustomId(CID.KAPAT_OYUNCU)
      .setLabel('Oyuncu - Kapat')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔴'),
    new ButtonBuilder()
      .setCustomId(CID.VIDEO_YUKLE)
      .setLabel('Video Yükle')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🎥'),
  );

  return [ana, alt];
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
    buildMainPanelRows,
  KATEGORI_SECENEKLERI,
  buildTicketEmbed,
  buildTicketRows,
  durumMetni,
  sureMetni,
  buildSahiplenmeEmbed,
};
