/**
 * YENİ ticket sistemi — tek ve temiz ticket akışı.
 *
 * ESKİ `src/handlers/ticketHandler.js` (67 KB, sahiplenme/kullanıcı ekleme/
 * yetkili çağırma/transcript/başvuru formu/panel onarımı...) SİLİNDİ.
 * Burada yalnızca tarif edilen akış var:
 *
 *   Panel butonu (tk_ac_*)  -> kanal aç, kaydet, etiketle
 *   tk_kabul                -> iki rolü ver, doğrula, durum=güncelle
 *   tk_reddet               -> <@user> başvurunuz reddedildi., durum=rejected
 *   tk_kapat                -> "5 saniye içinde siliniyor", 5sn, SADECE o kanal
 *
 * ÖNEMLİ: Panel otomatik gönderilmez. Tek yol `/ticketkur`.
 */
const {
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { canManageTickets } = require('../utils/permissions');
const { buildErrorEmbed, buildSuccessEmbed } = require('../utils/embeds');
const { CID, OPEN_KIND, isKnownKind, kindOf, buildMainPanel, buildTicketEmbed, buildTicketRow } = require('../utils/ticketViews');
const {
  createTicketSession,
  getTicketByChannel,
  getOpenTicketByUser,
  getSetting,
  setTicketChannel,
  setTicketStatus,
  endTicketSession,
  upsertTicketPanel,
  getTicketPanel,
  deleteTicketPanel,
} = require('../database/database');

const EPH = (extra = {}) => ({ flags: MessageFlags.Ephemeral, ...extra });

/** Panel görseli — repoya gömülü (Railway gibi uzak çalışmalarda da hazır). */
const PANEL_GORSEL_DOSYA = path.join(__dirname, '..', '..', 'assets', 'ticket-panel.png');
const PANEL_GORSEL_ADI = 'ticket-panel.png';

/** Silme zamanlayıcıları: aynı kanal için birden fazla görev çalışmasın. */
const silmeZamanlayici = new Map();

/* ================================================================== */
/* Panel                                                              */
/* ================================================================== */

/**
 * Ana paneli gönderir.
 * @param {Client} client
 * @param {Guild} guild
 * @param {ObjectChannel} kanal
 * @returns {Promise<{ok:boolean, action:string, messageId?:string}>}
 */
async function sendMainPanel(client, guild, kanal) {
  const res = { ok: false, action: 'bilinmiyor', gorsel: 'yok' };
  try {
    const gorsel = panelGorseli();

    // Duplicate engeli: aynı kanalda canlı bir panel varsa YENİSİ GÖNDERİLMEZ.
    const kayit = getTicketPanel(guild.id);
    if (kayit && kayit.channel_id === kanal.id) {
      const mevcut = await kanal.messages.fetch(kayit.message_id).catch(() => null);
      if (mevcut) {
        // Düzenlemede dosya EKLENEMEZ; o mesajın kendi görseli korunur.
        const mevcutUrl = mevcut.embeds?.[0]?.image?.url || null;
        const { embed, row } = buildMainPanel({
          guildName: guild.name,
          imageUrl: gorsel.kaynak === 'url' ? gorsel.url : mevcutUrl,
        });
        await mevcut.edit({ embeds: [embed], components: [row] });
        res.gorsel = embed.data.image?.url ? 'korundu' : 'yok';
        res.ok = true;
        res.action = 'guncellendi';
        res.messageId = mevcut.id;
        return res;
      }
      deleteTicketPanel(guild.id);
    }

    // Yeni panel: görsel panel mesajının KENDİSİne ek olarak yüklenir.
    let imageUrl = null;
    const files = [];
    if (gorsel.kaynak === 'dosya') {
      imageUrl = `attachment://${PANEL_GORSEL_ADI}`;
      files.push(fs.createReadStream(gorsel.yol));
      res.gorsel = 'dosya (mesaja ekleniyor)';
    } else if (gorsel.kaynak === 'url') {
      imageUrl = gorsel.url;
      res.gorsel = 'url';
    }

    const { embed, row } = buildMainPanel({ guildName: guild.name, imageUrl });
    const msg = await kanal.send({
      embeds: [embed],
      components: [row],
      ...(files.length ? { files } : {}),
    });
    upsertTicketPanel(guild.id, kanal.id, msg.id);
    res.ok = true;
    res.action = 'gonderildi';
    res.messageId = msg.id;
    return res;
  } catch (err) {
    res.action = 'hata';
    logger.error(`Ticket paneli gönderilemedi (#${kanal?.name || '?'}):`, err);
    return res;
  }
}

/**
 * Panel görseli kaynağını seçer.
 *  - kaynak: dosya -> panel mesajına ek olarak yüklenecek (en sağlam)
 *  - kaynak: url   -> kayıtlı CDN adresi (dosya yoksa son çare)
 *  - kaynak: yok   -> göselsiz panel
 */
function panelGorseli() {
  if (fs.existsSync(PANEL_GORSEL_DOSYA)) {
    return { kaynak: 'dosya', yol: PANEL_GORSEL_DOSYA };
  }
  let url = null;
  try {
    url = getSetting('ticket_panel_image') || null;
  } catch (err) {
    logger.warn(`Panel görseli ayarı okunamadı: ${err.message}`);
  }
  return url ? { kaynak: 'url', url } : { kaynak: 'yok' };
}

/* ================================================================== */
/* Kategori doğrulama                                                  */
/* ================================================================== */

/**
 * Ticket kategorisini doğrular. Kategori yoksa/yetki yoksa ticket AÇILMAZ —
 * yanlış yere düşmesine izin verilmez.
 * @returns {Promise<{ok:boolean, parent?:Object|null, reason?:string}>}
 */
async function resolveTicketCategory(guild) {
  const HAM_ID = process.env.TICKET_CATEGORY_ID || config.ticket.categoryId || null;
  const id = HAM_ID ? String(HAM_ID).trim() : null;

  // 1) Yapılandırılmamış
  if (!id) {
    logger.error('[ticket] Kategori ID yapılandırılmamış (config.ticket.categoryId boş).');
    return { ok: false, reason: 'yapilandirilma' };
  }

  // 2) Geçersiz biçim (snowflake değil) — sessizce başka yere açmayız.
  if (!/^\d{17,20}$/.test(id)) {
    logger.error(`[ticket] Kategori ID geçersiz biçimde: '${id}' (beklenen 17-20 haneli snowflake).`);
    return { ok: false, reason: 'gecersiz_id' };
  }

  // 3) Kanal sunucudan çekilir (cache tek başına yeterli değildir).
  let parent = null;
  try {
    parent = await guild.channels.fetch(id);
  } catch (err) {
    const kod = err?.code || err?.status || 'bilinmiyor';
    logger.error(`[ticket] Kategori getirilemedi (guild ${guild?.id}, id ${id}): kod=${kod} ${err?.message}`);
    if (err?.code === 10003 || kod === 404 || kod === '404') {
      return { ok: false, reason: 'kategori_yok' };
    }
    return { ok: false, reason: 'api_hatasi', detail: String(kod) };
  }

  if (!parent) {
    logger.error(`[ticket] Kategori getirildi ama boş (guild ${guild?.id}, id ${id}).`);
    return { ok: false, reason: 'kategori_yok' };
  }

  // 4) Doğru sunucuya ait mi? (çapraz sunucu ID kullanımı sessizce geçmemeli)
  if (parent.guildId && String(parent.guildId) !== String(guild?.id)) {
    logger.error(`[ticket] Kategori farklı sunucuya ait: bulunan=${parent.guildId}, beklenen=${guild?.id}`);
    return { ok: false, reason: 'yanlis_sunucu' };
  }

  // 5) Gerçekten kategori kanalı mı?
  if (parent.type !== ChannelType.GuildCategory) {
    logger.error(`[ticket] Kanal bir kategori değil: id=${id}, type=${parent.type} (beklenen GuildCategory=${ChannelType.GuildCategory}).`);
    return { ok: false, reason: 'kategori_degil' };
  }

  // 6) Bot kanal açabilir mi?
  const me = guild?.members?.me;
  const perms = me ? parent.permissionsFor?.(me) : null;
  if (!perms?.has(PermissionFlagsBits.ManageChannels)) {
    logger.error(`[ticket] Bot kategoride Kanalları Yönet yetkisine sahip değil (guild ${guild?.id}, kategori ${id}).`);
    return { ok: false, reason: 'yetki_yok' };
  }

  return { ok: true, parent };
}

/** Sebep → kullanıcıya gösterilecek açıklama (teknik detay loga gider, buraya değil). */
const KATEGORI_HATASI = {
  yapilandirilma: 'Ticket kategorisi yapılandırılmamış. Yöneticinize bildirin.',
  gecersiz_id: 'Ticket kategorisi kimliği geçersiz. Yöneticinize bildirin.',
  kategori_yok: 'Ticket kategorisi bulunamadı. Yöneticinize bildirin.',
  kategori_degil: 'Ayarlanan kanal bir kategori değil. Yöneticinize bildirin.',
  yanlis_sunucu: 'Ticket kategorisi farklı bir sunucuya ait. Yöneticinize bildirin.',
  yetki_yok: 'Bot ticket kategorisinde kanal açma yetkisine sahip değil. Yöneticinize bildirin.',
  api_hatasi: 'Discord API hatası oluştu. Lütfen tekrar deneyin.',
};

/* ================================================================== */
/* Ticket açma                                                        */
/* ================================================================== */

/**
 * Panel butonu → ticket kanalı oluştur.
 * @param {Interaction} interaction
 * @param {'basvuru'|'sikayet'|'diger'} kind
 */
async function handleOpenButton(interaction, kind) {
  const guild = interaction.guild;
  if (!guild) return true;

  // 1) Etkileşimi hemen kapat ki Discord 3sn kuralı aşılmasın.
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    logger.error(`[ticket ${kind}] deferReply başarısız: ${err.code || ''} ${err.message}`);
    return true;
  }

  // 2) Kategori — yoksa BURADA DUR, yanlış yere açma.
  const cat = await resolveTicketCategory(guild);
  if (!cat.ok) {
    logger.error(`Ticket açılamadı (${cat.reason}) — guild ${guild.id}`);
    return safeEdit(interaction, {
      embeds: [buildErrorEmbed(KATEGORI_HATASI[cat.reason] || 'Ticket açılamadı.')],
    });
  }

  // 3) Kullanıcı başına tek açık ticket
  const acik = getOpenTicketByUser(guild.id, interaction.user.id);
  if (acik) {
    return safeEdit(interaction, {
      embeds: [buildErrorEmbed(`Zaten açık bir ticketınız var: <#${acik.channel_id}>.`)],
    });
  }

  // 4) Kanal oluştur (veritabanına ÖNCE yazılır; kanal açılamazsa kayıt silinir)
  const ticket = createTicketSession({
    guildId: guild.id,
    ownerId: interaction.user.id,
    kind,
  });
  if (!ticket || !ticket.id) {
    return safeEdit(interaction, { embeds: [buildErrorEmbed('Ticket kaydı oluşturulamadı.')] });
  }

  const k = kindOf(kind);
  const channelName = `ticket-${String(interaction.user.username).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)}`;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: interaction.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];
  // Yetkili rolü (projenin mevcut yetki yapısı)
  for (const roleId of config.ticket.staffRoleIds || []) {
    if (!/^\d{17,20}$/.test(String(roleId))) continue;
    overwrites.push({
      id: String(roleId),
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  let channel;
  try {
    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: cat.parent.id, // ← TEK KATEGORİ, her tür için
      topic: `${k.emoji} ${k.label} • Sahip: ${interaction.user.tag}`,
      permissionOverwrites: overwrites,
    });
  } catch (err) {
    endTicketSession(ticket.id, { reason: 'channel_failed' });
    logger.error(`Ticket kanalı açılamadı: ${err.code || err.message}`);
    const msg =
      err?.code === 50013
        ? 'Ticket kanalı oluşturamadım — bota **Kanalları Yönet** yetkisi verin.'
        : 'Ticket kanalı oluşturulurken bir hata oluştu. Lütfen tekrar deneyin.';
    return safeEdit(interaction, { embeds: [buildErrorEmbed(msg)] });
  }

  // Kanal gerçekten doğru kategoride mi? (Discord parent'ı yok sayabilir)
  if (String(channel.parentId) !== String(cat.parent.id)) {
    await channel.delete('yanlış kategoride açıldı').catch(() => {});
    endTicketSession(ticket.id, { reason: 'wrong_parent' });
    logger.error(`Ticket kanalı yanlış kategoride açıldı (silindi): beklenen ${cat.parent.id}, gelen ${channel.parentId}`);
    return safeEdit(interaction, { embeds: [buildErrorEmbed('Ticket kanalı doğru kategoride açılamadı.')] });
  }

  setTicketChannel(ticket.id, channel.id);

  // 5) Karşılama mesajı — sahip + yetkili rolü etiketlenir (TEK SEFER, sadece burada)
  const pingRole = config.ticket.pingRoleId;
  const content = `<@${interaction.user.id}>${pingRole ? ` <@&${pingRole}>` : ''}`;
  const allowedMentions = { users: [interaction.user.id], ...(pingRole ? { roles: [pingRole] } : {}) };

  try {
    await channel.send({
      content,
      allowedMentions,
      embeds: [
        buildTicketEmbed({
          kind,
          ownerId: interaction.user.id,
          ownerTag: interaction.user.tag,
          status: 'open',
        }),
      ],
      components: [buildTicketRow(kind, 'open')],
    });
  } catch (err) {
    await channel.delete('karşılama mesajı gönderilemedi').catch(() => {});
    endTicketSession(ticket.id, { reason: 'welcome_failed' });
    logger.error(`Ticket karşılama mesajı gönderilemedi: ${err.code || err.message}`);
    return safeEdit(interaction, { embeds: [buildErrorEmbed('Ticket oluşturulamadı. Lütfen tekrar deneyin.')] });
  }

  logger.success(`Ticket açıldı: ${kind} • <#${channel.id}> • ${interaction.user.tag}`);
  return safeEdit(interaction, { content: `✅ **${k.emoji} ${k.label}** ticket'ınız açıldı: <#${channel.id}>` });
}

/* ================================================================== */
/* Ticket butonları                                                   */
/* ================================================================== */

/** @param {Interaction} interaction */
async function handleTicketButton(interaction) {
  const { customId } = interaction;
  if (customId === CID.KABUL) return handleAccept(interaction);
  if (customId === CID.REDDET) return handleReject(interaction);
  if (customId === CID.KAPAT) return handleClose(interaction);
  return false;
}

/** Yetkili mi? (ticket sahibi değil) */
function staffOnly(member) {
  return canManageTickets(member);
}

/** DB'den ticket'ı çöz — kanal adına veya kullanıcı girdisine GÜVENİLMEZ. */
function ticketFromChannel(interaction) {
  const id = interaction.channelId;
  if (!id) return null;
  return getTicketByChannel(id);
}

async function safeEdit(interaction, payload) {
  try {
    return await interaction.editReply(payload);
  } catch (err) {
    if (err?.code === 10062) return null;
    logger.warn(`Yanıt gönderilemedi: ${err.code || err.message}`);
    return null;
  }
}

async function safeUpdate(interaction, payload) {
  try {
    return await interaction.update(payload);
  } catch (err) {
    // Etkileşim Discord tarafında düştüyse (10062) veya zaten yanıtlandıysa (40060)
    // aynı içeriği editReply ile göndermeyi dener.
    if (err?.code === 10062 || err?.code === 40060) {
      try {
        return await interaction.editReply(payload);
      } catch (alt) {
        // Hata GİZLENMEZ: kullanıcı neden yanıt alamadığını loglardan görebilmeli.
        logger.warn(
          `Etkileşim yanıtı düşürüldü (${err.code}) ve editReply de başarısız ` +
            `(${alt.code || 'bilinmiyor'} ${alt.message}) — kullanıcı mesaj göremeyecek.`,
        );
        return null;
      }
    }
    logger.warn(`Mesaj güncellenemedi: ${err.code || err.message}`);
    return null;
  }
}

/* ---------------- Kabul Et ---------------- */
async function handleAccept(interaction) {
  const ticket = ticketFromChannel(interaction);
  if (!ticket) return safeReplyGone(interaction);
  if (ticket.status !== 'open') {
    return safeEdit(interaction, { content: `ℹ️ Bu ticket zaten **${durumAdi(ticket.status)}**.` });
  }
  if (!staffOnly(interaction.member)) {
    return safeEdit(interaction, { content: '⛔ Bu işlem için yetkili olmalısınız.' });
  }

  await interaction.deferUpdate().catch(() => {});

  const guild = interaction.guild;
  const ownerId = ticket.owner_id; // ← DB'den, güvenilir
  const owner = await guild?.members?.fetch?.(ownerId).catch(() => null);
  if (!owner) {
    return safeUpdate(interaction, {
      embeds: [
        buildTicketEmbed({ kind: ticket.kind, ownerId, ownerTag: '-', status: 'open' }),
        buildErrorEmbed('Başvuru sahibi sunucuda bulunamadı — roller verilemedi.'),
      ],
      components: [buildTicketRow(ticket.kind, 'open')],
    });
  }

  // Rol hiyerarşisi kontrolü: bot her iki rolün de üstünde olmalı
  const roleIds = config.ticket.acceptRoleIds || [];
  const botTop = guild.members.me?.roles.highest.position ?? 0;
  const canManageRoles = guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles);

  const sonuclar = [];
  for (const roleId of roleIds) {
    if (!/^\d{17,20}$/.test(String(roleId))) {
      sonuclar.push({ roleId, ok: false, note: 'geçersiz rol ID' });
      continue;
    }
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      sonuclar.push({ roleId, ok: false, note: 'rol bulunamadı' });
      continue;
    }
    if (!canManageRoles) {
      sonuclar.push({ roleId, ok: false, note: 'botta Rolleri Yönet yok' });
      continue;
    }
    if (role.position >= botTop) {
      sonuclar.push({ roleId, ok: false, note: 'bot rolünün altında' });
      continue;
    }
    // discord.js v14: member.roles doğrudan Collection'dır (.cache YOK).
    // v13 uyumluluğu için ikisine de bakılır.
    const zatenVar =
      owner.roles?.cache?.has?.(roleId) === true || owner.roles?.has?.(roleId) === true;
    if (zatenVar) {
      sonuclar.push({ roleId, ok: true, note: 'zaten vardı' });
      continue;
    }
    try {
      await owner.roles.add(roleId, `Başvuru kabulü (ticket #${ticket.id}, ${interaction.user.tag})`);
      sonuclar.push({ roleId, ok: true });
    } catch (err) {
      sonuclar.push({ roleId, ok: false, note: `Discord hatası (${err.code || 'bilinmiyor'})` });
      logger.warn(`Rol verilemedi ${roleId}: ${err.code || err.message}`);
    }
  }

  // GERÇEKTEN ikisi de verildiyse "kabul edildi" denir; kısmi ise açıkça raporlanır
  const tamam = sonuclar.length > 0 && sonuclar.every((r) => r.ok);
  const basarisiz = sonuclar.filter((r) => !r.ok);

  if (tamam) {
    setTicketStatus(ticket.id, 'accepted', { actorId: interaction.user.id });
  }

  const embed = buildTicketEmbed({
    kind: ticket.kind,
    ownerId,
    ownerTag: owner.user.tag,
    status: tamam ? 'accepted' : 'open',
    actorId: tamam ? interaction.user.id : null,
    roles: sonuclar,
  });

  await interaction.channel
    .send({
      embeds: [embed],
      components: [buildTicketRow(ticket.kind, tamam ? 'accepted' : 'open')],
    })
    .catch(() => {});
  await safeUpdate(interaction, { embeds: [], components: [] }).catch(() => {});

  if (tamam) {
    logger.success(`Başvuru #${ticket.id} kabul edildi (${interaction.user.tag}) — ${roleIds.length} rol verildi`);
    await interaction.channel.send({
      content: `✅ <@${ownerId}> başvurunuz kabul edildi. Tebrikler! 🎉`,
    }).catch(() => {});
  } else {
    const detay = basarisiz.map((r) => `<@&${r.roleId}> (${r.note})`).join(', ');
    logger.error(`Başvuru #${ticket.id} kabulü KISMEN başarısız: ${detay}`);
    await interaction.channel.send({
      content:
        `⚠️ <@${ownerId}> başvurunuz kabul edildi **ancak bazı roller verilemedi**.\n` +
        `Başarısız: ${detay}\nYetkili ekibimize yazın, elle verelim.`,
    }).catch(() => {});
  }
  return true;
}

/* ---------------- Reddet ---------------- */
async function handleReject(interaction) {
  const ticket = ticketFromChannel(interaction);
  if (!ticket) return safeReplyGone(interaction);
  // Yalnızca BAŞVURU türünde çalışır
  if (ticket.kind !== 'basvuru') {
    return safeEdit(interaction, { content: '⛔ Bu işlem yalnızca Başvuru türündeki ticketlarda çalışır.' });
  }
  if (ticket.status !== 'open') {
    return safeEdit(interaction, { content: `ℹ️ Bu ticket zaten **${durumAdi(ticket.status)}**.` });
  }
  if (!staffOnly(interaction.member)) {
    return safeEdit(interaction, { content: '⛔ Bu işlem için yetkili olmalısınız.' });
  }

  await interaction.deferUpdate().catch(() => {});
  setTicketStatus(ticket.id, 'rejected', { actorId: interaction.user.id });

  const owner = await interaction.guild?.members?.fetch?.(ticket.owner_id).catch(() => null);
  const embed = buildTicketEmbed({
    kind: ticket.kind,
    ownerId: ticket.owner_id,
    ownerTag: owner?.user?.tag || '-',
    status: 'rejected',
    actorId: interaction.user.id,
  });

  await interaction.channel
    .send({
      content: `<@${ticket.owner_id}> başvurunuz reddedildi.`,
      allowedMentions: { users: [ticket.owner_id] },
      embeds: [embed],
      components: [buildTicketRow(ticket.kind, 'rejected')],
    })
    .catch(() => {});
  await safeUpdate(interaction, { embeds: [], components: [] }).catch(() => {});

  logger.success(`Başvuru #${ticket.id} reddedildi (${interaction.user.tag})`);
  return true;
}

/* ---------------- Kapat ---------------- */
async function handleClose(interaction) {
  const ticket = ticketFromChannel(interaction);
  if (!ticket) return safeReplyGone(interaction);
  if (ticket.status === 'closed') {
    return safeEdit(interaction, { content: '🔒 Bu ticket zaten kapatılmış.' });
  }

  // Yetkili VEYA sahibi — başkası kapatamaz
  const isOwner = String(ticket.owner_id) === String(interaction.user.id);
  if (!isOwner && !staffOnly(interaction.member)) {
    return safeEdit(interaction, { content: '⛔ Bu ticket yalnızca sahibi veya yetkililer tarafından kapatılabilir.' });
  }

  // Aynı kanal için ikinci bir silme görevi başlatma
  if (silmeZamanlayici.has(interaction.channelId)) {
    return safeEdit(interaction, { content: '🔒 Bu ticket zaten silinmek üzere.' });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  setTicketStatus(ticket.id, 'closed', { actorId: interaction.user.id });

  await interaction.channel.send('🔒 Bu ticket 5 saniye içerisinde siliniyor.').catch((err) => {
    logger.warn(`Kapatma mesajı gönderilemedi: ${err.code || err.message}`);
  });

  const channelId = interaction.channelId;
  const guild = interaction.guild;
  const timer = setTimeout(async () => {
    silmeZamanlayici.delete(channelId);
    try {
      const ch = await guild.channels.fetch(channelId);
      if (!ch) {
        logger.warn(`Ticket kanalı zaten yok: ${channelId}`);
        return;
      }
      await ch.delete(`Ticket #${ticket.id} kapatıldı (${interaction.user.tag})`);
      logger.success(`Ticket kanalı silindi: ${channelId} (ticket #${ticket.id})`);
    } catch (err) {
      // Hatayı GİZLEME
      logger.error(`Ticket kanalı silinemedi (${channelId}): ${err.code || ''} ${err.message}`);
      try {
        await guild.channels.fetch(channelId).then((c) => c.send(`⚠️ Kanal silinemedi: ${err.code || err.message}`));
      } catch {
        /* kanal yok, yapacak bir şey yok */
      }
    }
  }, 5000);
  silmeZamanlayici.set(channelId, timer);

  return safeEdit(interaction, { content: '🔒 Ticket kapatıldı, kanal 5 saniye içinde silinecek.' });
}

function durumAdi(status) {
  return { open: 'açık', accepted: 'kabul edilmiş', rejected: 'reddedilmiş', closed: 'kapatılmış' }[status] || status;
}

async function safeReplyGone(interaction) {
  try {
    return await interaction.reply({
      embeds: [buildErrorEmbed('Bu kanal bir ticket olarak kayıtlı değil.')],
      ...EPH(),
    });
  } catch {
    return null;
  }
}

/* ================================================================== */
/* Dışa açılanlar                                                      */
/* ================================================================== */

module.exports = {
  KATEGORI_HATASI,
  panelGorseli,
  PANEL_GORSEL_DOSYA,
  CID,
  OPEN_KIND,
  isKnownKind,
  sendMainPanel,
  resolveTicketCategory,
  handleOpenButton,
  handleTicketButton,
  _silmeZamanlayici: silmeZamanlayici,
};
