/**
 * Mazeret sistemi (yeni tasarım)
 * ---------------------------------------------------------------------------
 * Akış:
 *   1) /mazeretpanel  → herkesin gördüğü panel (tek buton: "Mazeret Bildir")
 *   2) Buton         → modal (Süre + Sebep)
 *   3) Gönder        → kayıt DB'ye, yetkili paneli OTOMATİK güncellenir
 *   4) Süre dolunca  → kayıt kapanır, panelde listeden düşer (ticker)
 *
 * Panel mesajları DB'de tutulur ki her yenilemede AYNI mesaj güncellensin
 * (kanal spam olmaz): mazeret_active_panels (kind = 'admin' | 'public')
 */
const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
  EmbedBuilder,
} = require('discord.js');
const config = require('../config');
const logger = require('../utils/logger');
const { buildErrorEmbed, buildSuccessEmbed } = require('../utils/embeds');
const {
  parseDuration,
  formatDuration,
  remainingLabel,
  DEFAULT_DURATION_MS,
} = require('../utils/mazeretDuration');
const {
  buildMazeretPanelEmbed,
  buildMazeretOpenRow,
  buildActiveMazeretEmbed,
  buildMazeretFormEmbed,
} = require('../utils/mazeretEmbeds');
const {
  createMazeretRecord,
  getActiveMazerets,
  getActiveMazeretByUser,
  endMazeret,
  expireMazerets,
  upsertMazeretActivePanel,
  getMazeretActivePanel,
  deleteMazeretActivePanel,
} = require('../database/database');

const MODAL_ID = 'mazeret_modal';
const REFRESH_BTN = 'mazeret_refresh';

// Bellek içi cooldown: DB yazmadan önce spam'i keser (restart'a dayanıklı değil,
// ama DB kaydının kendisi de mükerrer kaydı engelliyor).
const cooldowns = new Map(); // `${guildId}:${userId}` -> timestamp

/** Yetkili listesi panelinin duracağı kanal. */
function adminChannelId() {
  return config.mazeretAdminChannelId || config.mazeretChannelId || null;
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

function buildMazeretModal() {
  return new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle('Mazeret Bildirimi')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('mazeret_sure')
          .setLabel('Mazeret Süresi')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('örn: 3 gün  •  12 saat  •  1 hafta')
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(50),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('mazeret_sebep')
          .setLabel('Mazeret Sebebi')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Neden mazerette olacaksın?')
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(400),
      ),
    );
}

/* ------------------------------------------------------------------ */
/* Buton                                                               */
/* ------------------------------------------------------------------ */

async function handleMazeretOpen(interaction) {
  try {
    await interaction.showModal(buildMazeretModal());
  } catch (err) {
    logger.error('Mazeret modalı açılamadı.', err);
    if (!interaction.replied && !interaction.deferred && interaction.isRepliable()) {
      await interaction
        .reply({ embeds: [buildErrorEmbed('Form açılamadı. Lütfen tekrar deneyin.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
  return true;
}

/** Yetkili panelindeki "Listeyi Yenile" butonu. */
async function handleMazeretRefresh(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ok = await refreshAdminPanel(interaction.client, interaction.guildId);
    await interaction
      .editReply({
        embeds: [
          ok
            ? buildSuccessEmbed('Liste güncellendi.')
            : buildErrorEmbed(`Liste güncellenemedi. Yetkili kanalı: ${adminChannelId() || 'ayarlanmamış'}`),
        ],
      })
      .catch(() => {});
  } catch (err) {
    logger.error('Mazeret panel yenileme hatası.', err);
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Modal gönderimi                                                     */
/* ------------------------------------------------------------------ */

async function handleMazeretSubmit(interaction) {
  const key = `${interaction.guildId}:${interaction.user.id}`;

  try {
    const reason = (interaction.fields.getTextInputValue('mazeret_sebep') || '').trim();
    const sureRaw = (interaction.fields.getTextInputValue('mazeret_sure') || '').trim();

    if (!reason) {
      await interaction
        .reply({ embeds: [buildErrorEmbed('Mazeret sebebi boş olamaz.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return true;
    }
    if (!sureRaw) {
      await interaction
        .reply({ embeds: [buildErrorEmbed('Mazeret süresi boş olamaz.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return true;
    }

    // --- Cooldown ---
    const waitMs = config.mazeretCooldownMs - (Date.now() - (cooldowns.get(key) || 0));
    if (waitMs > 0) {
      const secs = Math.ceil(waitMs / 1000);
      await interaction
        .reply({
          content: `⏳ Çok sık bildirim yapıyorsunuz — **${secs} sn** sonra tekrar deneyin.`,
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return true;
    }

    // --- Süreyi ayrıştır ---
    const parsed = parseDuration(sureRaw);
    const guessed = !parsed.parsed;

    // --- Aynı kullanıcının aktif mazereti var mı? ---
    const mevcut = getActiveMazeretByUser(interaction.guildId, interaction.user.id);
    if (mevcut) {
      const kalan = remainingLabel(mevcut.expires_at);
      await interaction
        .reply({
          embeds: [
            buildErrorEmbed(
              `Zaten aktif bir mazeretin var.\n\n**Süre:** ${formatDuration(mevcut.duration_ms)}\n**Kalan:** ${kalan}`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return true;
    }

    // --- Kaydet ---
    const res = createMazeretRecord({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      reason,
      durationRaw: parsed.raw,
      durationMs: parsed.ms,
      durationGuess: guessed,
      reportedBy: interaction.user.id,
    });

    if (!res.ok) {
      const msg =
        res.error === 'already_active'
          ? 'Zaten aktif bir mazeretin var.'
          : 'Mazeretin kaydedilemedi. Lütfen tekrar deneyin.';
      await interaction
        .reply({ embeds: [buildErrorEmbed(msg)], flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return true;
    }

    cooldowns.set(key, Date.now());

    // --- Kullanıcıya onay ---
    const rec = res.record;
    await interaction
      .reply({
        embeds: [
          buildMazeretFormEmbed({
            userId: interaction.user.id,
            durationText: formatDuration(rec.duration_ms),
            reason: rec.reason,
            remaining: remainingLabel(rec.expires_at),
            guessed,
          }),
        ],
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});

    // --- Yetkili panelini güncelle ---
    await refreshAdminPanel(interaction.client, interaction.guildId);

    logger.success(
      `Mazeret bildirildi: ${interaction.user.tag} · ${formatDuration(rec.duration_ms)} · bitiş ${new Date(rec.expires_at).toLocaleString('tr-TR')}`,
    );
  } catch (err) {
    if (err?.code === 10062) {
      logger.error('Interaction EXPIRED: [mazeret submit].');
      return true;
    }
    logger.error('Interaction failed: mazeret submit.', err);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          embeds: [buildErrorEmbed('Bildirim gönderilemedi.')],
          flags: MessageFlags.Ephemeral,
        });
      } else if (interaction.isRepliable()) {
        await interaction.reply({
          embeds: [buildErrorEmbed('Bildirim gönderilemedi.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch {
      /* sessiz geç */
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Yetkili paneli (TEK mesaj, canlı)                                  */
/* ------------------------------------------------------------------ */

/**
 * Yetkili kanalındaki listeyi yeniden oluşturur.
 * Mesaj kayıtlıysa DÜZENLER (kanal spam olmaz), silinmişse yenisini gönderir.
 * @returns {Promise<boolean>} başarılı mı
 */
async function refreshAdminPanel(client, guildId) {
  const chId = adminChannelId();
  if (!chId || !client || !guildId) return false;

  try {
    const channel = await client.channels.fetch(chId).catch(() => null);
    if (!channel?.isTextBased?.() || channel.isDMBased?.()) {
      logger.warn(`Mazeret yetkili kanalı bulunamadı/uygun değil: ${chId}`);
      return false;
    }

    // Süresi dolmuşları kapat + listeyi oku
    expireMazerets(guildId);
    const rows = getActiveMazerets(guildId);
    const embed = buildActiveMazeretEmbed(rows, { updatedUnix: Date.now() });

    const kayit = getMazeretActivePanel(guildId, 'admin');
    let mesaj = null;

    if (kayit) {
      mesaj = await channel.messages.fetch(kayit.message_id).catch(() => null);
      if (!mesaj) deleteMazeretActivePanel(guildId, 'admin');
    }

    if (mesaj) {
      await mesaj.edit({ embeds: [embed] }).catch(async (err) => {
        // 10008 = Unknown Message, 40060 = yarış durumu
        if (err?.code === 10008) return null;
        throw err;
      });
    } else {
      mesaj = await channel.send({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(
            new (require('discord.js').ButtonBuilder)()
              .setCustomId(REFRESH_BTN)
              .setLabel('Listeyi Yenile')
              .setStyle(require('discord.js').ButtonStyle.Secondary)
              .setEmoji('🔄'),
          ),
        ],
      });
      upsertMazeretActivePanel(guildId, 'admin', channel.id, mesaj.id);
      logger.info(`Mazeret yetkili paneli oluşturuldu: <#${channel.id}> (${mesaj.id}) — ${rows.length} kayıt`);
    }

    return true;
  } catch (err) {
    logger.error(`Mazeret yetkili paneli güncellenemedi (guild ${guildId}):`, err);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Ticker: süresi dolanları temizle + paneli tazele                  */
/* ------------------------------------------------------------------ */

let ticker = null;

function startMazeretTicker(client) {
  const ms = Number(config.mazeretRefreshMs) || 60000;
  stopMazeretTicker();

  const tick = async () => {
    for (const [, guild] of client.guilds.cache) {
      try {
        const closed = expireMazerets(guild.id);
        if (closed > 0) logger.info(`Mazeret: ${closed} kaydın süresi doldu, listeden çıkarıldı.`);
        await refreshAdminPanel(client, guild.id);
      } catch (err) {
        logger.debug(`Mazeret ticker hatası (guild ${guild.id}): ${err.message}`);
      }
    }
  };

  // İlk turu biraz geciktir: bot tam yerleşmeden mesaj göndermeyelim.
  setTimeout(tick, 5000);
  ticker = setInterval(tick, ms);
  if (typeof ticker.unref === 'function') ticker.unref();
  logger.info(`Mazeret paneli canlı takip aktif (${Math.round(ms / 1000)}sn aralık)`);
}

function stopMazeretTicker() {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

module.exports = {
  MODAL_ID,
  REFRESH_BTN,
  buildMazeretModal,
  handleMazeretOpen,
  handleMazeretRefresh,
  handleMazeretSubmit,
  refreshAdminPanel,
  startMazeretTicker,
  stopMazeretTicker,
  adminChannelId,
  endMazeret,
  _cooldowns: cooldowns,
};
