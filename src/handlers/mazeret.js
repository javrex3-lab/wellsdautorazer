/**
 * YENİ MAZERET SİSTEMİ — tek akış.
 *
 * ESKİ `src/handlers/mazeretHandler.js` (Süre metin girişi + tek panel + onay
 * listesi) SİLİNDİ. Burada yalnızca tarif edilen akış var:
 *
 *   🔔 Mazeret Bildir  →  ⏱️ SÜRE SELECT MENÜSÜ  →  ✍️ SEBEP MODALI  →  kayıt
 *                                                                    →  merkezi panel
 *
 * Aktif mazeretler TEK bir mesajda (MERKEZİ_PANEL) gösterilir, sayfalanır.
 * Süre dolumu KALICI zaman damgalarıyla hesaplanır (RAM timer'ı değil).
 */
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const logger = require('../utils/logger');
const { buildErrorEmbed } = require('../utils/embeds');
const {
  sureBul,
  buildSureSelectRow,
  buildSebepModal,
  buildKayitOnayEmbed,
  buildAktifPanelEmbed,
  buildSayfalamaRow,
} = require('../utils/mazeretViews');
const {
  createMazeretRecord,
  getActiveMazerets,
  getActiveMazeretByUser,
  expireMazerets,
  upsertMazeretActivePanel,
  getMazeretActivePanel,
  deleteMazeretActivePanel,
} = require('../database/database');

/** Tüm customId'ler tek yerden. */
const CID = {
  BILDIR: 'mz_bildir',
  SURE: 'mz_sure',
  SEBEP: 'mz_sebep',
  ONCEKI: 'mz_onceki',
  SONRAKI: 'mz_sonraki',
  SAYFA: 'mz_sayfa',
};

/** Merkezi aktif-liste panelinin duracağı kanal. */
function merkeziKanalId() {
  return config.mazeretAdminChannelId || config.mazeretChannelId || null;
}

/* ================================================================== */
/* 1) Buton: Mazeret Bildir -> süre seçimi                             */
/* ================================================================== */

async function handleBildir(interaction) {
  if (!interaction.guild) return true;

  // Zaten aktif mazereti varsa süre seçtirmeye gerek yok.
  const mevcut = getActiveMazeretByUser(interaction.guildId, interaction.user.id);
  if (mevcut) {
    await safeReply(
      interaction,
      buildErrorEmbed(`Zaten aktif bir mazeretin var.\n**Bitiş:** <t:${Math.floor(mevcut.expires_at / 1000)}:f>`),
    );
    return true;

    // Çift gönderim koruması (aynı modal iki kez gönderilirse).
    // ÖNCE yukarıdaki DB kontrolü çalışır; böylece kullanıcı doğru mesajı görür
    // ("zaten aktif mazeretin var") — çift tıklama yalnızca aynı milisaniyede olursa yakalanır.
if (isleniyor.has(anahtar(interaction))) {
    logger.warn(`[mazeret] yinelenen modal gönderimi engellendi: ${interaction.user.id}`);
    await safeReply(interaction, buildErrorEmbed('Bu bildirim zaten işleniyor. Lütfen bir saniye bekleyin.'));
    return true;
  }
  }

  // Süre seçim menüsü (ephemeral).
  try {
    await interaction.reply({
      content: '⏱️ **Mazeret sürenizi seçin**',
      components: [buildSureSelectRow()],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  } catch (err) {
    logger.error('[mazeret] süre menüsü gönderilemedi:', err);
    await safeReply(interaction, buildErrorEmbed('Süre seçimi açılamadı. Lütfen tekrar deneyin.'));
    return true;
  }
}

/* ================================================================== */
/* 2) Select: süre seçimi -> sebep modalı                              */
/* ================================================================== */

async function handleSureSelect(interaction) {
  if (!interaction.guild) return true;
  const degerler = interaction.values || [];
  const key = Array.isArray(degerler) ? degerler[0] : degerler;
  const sure = sureBul(key);

  if (!sure) {
    logger.warn(`[mazeret] geçersiz süre seçimi: ${key}`);
    return safeReply(interaction, buildErrorEmbed('Geçersiz süre seçildi. Lütfen tekrar deneyin.'));
  }

  // Seçim anında da aktif mazeret kontrolü (araya başka bildirim girmiş olabilir)
  const mevcut = getActiveMazeretByUser(interaction.guildId, interaction.user.id);
  if (mevcut) {
    return safeReply(
      interaction,
      buildErrorEmbed(`Zaten aktif bir mazeretin var.\n**Bitiş:** <t:${Math.floor(mevcut.expires_at / 1000)}:f>`),
    );
  }

  try {
    // Süreyi modal açılana kadar kısa ömürlü RAM'de taşı (kalıcı kayıt DB'de olur).
    sureAyarla(interaction.guildId, interaction.user.id, sure);
    await interaction.showModal(buildSebepModal(sure.key));
    return true;
  } catch (err) {
    logger.error('[mazeret] sebep modalı açılamadı:', err);
    return safeReply(interaction, buildErrorEmbed('Sebep penceresi açılamadı. Lütfen tekrar deneyin.'));
  }
}

/* ================================================================== */
/* 3) Modal: sebep -> kalıcı kayıt                                     */
/* ================================================================== */

async function handleSebepSubmit(interaction) {
  if (!interaction.guild) return true;

  let neden = '';
  try {
    neden = (interaction.fields?.getTextInputValue?.('mz_neden') || '').trim();
  } catch {
    neden = '';
  }

  // Boş / anlamsız sebep KABUL EDİLMEZ
  if (!neden || neden.length < 3) {
    return safeReply(interaction, buildErrorEmbed('Mazeret sebebi boş olamaz. Lütfen kısa bir açıklama yazın.'));
  }
  if (neden.length > 500) neden = neden.slice(0, 500);

  // Süre: modal customId'de taşınmaz; select -> modal akışında süre DB'ye yazılmaz.
  // Modal tek alanlı olduğundan süreyi modal açılırken hafızada tutuyoruz.
  const sure = beklemedekiSure.get(anahtar(interaction));
  if (!sure) {
    return safeReply(
      interaction,
      buildErrorEmbed('Süre bilgisi kayboldu. Lütfen baştan başlayıp süreyi seçin.'),
    );
  }

  // İşlemi hemen kilitle: aynı modal iki kez gönderilirse ikinci sefer durur.
  isleniyor.add(anahtar(interaction));
  try {
    // Tekrar bildirim engeli (RAM) — kalıcı engel DB'deki tek-aktif indexidir.
    const mevcut = getActiveMazeretByUser(interaction.guildId, interaction.user.id);
    if (mevcut) {
      return safeReply(
        interaction,
        buildErrorEmbed(
          `Zaten aktif bir mazeretin var.\n**Bitiş:** <t:${Math.floor(mevcut.expires_at / 1000)}:f>`,
        ),
      );
    }

    const res = createMazeretRecord({
      guildId: interaction.guildId,
      userId: interaction.user.id, // ← DAIMA interaction sahibi, başkası adına kayıt YOK
      reason: neden,
      durationRaw: sure.label,
      durationMs: sure.ms,
      reportedBy: interaction.user.id,
    });

    if (!res.ok) {
      logger.error(`[mazeret] kayıt başarısız (${res.error}): ${interaction.user.tag}`);
      const msg =
        res.error === 'already_active'
          ? 'Zaten aktif bir mazeretin var.'
          : res.error === 'sebep_bos'
            ? 'Mazeret sebebi boş olamaz.'
            : 'Mazeretin kaydedilemedi. Lütfen tekrar deneyin.';
      // BAŞARI MESJI VERİLMEZ — kayıt gerçekten oluşmadı.
      return safeReply(interaction, buildErrorEmbed(msg));
    }

    /* --- Kayıt GERÇEKTEN oluştu (res.ok === true). --- */
    /* 1) Aktif kayıtlar kalıcı depodan yeniden okunur, merkezi panel güncellenir. */
    const panelOk = await refreshMerkeziPanel(interaction.client, interaction.guildId, 1);

    /* 2) Kullanıcıya onay. Panel güncellenemediyse hata GİZLENMEZ, açıkça bildirilir. */
    const onay = buildKayitOnayEmbed({ rec: res.record, sureLabel: sure.label });
    if (!panelOk) {
      onay.setFooter({
        text: 'Kaydın kaydedildi ancak merkezi liste paneli şu an güncellenemedi. Yetkililere bildirin.',
      });
      logger.error(`[mazeret] kayıt tamam ama merkezi panel güncellenemedi (guild ${interaction.guildId})`);
    }
    await interaction.reply({ embeds: [onay], flags: MessageFlags.Ephemeral }).catch(() => {});

    logger.success(
      `Mazeret kaydedildi: ${interaction.user.tag} · ${sure.label} · bitiş ${new Date(res.record.expires_at).toLocaleString('tr-TR')} · panel=${panelOk ? 'güncellendi' : 'GÜNCELLENEMEDİ'}`,
    );
  } catch (err) {
    logger.error('Interaction failed: mazeret submit.', err);
    await safeReply(interaction, buildErrorEmbed('Mazeret kaydedilemedi. Lütfen tekrar deneyin.'));
  } finally {
    // Kilit 5 sn sonra açılır: çift tıklamayı yakalar, gerçek ikinci denemeyi engellemez.
    // Kalıcı engel veritabanındaki tek-aktif kısıtıdır (her zaman çalışır).
    const k = anahtar(interaction);
    setTimeout(() => isleniyor.delete(k), 5000).unref?.();
    setTimeout(() => beklemedekiSure.delete(k), 30 * 60 * 1000).unref?.();
  }
  return true;
}

/* ================================================================== */
/* 4) Merkezi aktif-liste paneli (TEK mesaj, sayfalı)                 */
/* ================================================================== */

/**
 * Merkezi paneli oluşturur/günceller. Mesaj kayıtlıysa DÜZENLER
 * (kanal spam olmaz); silinmişse yenisini gönderir ve kaydeder.
 * @returns {Promise<boolean>}
 */
/**
 * Guild basina kilit: ayni anda iki handler calisirsa ikisi de "yeni mesaj"
 * gormez, siraya girer → duplicate panel OLUSMAZ.
 * @type {Map<string, Promise>}
 */
const panelKilit = new Map();

/** Kanal bu sunucuya ait mi ve bot gönderip düzenleyebilir mi? */
function kanalUygunMu(channel, guild) {
  if (!channel?.isTextBased?.() || channel.isDMBased?.()) return { ok: false, neden: 'kanal_bulunamadi' };
  if (channel.guildId && guild?.id && String(channel.guildId) !== String(guild.id)) {
    return { ok: false, neden: 'yanlis_sunucu' };
  }
  const me = guild?.members?.me;
  if (me) {
    const p = channel.permissionsFor?.(me);
    if (!p?.has(PermissionFlagsBits.SendMessages) || !p?.has(PermissionFlagsBits.EmbedLinks)) {
      return { ok: false, neden: 'yetki_yok' };
    }
  }
  return { ok: true };
}

/**
 * Merkezi aktif-liste panelini oluşturur/günceller.
 * Mesaj kayıtlıysa DÜZENLER (kanal spam olmaz); silinmişse yenisini gönderir
 * ve yeni ID'yi kaydeder. Hata olursa KAYIT YARATMADAN yeniden dener.
 * @returns {Promise<boolean>}
 */
async function refreshMerkeziPanel(client, guildId, page = 1) {
  const onceki = panelKilit.get(guildId) || Promise.resolve();
  const is = onceki
    .catch(() => {})
    .then(() => _refreshMerkeziPanel(client, guildId, page));
  panelKilit.set(guildId, is);
  is.finally(() => {
    if (panelKilit.get(guildId) === is) panelKilit.delete(guildId);
  });
  return is;
}

async function _refreshMerkeziPanel(client, guildId, page = 1) {
  const chId = merkeziKanalId();
  if (!chId || !client || !guildId) {
    logger.warn(`[mazeret] merkezi kanal/istemci/guild eksik — panel güncellenemiyor (chId=${chId || 'yok'})`);
    return false;
  }

  const guild = client.guilds?.cache?.get?.(guildId) || null;

  // 3 deneme: kayıt oluşturmaz, sadece paneli tazelemeye çalışır.
  for (let deneme = 1; deneme <= 3; deneme++) {
    try {
      const channel = await client.channels.fetch(chId).catch(() => null);
      const uygun = kanalUygunMu(channel, guild);
      if (!uygun.ok) {
        logger.error(`[mazeret] merkezi kanal kullanılamaz (${uygun.neden}): ${chId}`);
        return false;
      }

      // Süresi dolmuşları kapat + yalnızca HÂLÂ GEÇERLİ kayıtları oku.
      // expires_at kalıcı zaman damgasıdır → restart/redeploy etkisi yoktur.
      expireMazerets(guildId);
      const rows = getActiveMazerets(guildId);

      const probe = buildAktifPanelEmbed(rows, { page: 1, now: Date.now() });
      const toplamSayfa = probe.toplamSayfa;
      const p = Math.min(Math.max(1, Number(page) || 1), toplamSayfa);
      const { embed } = buildAktifPanelEmbed(rows, { page: p, now: Date.now() });
      const pag = buildSayfalamaRow(p, toplamSayfa);

      const kayit = getMazeretActivePanel(guildId, 'central');
      let mesaj = null;
      if (kayit && kayit.channel_id === channel.id) {
        mesaj = await channel.messages.fetch(kayit.message_id).catch(() => null);
        if (!mesaj) {
          deleteMazeretActivePanel(guildId, 'central');
          logger.warn(`[mazeret] kayıtlı panel mesajı bulunamadı (silinmiş), yenisi oluşturulacak: ${kayit.message_id}`);
        }
      }

      if (mesaj) {
        try {
          await mesaj.edit({ embeds: [embed], components: pag ? [pag] : [] });
          return true;
        } catch (err) {
          if (err?.code === 10008 || err?.code === 40060) {
            deleteMazeretActivePanel(guildId, 'central');
            mesaj = null;
          } else if (deneme < 3) {
            logger.warn(`[mazeret] panel düzenlenemedi (${deneme}/3): ${err.code || err.message}`);
          } else {
            throw err;
          }
        }
      }

      // Mesaj yok → bir kez oluştur ve ID'yi kalıcı sakla
      const yeni = await channel.send({ embeds: [embed], components: pag ? [pag] : [] });
      upsertMazeretActivePanel(guildId, 'central', channel.id, yeni.id);
      logger.info(`Mazeret merkezi paneli oluşturuldu: <#${channel.id}> (${yeni.id}) — ${rows.length} aktif kayıt`);
      return true;
    } catch (err) {
      logger.error(`[mazeret] merkezi panel güncellenemedi (guild ${guildId}, deneme ${deneme}/3): ${err.code || err.message}`);
      if (deneme >= 3) return false;
      await new Promise((r) => setTimeout(r, 400 * deneme));
    }
  }
  return false;
}

/* ================================================================== */
/* 5) Sayfalama butonları                                             */
/* ================================================================== */

async function handleSayfalama(interaction, yon) {
  if (!interaction.guild) return true;
  // Önce mevcut sayfa sayısını hesapla
  expireMazerets(interaction.guildId);
  const rows = getActiveMazerets(interaction.guildId);
  const toplam = buildAktifPanelEmbed(rows, { page: 1, pageCount: 1 }).toplamSayfa;
  if (toplam <= 1) return safeReply(interaction, buildErrorEmbed('Sayfalanacak kadar kayıt yok.'));

  const mevcutSayfa = Number(interaction.message?.embeds?.[0]?.footer?.text?.match(/Sayfa (\d+)\//)?.[1] || 1);
  const hedef = Math.min(Math.max(1, mevcutSayfa + (yon === 'ileri' ? 1 : -1)), toplam);

  try {
    await interaction.deferUpdate();
  } catch {
    return true;
  }
  await refreshMerkeziPanel(interaction.client, interaction.guildId, hedef);
  return true;
}

/* ================================================================== */
/* 6) Ticker: süresi dolanlar + panel tazeleme                         */
/* ================================================================== */

let ticker = null;
let sonBitis = new Map(); // guildId -> expires_at (sadece gerektiğinde tazelemek için)

async function tick(client) {
  for (const [, guild] of client.guilds.cache) {
    try {
      const kapandi = expireMazerets(guild.id);
      const rows = getActiveMazerets(guild.id);
      const enYakin = rows.length ? Math.max(...rows.map((r) => r.expires_at)) : 0;

      // Sadece bir şey DEĞİŞTİYSE paneli tazele (API spam olmasın)
      const prev = sonBitis.get(guild.id);
      if (kapandi > 0 || prev !== enYakin) {
        sonBitis.set(guild.id, enYakin);
        if (kapandi > 0) logger.info(`Mazeret: ${kapandi} kaydın süresi doldu, listeden çıkarıldı.`);
        await refreshMerkeziPanel(client, guild.id, 1);
      }
    } catch (err) {
      logger.debug(`Mazeret ticker hatası (guild ${guild.id}): ${err.message}`);
    }
  }
}

function startTicker(client) {
  if (!merkeziKanalId()) {
    logger.warn('Mazeret merkezi paneli kapalı: MAZERET_ADMIN_CHANNEL_ID boş.');
    return false;
  }
  stopTicker();
  const ms = Math.max(15_000, Number(config.mazeretRefreshMs) || 60_000);

  // İlk tur gecikmeli: bot tam yerleşmeden mesaj göndermeyelim.
  setTimeout(() => {
    tick(client).catch(() => {});
  }, 5000).unref?.();
  ticker = setInterval(() => tick(client).catch(() => {}), ms);
  ticker.unref?.();
  logger.info(`Mazeret merkezi paneli canlı takip aktif (${Math.round(ms / 1000)}sn aralık)`);
  return true;
}

function stopTicker() {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

/* ================================================================== */
/* Yardımcılar                                                        */
/* ================================================================== */

const anahtar = (i) => `${i.guildId}:${i.user.id}`;

/**
 * Select -> modal arasında süreyi taşımak için kısa ömürlü RAM kaydı.
 * Modal açılana kadar (birkaç saniye) yeterlidir; kalıcı çözüm DEĞİLDİR —
 * yalnızca Discord'un modal customId'sinde veri taşıma imkânı olmadığı için.
 * (Süre zaten DB'ye kayıt anında kesin olarak yazılır.)
 */
const beklemedekiSure = new Map();
const isleniyor = new Set();

/** handleBildir tarafından doldurulur; modal açılırken okunur. */
function sureAyarla(guildId, userId, sure) {
  beklemedekiSure.set(`${guildId}:${userId}`, { ...sure, at: Date.now() });
}

async function safeReply(interaction, embed) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.editReply({ embeds: [embed] });
    }
    if (interaction.isRepliable?.()) {
      return await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    // Kullanıcı yanıtı alamadıysa sessizce YUTMA — logla.
    logger.warn(`[mazeret] kullanıcı yanıtı gönderilemedi: ${err.code || err.message}`);
  }
  return null;
}

module.exports = {
  CID,
  merkeziKanalId,
  handleBildir,
  handleSureSelect,
  handleSebepSubmit,
  handleSayfalama,
  refreshMerkeziPanel,
  startTicker,
  stopTicker,
  sureAyarla,
  _beklemedekiSure: beklemedekiSure,
  _isleniyor: isleniyor,
  _panelKilit: panelKilit,
};