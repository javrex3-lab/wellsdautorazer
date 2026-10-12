/**
 * ready event - bot açılışında çalışır.
 * DB'deki aktif sistem sayısını loglar (restart sonrası veri kaybı kontrolü).
 */
const { ActivityType, Routes } = require('discord.js');
const config = require('../config');
const { getAllSystems, countGuardGuilds } = require('../database/database');
const { getSavedVoiceChannel, joinVoice, leaveVoice } = require('../handlers/voiceHandler');
const logger = require('../utils/logger');

module.exports = {
  name: 'ready',
  once: true,

  async execute(client) {
    logger.success(`Bot çevrimiçi: ${client.user.tag}`);

    try {
      const systems = getAllSystems();
      const ingame = systems.filter((s) => s.type === 'ingame').length;
      const aktiflik = systems.filter((s) => s.type === 'aktiflik').length;
      logger.info(`Aktif paneller yüklendi: ${ingame} ingame, ${aktiflik} aktiflik (toplam ${systems.length})`);
    } catch (err) {
      logger.error('Aktif paneller yüklenirken hata.', err);
    }


    // Eski ticketHandler izin senkronu kaldırıldı: yeni sistem kanal iznini
    // ticket açılırken kendisi verir (src/handlers/tickets.js).
    // ---- Mazeret paneli: yetkili listesi canlı takip + süre sonu temizliği ----
    try {
      const { startMazeretTicker, adminChannelId } = require('../handlers/mazeretHandler');
      if (adminChannelId()) startMazeretTicker(client);
      else logger.warn('Mazeret yetkili paneli kapalı: MAZERET_ADMIN_CHANNEL_ID boş.');
    } catch (err) {
      logger.error('Mazeret takibi başlatılamadı.', err);
    }

    // Ticket paneli bilinçli olarak OTOMATİK gönderilmez (yalnız /ticketkur).

    // ---- FiveM canlı paneli (Yöntem A/B/C durumunu tek mesajda gösterir) ----
    // Kanal tanımlı değilse no-op çalışır; botu etkilemez.
    try {
      const fivemPanel = require('../services/fivem/panel');
      fivemPanel.start(client);
    } catch (err) {
      logger.error('FiveM paneli başlatılamadı.', err);
    }

    // Ticket kategorisine yetkili rol erişimi (yeni sistemle uyumlu).
    // Panel GÖNDERMEZ — sadece kanal izinlerini hazırlar.
    try {
      const { PermissionFlagsBits } = require("discord.js");
      const rolIds = (config.ticket.staffRoleIds || []).filter((r) => /^\d{17,20}$/.test(String(r)));
      const catId = config.ticket.categoryId;
      if (catId && rolIds.length) {
        for (const [, guild] of client.guilds.cache) {
          const cat = await guild.channels.fetch(catId).catch(() => null);
          if (!cat || cat.type !== 4) continue; // 4 = GuildCategory
          for (const roleId of rolIds) {
            const mevcut = cat.permissionOverwrites.cache.get(roleId);
            if (mevcut?.allow?.has?.(PermissionFlagsBits.ViewChannel)) continue;
            await cat.permissionOverwrites
              .edit(roleId, { ViewChannel: true, ReadMessageHistory: true, SendMessages: true }, "Ticket kategorisi yetkili erişimi")
              .catch((err) => logger.warn(`Kategori izni verilemedi (${roleId}): ${err.code || err.message}`));
            logger.info(`Kategori ${cat.id} icin rol ${roleId} erişimi açıldı`);
          }
        }
      }
    } catch (err) {
      logger.warn(`Ticket kategori izin kontrolu atlandi: ${err.message}`);
    }


    try {
      logger.info(`Guard: ${countGuardGuilds()} sunucuda aktif`);
    } catch (err) {
      logger.error('Guard durumu okunamadı.', err);
    }

    // Çekilişler: aktif kayıtları geri yükle (timer + süresi dolmuşları kapat)
    try {
      const { restoreGiveaways } = require('../handlers/giveawayHandler');
      await restoreGiveaways(client);
    } catch (err) {
      logger.error('Çekiliş geri yüklenirken hata.', err);
    }

    // Kapı kanıtı: bu satır yoksa çalışan bot ESKİ koddur (restart gerekli)
    try {
      const n = (config.globalAllowedRoleIds || []).length;
      if (n) logger.success(`Komut erişim kapısı AKTİF: ${n} rol + adminler (diğerleri engellenir)`);
      else logger.warn('Komut erişim kapısı PASİF: BOT_ALLOWED_ROLE_IDS boş, herkes kullanabilir.');
    } catch (err) {
      logger.error('Erişim kapısı durumu okunamadı.', err);
    }

    // Ses kalıcılığı: restart öncesi bir kanalda idiysem geri katıl
    try {
      for (const [, guild] of client.guilds.cache) {
        const savedId = getSavedVoiceChannel(guild.id);
        if (!savedId) continue;
        try {
          // fetch: cache'i doldurur (joinVoice cache üzerinden doğrular)
          await guild.channels.fetch(savedId).catch(() => null);
          await joinVoice(guild, savedId);
          logger.info(`Sese geri dönüldü: <#${savedId}>`);
        } catch (err) {
          if (err?.code === 'NO_CHANNEL' || err?.code === 'ALREADY_THERE') {
            if (err?.code === 'NO_CHANNEL') {
              await leaveVoice(guild.id); // ölü kayıt temizliği
              logger.warn(`Kayıtlı ses kanalı artık yok, kayıt silindi (guild ${guild.id})`);
            }
          } else {
            logger.warn(`Sese geri dönülemedi: ${err.code || err.message} (sonraki /sesgir ile manuel katılın)`);
          }
        }
      }
    } catch (err) {
      logger.error('Ses geri katılımında hata.', err);
    }

    // REST heartbeat: DPI'lı ağlarda SOĞUK TLS handshake 10sn+ sürer, oysa Discord
    // etkileşim ACK'lerinin 3sn içinde ulaşması gerekir. 40sn'de bir yapılan bu
    // minik istek (kimlik gerektirmez) havuzdaki bağlantıyı sıcak tutar.
    // Trafik maliyeti: 1 küçük istek / 40sn. Kapatmak için HEARTBEAT_MS=0.
    const hbRaw = parseInt(process.env.HEARTBEAT_MS || '40000', 10);
    const HEARTBEAT_MS = Number.isFinite(hbRaw) && hbRaw >= 0 ? hbRaw : 40000;
    if (HEARTBEAT_MS > 0) {
      logger.info(`REST heartbeat aktif (${HEARTBEAT_MS}ms) — etkileşim cevapları için bağlantı sıcak tutulacak.`);
      let hbFirst = true;
      const timer = setInterval(async () => {
        try {
          const t0 = Date.now();
          await client.rest.get(Routes.gateway());
          const ms = Date.now() - t0;
          if (hbFirst) {
            hbFirst = false;
            logger.success(`Heartbeat OK (${ms}ms) — REST bağlantısı sıcak.`);
          } else if (ms > 3000) {
            logger.warn(`Heartbeat yavaş (${ms}ms) — ağ gecikmesi yüksek, ilk komutlar gecikebilir.`);
          }
        } catch (err) {
          logger.warn(`Heartbeat failed: ${err.code || err.message} (bağlantı soğumuş olabilir, bir sonraki turda yenilenecek)`);
        }
      }, HEARTBEAT_MS);
      if (typeof timer.unref === 'function') timer.unref();
    }

    // Profil durumu rotasyonu: 5sn'de bir değişen "İzliyor" metni (sonsuz döngü).
    // Liste buradan düzenlenir. (Discord ~5sn sıklığa izin verir, daha hızlı yapmayın.)
    const PRESENCE_ROTATION = ['Javrex Bot System 🤍 Javrex', 'Javrex Bot System 🤍 Martı', 'Javrex Bot System 🤍 Egax', 'Javrex Bot System 🤍 Shanzy', 'Javrex Bot System 🤍 Montana'];
    const PRESENCE_INTERVAL_MS = 5000;
    try {
      let presenceIdx = 0;
      const applyPresence = () => {
        try {
          client.user.setPresence({
            activities: [{ name: PRESENCE_ROTATION[presenceIdx % PRESENCE_ROTATION.length], type: ActivityType.Watching }],
            status: 'online',
          });
          presenceIdx++;
        } catch {
          /* presence kritik değil */
        }
      };
      applyPresence();
      const presenceTimer = setInterval(applyPresence, PRESENCE_INTERVAL_MS);
      if (typeof presenceTimer.unref === 'function') presenceTimer.unref();
      logger.info(`Profil rotasyonu aktif (${PRESENCE_ROTATION.length} metin, ${PRESENCE_INTERVAL_MS}ms)`);
    } catch {
      /* presence kritik değil */
    }
  },
};
