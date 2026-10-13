/**
 * SQLite persistence katmanı (Node.js built-in `node:sqlite`, senkron + WAL).
 * Restart sonrası tüm /ingame ve /aktiflik mesajları buradan geri yüklenir.
 *
 * Neden built-in? better-sqlite3 native derleme gerektirir (Visual Studio / build tools),
 * node:sqlite ise Node 22.5+ ile gömülü gelir: kurulum sorunsuz, dosya formatı standart SQLite.
 */
const fs = require('fs');
const path = require('path');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  console.error('[ERROR] Bu bot için Node.js 22.5+ gerekli (built-in node:sqlite). Lütfen Node sürümünüzü yükseltin.');
  process.exit(1);
}

const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const { SCHEMA } = require('./schema');

let db = null;

function getDbPath() {
  const p = path.resolve(process.cwd(), config.dbPath);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return p;
}

function initDatabase() {
  if (db) return db;
  try {
    const dbPath = getDbPath();
    db = new DatabaseSync(dbPath);
    db.exec(SCHEMA);
    migrate(db);
    logger.db(`Veritabanı hazır: ${dbPath}`);
    reportPersistence(dbPath);
    return db;
  } catch (err) {
    logger.error('Veritabanı başlatılamadı.', err);
    throw err;
  }
}

/**
 * Kalıcılık teşhisi — whitelist/ticket kayıtlarının korunup korunmayacağını
 * AÇILIRKEN görünür kılar. Sessiz veri kaybı olmasın.
 */
function reportPersistence(dbPath) {
  const kalici = config.dbIsPersistent !== false;
  const yol = path.resolve(dbPath);

  logger.info('─'.repeat(58));
  logger.info(`DB konumu        : ${yol}`);
  logger.info(`DB kalıcı mı     : ${kalici ? 'EVET (kalıcı disk)' : 'HAYIR — GEÇİCİ DOSYA SİSTEMİ'}`);

  // Yazılabilir mi? (volume mount yanlışsa erişim reddedilir)
  try {
    fs.accessSync(path.dirname(yol), fs.constants.W_OK);
  } catch {
    logger.error(`DB klasörü YAZILAMAZ: ${path.dirname(yol)} — kayıtlar kaydedilemez!`);
  }

  // Whitelist durumu — sıfırlanırsa burada HEMEN görünür
  try {
    const n = getDb().prepare('SELECT COUNT(*) AS c FROM guard_whitelist').get().c;
    logger.info(`Guard whitelist  : ${n} kayıt`);
    if (n === 0) {
      logger.warn('Whitelist boş. Bu normal DEĞİLSE veritabanı sıfırlanmış olabilir (redeploy?).');
    }
  } catch (err) {
    logger.error('Whitelist okunamadı (veri bozulmuş olabilir):', err);
  }

  if (!kalici) {
    const satirlar = [
      '',
      '!!! VERİ KALICI DEĞİL — HER REDEPLOY\'DA SIFIRLANIR !!!',
      '    Çözüm: Railway → proje → Volume ekle → mount path = /data',
      '    (RAILWAY_VOLUME_MOUNT_PATH otomatik gelir; DB yolu otomatik',
      '     oraya taşınır. DB_PATH kalıcı olmayan yolsa bile mount kazanır.)',
      '',
    ];
    for (const s of satirlar) logger.error(s);
  }
  logger.info('─'.repeat(58));
}

/**
 * Mevcut DB'leri yeni şemaya taşır (CREATE TABLE IF NOT EXISTS eski
 * tablolara sütun eklemez — o yüzden ALTER'lar burada, hatalar yutulur).
 */
function migrate(database) {
  const stmts = [
    'ALTER TABLE tickets ADD COLUMN log_message_id TEXT',
    'ALTER TABLE tickets ADD COLUMN panel_message_id TEXT',
    'ALTER TABLE tickets ADD COLUMN claimed_at INTEGER',
    'ALTER TABLE tickets ADD COLUMN decision TEXT',
    'ALTER TABLE tickets ADD COLUMN decided_by TEXT',
    'ALTER TABLE tickets ADD COLUMN decided_at INTEGER',
  ];
  for (const sql of stmts) {
    try {
      database.exec(sql);
      logger.db(`Migrasyon uygulandı: ${sql}`);
    } catch {
      /* sütun zaten varsa hata verir — normal, geç */
    }
  }

  /* ------------------------------------------------------------------ */
  /* MAZERET GÖÇÜ — kritik                                             */
  /* ------------------------------------------------------------------ */
  // `CREATE TABLE IF NOT EXISTS` MEVCUT tabloyu değiştirmez. Eski mazeret
  // sisteminden kalmış `mazeret_records` tablosunda `started_at` sütunu
  // YOKTUR ve INSERT'ler sessizce başarısız olur → kayıt hiç saklanmaz →
  // aktif mazeretliler paneli hep boş kalır. Aşağıdaki ALTER ile geriye
  // dönük uyumlu hale getiriyoruz.
  try {
    const cols = database.prepare('PRAGMA table_info(mazeret_records)').all().map((c) => c.name);
    if (!cols.length) {
      logger.warn('[DB] mazeret_records tablosu yok (SCHEMA çalışmamış?) — migrate atlanıyor.');
    } else {
      if (!cols.includes('started_at')) {
        database.exec('ALTER TABLE mazeret_records ADD COLUMN started_at INTEGER');
        // Eski kayıtlara başlangıç zamanı = kayıt oluşturma zamanı
        database.exec('UPDATE mazeret_records SET started_at = created_at WHERE started_at IS NULL OR started_at = 0');
        logger.warn('[DB] Mazeret göçü: started_at sütunu eklendi ve eski kayıtlar dolduruldu.');
      }
      // Aktif kayıtların başlangıç zamanı boşsa güvenli tamamla
      database.exec('UPDATE mazeret_records SET started_at = created_at WHERE started_at IS NULL OR started_at = 0');
      database.exec('UPDATE mazeret_records SET started_at = expires_at - duration_ms WHERE started_at > expires_at');

      // Tek-aktif kısıtı (eş zamanlı bildirimlerde duplicate kaydı engeller)
      const idx = database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='uq_mazeret_one_active'").get();
      if (!idx) {
        database.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_mazeret_one_active ON mazeret_records (guild_id, user_id) WHERE active = 1');
        logger.warn('[DB] Mazeret: tek-aktif benzersiz indexi oluşturuldu.');
      }

      // Doğrulama — kayıt gerçekten yazılabiliyor mu?
      const son = database.prepare('SELECT COUNT(*) AS c FROM mazeret_records WHERE started_at IS NULL OR started_at = 0').get();
      if (Number(son?.c || 0) > 0) {
        logger.error(`[DB] Mazeret göçü SONRASI ${son.c} kayıtta started_at hâlâ boş!`);
      } else {
        logger.db('Mazeret şeması hazır (started_at mevcut, tek-aktif kısıtı var).');
      }
    }
  } catch (err) {
    // Göç hatası GİZLENMEZ — kayıtların neden yazılamadığı bilinmelidir.
    logger.error('[DB] Mazeret göçü BAŞARISIZ — yeni mazeret kayıtları kaydedilemeyebilir:', err);
  }
}

function getDb() {
  if (!db) return initDatabase();
  return db;
}

/** Database canlı mı? Asla throw etmez (fail-closed kararları için). */
function dbHealthy() {
  try {
    getDb().prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

/**
 * Veritabanını kontrollü kapatır (graceful shutdown için).
 * ÖNCE WAL checkpoint (wal dosyası ana DB'ye yazılır), SONRA close.
 * Railway/PaaS'da process SIGTERM alınca bu çağrılır; checkpoint olmadan
 * ölen process'te WAL'de kalan veri volume'a yazılmadan kalabilir.
 * Asla throw etmez, tekrar çağrılabilir (idempotent).
 * @returns {{ closed: boolean, checkpointed: boolean }}
 */
function closeDatabase() {
  const result = { closed: false, checkpointed: false };
  if (!db) return result;
  try {
    // WAL → ana dosyaya yaz. TRUNCATE: wal dosyasını da sıfırlar (temiz kapanış).
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    result.checkpointed = true;
  } catch (err) {
    // Checkpoint başarısız olsa bile close denenir (veri WAL'de duruyor, kayıp yok).
    logger.warn(`[DB] WAL checkpoint başarısız: ${err.code || err.message}`);
  }
  try {
    db.close();
    result.closed = true;
    db = null;
    logger.db('Veritabanı kapatıldı (WAL checkpoint tamam).');
  } catch (err) {
    logger.error('[DB] Kapatma hatası.', err);
  }
  return result;
}

// ---------- System kayıtları ----------

function upsertSystem({ messageId, channelId, guildId, type, createdBy }) {
  try {
    getDb()
      .prepare(
        `INSERT INTO systems (message_id, channel_id, guild_id, type, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(message_id) DO UPDATE SET channel_id = excluded.channel_id, guild_id = excluded.guild_id, type = excluded.type`,
      )
      .run(String(messageId), String(channelId), String(guildId), type, createdBy ? String(createdBy) : null, Date.now());
  } catch (err) {
    logger.error(`[DB] upsertSystem failed: ${messageId}`, err);
    throw err;
  }
}

function getSystem(messageId) {
  try {
    return getDb().prepare('SELECT * FROM systems WHERE message_id = ?').get(String(messageId)) || null;
  } catch (err) {
    logger.error(`[DB] getSystem failed: ${messageId}`, err);
    return null;
  }
}

function getAllSystems() {
  try {
    return getDb().prepare('SELECT * FROM systems ORDER BY created_at ASC').all();
  } catch (err) {
    logger.error('[DB] getAllSystems failed.', err);
    return [];
  }
}

function deleteSystem(messageId) {
  try {
    getDb().prepare('DELETE FROM systems WHERE message_id = ?').run(String(messageId));
  } catch (err) {
    logger.error(`[DB] deleteSystem failed: ${messageId}`, err);
  }
}

// ---------- /ingame katılımcı mantığı ----------

/**
 * Kullanıcıyı ingame listesinde işaretle. Aynı kullanıcı iki listede ASLA bulunmaz:
 * tek satır status ile tutulur (joined/left), bu yüzden mutual-exclusion DB seviyesinde garantilidir.
 */
function setIngameStatus(messageId, userId, status) {
  try {
    getDb()
      .prepare(
        `INSERT INTO participants (message_id, user_id, status, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(message_id, user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
      )
      .run(String(messageId), String(userId), status, Date.now());
  } catch (err) {
    logger.error(`[DB] setIngameStatus failed: ${messageId}/${userId}`, err);
    throw err;
  }
}

function getIngameLists(messageId) {
  try {
    const rows = getDb().prepare('SELECT user_id, status FROM participants WHERE message_id = ?').all(String(messageId));
    const joined = [];
    const left = [];
    for (const r of rows) {
      if (r.status === 'joined') joined.push(String(r.user_id));
      else if (r.status === 'left') left.push(String(r.user_id));
    }
    return { joined, left };
  } catch (err) {
    logger.error(`[DB] getIngameLists failed: ${messageId}`, err);
    return { joined: [], left: [] };
  }
}

function getIngameStatus(messageId, userId) {
  try {
    const row = getDb()
      .prepare('SELECT status FROM participants WHERE message_id = ? AND user_id = ?')
      .get(String(messageId), String(userId));
    return row ? row.status : null;
  } catch (err) {
    logger.error(`[DB] getIngameStatus failed: ${messageId}/${userId}`, err);
    return null;
  }
}

// ---------- /aktiflik katılımcı mantığı ----------

function addAktiflikParticipant(messageId, userId) {
  try {
    const res = getDb()
      .prepare(
        `INSERT INTO participants (message_id, user_id, status, updated_at)
         VALUES (?, ?, 'joined', ?)
         ON CONFLICT(message_id, user_id) DO NOTHING`,
      )
      .run(String(messageId), String(userId), Date.now());
    return Number(res.changes) > 0; // true = yeni eklendi, false = zaten vardı (duplicate yok)
  } catch (err) {
    logger.error(`[DB] addAktiflikParticipant failed: ${messageId}/${userId}`, err);
    throw err;
  }
}

function getAktiflikList(messageId) {
  try {
    const rows = getDb()
      .prepare("SELECT user_id FROM participants WHERE message_id = ? AND status = 'joined' ORDER BY updated_at ASC")
      .all(String(messageId));
    return rows.map((r) => String(r.user_id));
  } catch (err) {
    logger.error(`[DB] getAktiflikList failed: ${messageId}`, err);
    return [];
  }
}

module.exports = {
  initDatabase,
  migrate,
  getDb,
  // --- Sistem ---
  upsertSystem,
  getSystem,
  getAllSystems,
  deleteSystem,
  setIngameStatus,
  getIngameLists,
  getIngameStatus,
  addAktiflikParticipant,
  getAktiflikList,
  // --- Kalıcı ayarlar ---
  getSetting,
  setSetting,
  deleteSetting,
  // --- YENİ TICKET SİSTEMİ ---
  createTicketSession,
  setTicketChannel,
  getTicketByChannel,
  getOpenTicketByUser,
  setTicketStatus,
  endTicketSession,
  upsertTicketPanel,
  getTicketPanel,
  deleteTicketPanel,
  // --- Mazeret panel ---
  createMazeretRecord,
  getMazeretById,
  getActiveMazerets,
  getActiveMazeretByUser,
  endMazeret,
  expireMazerets,
  upsertMazeretActivePanel,
  getMazeretActivePanel,
  deleteMazeretActivePanel,
  // --- IC onay ---
  createIcRequest,
  getIcByPanel,
  getPendingIc,
  getApprovedIc,
  decideIc,
  setIcPanel,
  // --- Quit takibi ---
  trackMemberRoles,
  getMemberRoles,
  createQuitLog,
  getQuitByPanel,
  setQuitPanel,
  pruneQuitLogs,
  // --- Guard ---
  getGuardLevel,
  setGuardLevel,
  removeGuard,
  listWhitelist,
  getGuardSettings,
  saveGuardSettings,
  countGuardGuilds,
  // --- Log kanal kayıtları ---
  getGuardLogChannels,
  getGuardLogChannel,
  setGuardLogChannel,
  deleteGuardLogChannel,
  countGuardLogChannels,
  dbHealthy,
  closeDatabase,
  // --- Transcript sistemi ---
  createTranscript,
  getTranscriptById,
  getTranscriptByToken,
  getTranscriptByTicketId,
  getTranscriptMessages,
  getTranscriptUsers,
  getTranscriptAttachments,
  updateTranscriptStatus,
  deleteTranscript,
  listTranscriptsByGuild,
  // --- Çekiliş sistemi ---
  createGiveaway,
  getGiveaway,
  getGiveawayByMessage,
  getActiveGiveaways,
  setGiveawayPanelMessage,
  setGiveawayResultMessage,
  addGiveawayParticipant,
  removeGiveawayParticipant,
  getGiveawayParticipants,
  countGiveawayParticipants,
  claimGiveawayFinalize,
  finishGiveaway,
  updateGiveawayWinners,
  // --- Yeni Mazeret sistemi ---
  createMazeretRecord,
  getMazeretById,
  getActiveMazerets,
  getActiveMazeretByUser,
  expireMazerets,
  endMazeret,
  upsertMazeretActivePanel,
  getMazeretActivePanel,
  deleteMazeretActivePanel,

};





/** Kullanıcının açık ticket'ı (duplicate engelleme için). */






/** Başvuru kararı kaydet (decision: 'accepted' | 'rejected'). */


// ---------- Ticket sahiplenme istatistikleri (sunucu bazlı, kalıcı) ----------

/**
 * Gerçek bir sahiplenmede +1. Sadece claim anında çağrılır (kapanışta ASLA).
 * Negatif olamaz (CHECK + clamp).
 */

/** En çok sahiplenenler: sayı azalan, eşitlikte userId artan (deterministik). */


// ---------- Kalıcı ayarlar (key-value) ----------

function getSetting(key) {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(String(key));
    return row ? String(row.value) : null;
  } catch (err) {
    logger.error(`[DB] getSetting failed: ${key}`, err);
    return null;
  }
}

function setSetting(key, value) {
  try {
    getDb()
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(String(key), String(value), Date.now());
  } catch (err) {
    logger.error(`[DB] setSetting failed: ${key}`, err);
    throw err;
  }
}

function deleteSetting(key) {
  try {
    getDb().prepare('DELETE FROM settings WHERE key = ?').run(String(key));
  } catch (err) {
    logger.error(`[DB] deleteSetting failed: ${key}`, err);
  }
}

// ---------- Ticket panel mesajı (sunucu başına tek) ----------




// ================= YENİ TICKET SİSTEMİ =================

/** Yeni ticket kaydı oluşturur (kanal henüz açılmamış, channel_id null). */
function createTicketSession({ guildId, ownerId, kind }) {
  try {
    const now = Date.now();
    const res = getDb()
      .prepare(
        `INSERT INTO ticket_sessions (guild_id, channel_id, owner_id, kind, status, created_at, updated_at)
         VALUES (?, NULL, ?, ?, 'open', ?, ?)`
      )
      .run(String(guildId), String(ownerId), String(kind), now, now);
    const id = Number(res.lastInsertRowid);
    return { id, guild_id: String(guildId), owner_id: String(ownerId), kind: String(kind), status: 'open', channel_id: null };
  } catch (err) {
    logger.error(`[DB] createTicketSession failed: ${guildId}/${ownerId}`, err);
    return null;
  }
}

function setTicketChannel(id, channelId) {
  try {
    getDb()
      .prepare('UPDATE ticket_sessions SET channel_id = ?, updated_at = ? WHERE id = ?')
      .run(String(channelId), Date.now(), Number(id));
    return true;
  } catch (err) {
    logger.error(`[DB] setTicketChannel failed: ${id}`, err);
    return false;
  }
}

/** Kanal ID'sinden ticket bulur (kanal adına güvenilmez). */
function getTicketByChannel(channelId) {
  try {
    if (!channelId) return null;
    return getDb().prepare('SELECT * FROM ticket_sessions WHERE channel_id = ?').get(String(channelId)) || null;
  } catch (err) {
    logger.error(`[DB] getTicketByChannel failed: ${channelId}`, err);
    return null;
  }
}

/** Kullanıcının hâlâ açık ticket'ı (yoksa null). */
function getOpenTicketByUser(guildId, userId) {
  try {
    return (
      getDb()
        .prepare(
          "SELECT * FROM ticket_sessions WHERE guild_id = ? AND owner_id = ? AND status = 'open' AND channel_id IS NOT NULL ORDER BY id DESC LIMIT 1"
        )
        .get(String(guildId), String(userId)) || null
    );
  } catch (err) {
    logger.error(`[DB] getOpenTicketByUser failed: ${guildId}/${userId}`, err);
    return null;
  }
}

/** Durum değiştirir (accepted / rejected / closed). */
function setTicketStatus(id, status, { actorId = null } = {}) {
  try {
    const now = Date.now();
    getDb()
      .prepare("UPDATE ticket_sessions SET status = ?, actor_id = COALESCE(?, actor_id), updated_at = ?, closed_at = CASE WHEN ? = 'closed' THEN ? ELSE closed_at END WHERE id = ?")
      .run(String(status), actorId ? String(actorId) : null, now, String(status), now, Number(id));
    return true;
  } catch (err) {
    logger.error(`[DB] setTicketStatus failed: ${id}`, err);
    return false;
  }
}

/** Kanal açılamadı gibi durumlarda kaydı kapatır (kanal silinmez). */
function endTicketSession(id, { reason = 'ended' } = {}) {
  try {
    const now = Date.now();
    getDb()
      .prepare("UPDATE ticket_sessions SET status = 'closed', updated_at = ?, closed_at = ? WHERE id = ?")
      .run(now, now, Number(id));
    logger.info(`[DB] ticket #${id} sonlandırıldı (${reason})`);
    return true;
  } catch (err) {
    logger.error(`[DB] endTicketSession failed: ${id}`, err);
    return false;
  }
}

/** Ana panel mesajını hatırlar. YALNIZCA /ticketkur yazar. */
function upsertTicketPanel(guildId, channelId, messageId) {
  try {
    getDb()
      .prepare(
        `INSERT INTO ticket_panel (guild_id, channel_id, message_id, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id,
           message_id = excluded.message_id, updated_at = excluded.updated_at`
      )
      .run(String(guildId), String(channelId), String(messageId), Date.now());
    return true;
  } catch (err) {
    logger.error(`[DB] upsertTicketPanel failed: ${guildId}`, err);
    return false;
  }
}

function getTicketPanel(guildId) {
  try {
    return getDb().prepare('SELECT * FROM ticket_panel WHERE guild_id = ?').get(String(guildId)) || null;
  } catch (err) {
    logger.error(`[DB] getTicketPanel failed: ${guildId}`, err);
    return null;
  }
}

function deleteTicketPanel(guildId) {
  try {
    getDb().prepare('DELETE FROM ticket_panel WHERE guild_id = ?').run(String(guildId));
    return true;
  } catch (err) {
    logger.error(`[DB] deleteTicketPanel failed: ${guildId}`, err);
    return false;
  }
}




// ---------- Quit takibi: rol snapshot + ayrılma kayıtları ----------

/** Üyenin rollerini anlık görüntüsüyle saklar (roles: [{id, name}]). */
function trackMemberRoles(guildId, userId, roles) {
  try {
    const clean = (roles || [])
      .filter((r) => r && r.id && String(r.id) !== String(guildId)) // @everyone hariç
      .map((r) => ({ id: String(r.id), name: String(r.name || 'Bilinmeyen rol').slice(0, 100) }))
      .slice(0, 50);
    getDb()
      .prepare(
        `INSERT INTO member_roles (guild_id, user_id, roles, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET roles = excluded.roles, updated_at = excluded.updated_at`,
      )
      .run(String(guildId), String(userId), JSON.stringify(clean), Date.now());
  } catch (err) {
    logger.error(`[DB] trackMemberRoles failed: ${guildId}/${userId}`, err);
  }
}

function getMemberRoles(guildId, userId) {
  try {
    const row = getDb().prepare('SELECT roles FROM member_roles WHERE guild_id = ? AND user_id = ?').get(String(guildId), String(userId));
    const arr = row ? JSON.parse(row.roles) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    logger.error(`[DB] getMemberRoles failed: ${guildId}/${userId}`, err);
    return [];
  }
}

function createQuitLog({ guildId, userId, userTag, channelId, roles }) {
  try {
    const res = getDb()
      .prepare(
        `INSERT INTO quit_logs (guild_id, user_id, user_tag, channel_id, roles, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        String(guildId),
        String(userId),
        userTag ? String(userTag).slice(0, 100) : null,
        String(channelId),
        JSON.stringify(roles || []),
        Date.now(),
      );
    return Number(res.lastInsertRowid);
  } catch (err) {
    logger.error(`[DB] createQuitLog failed: ${guildId}/${userId}`, err);
    throw err;
  }
}

function getQuitByPanel(panelMessageId) {
  try {
    return getDb().prepare('SELECT * FROM quit_logs WHERE panel_message_id = ?').get(String(panelMessageId)) || null;
  } catch (err) {
    logger.error(`[DB] getQuitByPanel failed: ${panelMessageId}`, err);
    return null;
  }
}

function setQuitPanel(id, panelMessageId) {
  try {
    getDb().prepare('UPDATE quit_logs SET panel_message_id = ? WHERE id = ?').run(String(panelMessageId), Number(id));
  } catch (err) {
    logger.error(`[DB] setQuitPanel failed: ${id}`, err);
  }
}

/** 90 günden eski quit kayıtlarını temizler. */
function pruneQuitLogs(guildId, maxAgeMs = 90 * 24 * 60 * 60 * 1000) {
  try {
    getDb().prepare('DELETE FROM quit_logs WHERE guild_id = ? AND created_at < ?').run(String(guildId), Date.now() - maxAgeMs);
  } catch (err) {
    logger.error(`[DB] pruneQuitLogs failed: ${guildId}`, err);
  }
}


/**
 * Yeni mazeret bildirimi kaydeder.
 * @param {object} p
 * @param {string} p.guildId
 * @param {string} p.userId mazeretli olan üye
 * @param {string} p.reason mazeret sebebi
 * @param {string} p.durationRaw kullanıcının yazdığı metin ("3 gün" gibi)
 * @param {number} p.durationMs hesaplanan gerçek süre (ms)
 * @param {boolean} p.durationGuess metin ayrıştırılamadıysa true (varsayılan uygulandı)
 * @param {string} p.reportedBy bildiren yetkili
 * @returns {{ok:boolean, record?:object, error?:string}}
 */


/**
 * Şu an geçerli mazereti olan üyeler (süresi dolmamış), en kısa süreden başlayarak.
 * Süresi geçmiş ama kapanmamış kayıtları yan etkide temizler.
 * @returns {Array<object>}
 */

/** Bir üyenin aktif mazeret kaydı (yoksa null). */

/**
 * Mazereti süre dolmadan bitirir.
 * @returns {{ok:boolean, record?:object, error?:string}}
 */

/** Süresi dolmuş kayıtları kapatır; kaç tane kapatıldığını döner. */

/** Panel mesajını hatırlar (kind: 'admin' = yetkili listesi, 'public' = herkesin paneli). */



// ---------- IC isim onay kayıtları ----------

function createIcRequest({ guildId, userId, channelId, requestMessageId, requestedText }) {
  try {
    const res = getDb()
      .prepare(
        `INSERT INTO ic_approvals (guild_id, user_id, channel_id, request_message_id, requested_text, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(String(guildId), String(userId), String(channelId), String(requestMessageId), String(requestedText || '').slice(0, 1000), Date.now());
    return Number(res.lastInsertRowid);
  } catch (err) {
    logger.error(`[DB] createIcRequest failed: ${guildId}/${userId}`, err);
    throw err;
  }
}

function getIcByPanel(panelMessageId) {
  try {
    return getDb().prepare('SELECT * FROM ic_approvals WHERE panel_message_id = ?').get(String(panelMessageId)) || null;
  } catch (err) {
    logger.error(`[DB] getIcByPanel failed: ${panelMessageId}`, err);
    return null;
  }
}

function getPendingIc(guildId, userId) {
  try {
    return (
      getDb()
        .prepare("SELECT * FROM ic_approvals WHERE guild_id = ? AND user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1")
        .get(String(guildId), String(userId)) || null
    );
  } catch (err) {
    logger.error(`[DB] getPendingIc failed: ${guildId}/${userId}`, err);
    return null;
  }
}

/** Kullanıcının en son onaylanmış IC ismi (yoksa null). Başvuru kabulünde IC İSİM buradan alınır. */
function getApprovedIc(guildId, userId) {
  try {
    return (
      getDb()
        .prepare("SELECT * FROM ic_approvals WHERE guild_id = ? AND user_id = ? AND status = 'approved' ORDER BY decided_at DESC, id DESC LIMIT 1")
        .get(String(guildId), String(userId)) || null
    );
  } catch (err) {
    logger.error(`[DB] getApprovedIc failed: ${guildId}/${userId}`, err);
    return null;
  }
}

function setIcPanel(id, panelMessageId) {
  try {
    getDb().prepare('UPDATE ic_approvals SET panel_message_id = ? WHERE id = ?').run(String(panelMessageId), Number(id));
  } catch (err) {
    logger.error(`[DB] setIcPanel failed: ${id}`, err);
  }
}
// ---------- YENİ MAZERET SİSTEMİ ----------

/**
 * Yeni mazeret kaydı oluşturur.
 * Aynı kullanıcının ikinci bir AKTİF mazereti veritabanı seviyesinde engellenir
 * (uq_mazeret_one_active kısmi benzersiz indexi) — eş zamanlı isteklerde bile duplicate oluşmaz.
 * @returns {{ok:true, record:object}|{ok:false, error:string}}
 */
function createMazeretRecord({ guildId, userId, reason, durationRaw, durationMs, reportedBy }) {
  const db = getDb();
  const gid = String(guildId);
  const uid = String(userId);
  const ms = Math.round(Number(durationMs));
  const sebep = String(reason || "").trim().slice(0, 500);
  if (!Number.isFinite(ms) || ms <= 0) return { ok: false, error: "gecersiz_sure" };
  if (!sebep) return { ok: false, error: "sebep_bos" };

  const now = Date.now();
  // SÜRE BAŞLANGIÇTAN HESAPLANIR (started_at + duration_ms = expires_at).
  const startedAt = now;
  const expiresAt = startedAt + ms;

  try {
    const res = db.prepare(
      `INSERT INTO mazeret_records
         (guild_id, user_id, reason, duration_raw, duration_ms, duration_guess,
          created_at, started_at, expires_at, reported_by, active)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1)`
    ).run(gid, uid, sebep, String(durationRaw || "").slice(0, 100), ms, now, startedAt, expiresAt, String(reportedBy || uid));
    const record = getMazeretById(Number(res.lastInsertRowid));
    if (!record) return { ok: false, error: "kayit_okunamadi" };
    return { ok: true, record };
  } catch (err) {
    // Kısmi benzersizlik ihlali: kullanıcının zaten AKTİF mazereti var.
    // SQLite hata metni index adını değil KOLON adlarını verir:
    //   'UNIQUE constraint failed: mazeret_records.guild_id, mazeret_records.user_id'
    // Bu yüzden mesaja bakmak yerine KAYDEDEN SONRA doğrularız: kullanıcının gerçekten
    // aktif mazereti var mı? Varsa "already_active", değilse gerçek DB hatası.
    const benzersiz =
      err?.errcode === 2067 || err?.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/i.test(String(err?.message || ''));
    if (benzersiz || /uq_mazeret_one_active/i.test(String(err?.message || ''))) {
      const varOlan = getActiveMazeretByUser(guildId, userId);
      if (varOlan) {
        logger.info(`[DB] mazeret: ${uid} için ikinci aktif kayıt engellendi (tek-aktif kısıtı)`);
        return { ok: false, error: 'already_active' };
      }
    }
    logger.error(`[DB] createMazeretRecord failed: ${gid}/${uid}`, err);
    return { ok: false, error: "db_hatasi" };
  }
}

function getMazeretById(id) {
  try {
    return getDb().prepare('SELECT * FROM mazeret_records WHERE id = ?').get(Number(id)) || null;
  } catch (err) {
    logger.error(`[DB] getMazeretById failed: ${id}`, err);
    return null;
  }
}

/**
 * Aktif mazeretler. KRİTİK: süresi dolmuş kayıtlar "aktif" sayılmaz.
 * Bu sorgu KALICI zaman damgalarına bakar — RAM timer'ı ya da restart etkisi yoktur.
 */
function getActiveMazerets(guildId, now = Date.now()) {
  try {
    return getDb()
      .prepare(
        "SELECT * FROM mazeret_records WHERE guild_id = ? AND active = 1 AND expires_at > ? ORDER BY expires_at ASC, id ASC"
      )
      .all(String(guildId), Number(now));
  } catch (err) {
    logger.error(`[DB] getActiveMazerets failed: ${guildId}`, err);
    return [];
  }
}

/** Bir üyenin hâlâ geçerli mazereti (yoksa null). */
function getActiveMazeretByUser(guildId, userId, now = Date.now()) {
  try {
    return (
      getDb()
        .prepare(
          "SELECT * FROM mazeret_records WHERE guild_id = ? AND user_id = ? AND active = 1 AND expires_at > ? ORDER BY expires_at DESC LIMIT 1"
        )
        .get(String(guildId), String(userId), Number(now)) || null
    );
  } catch (err) {
    logger.error(`[DB] getActiveMazeretByUser failed: ${guildId}/${userId}`, err);
    return null;
  }
}

/**
 * Süresi dolmuş kayıtları kapatır (geçmiş KALIR, silinmez).
 * @returns {number} kapatılan kayıt sayısı
 */
function expireMazerets(guildId, now = Date.now()) {
  try {
    const r = getDb()
      .prepare(
        "UPDATE mazeret_records SET active = 0, ended_at = ?, end_reason = 'expired' WHERE guild_id = ? AND active = 1 AND expires_at <= ?"
      )
      .run(Number(now), String(guildId), Number(now));
    return Number(r.changes || 0);
  } catch (err) {
    logger.error(`[DB] expireMazerets failed: ${guildId}`, err);
    return 0;
  }
}

/** Mazeret erken/normal şekilde kapatılır (geçmiş kayıt olarak kalır). */
function endMazeret(guildId, userId, endedBy, reason = "manual", now = Date.now()) {
  try {
    const r = getDb()
      .prepare(
        "UPDATE mazeret_records SET active = 0, ended_at = ?, ended_by = ?, end_reason = ? WHERE guild_id = ? AND user_id = ? AND active = 1"
      )
      .run(Number(now), endedBy ? String(endedBy) : null, String(reason).slice(0, 40), String(guildId), String(userId));
    return Number(r.changes || 0) > 0;
  } catch (err) {
    logger.error(`[DB] endMazeret failed: ${guildId}/${userId}`, err);
    return false;
  }
}

/**
 * Panel mesajı kaydı. kind: "public" = bildirim paneli, "central" = aktif liste.
 * Bot açılışında bu kayda DOKUNULMAZ (panel otomatik gönderilmez).
 */
function upsertMazeretActivePanel(guildId, kind, channelId, messageId) {
  try {
    getDb()
      .prepare(
        `INSERT INTO mazeret_active_panels (guild_id, kind, channel_id, message_id, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, kind) DO UPDATE SET
           channel_id = excluded.channel_id, message_id = excluded.message_id,
           updated_at = excluded.updated_at`
      )
      .run(String(guildId), String(kind), String(channelId), String(messageId), Date.now());
    return true;
  } catch (err) {
    logger.error(`[DB] upsertMazeretActivePanel failed: ${guildId}/${kind}`, err);
    return false;
  }
}

function getMazeretActivePanel(guildId, kind) {
  try {
    return getDb().prepare("SELECT * FROM mazeret_active_panels WHERE guild_id = ? AND kind = ?").get(String(guildId), String(kind)) || null;
  } catch (err) {
    logger.error(`[DB] getMazeretActivePanel failed: ${guildId}/${kind}`, err);
    return null;
  }
}

function deleteMazeretActivePanel(guildId, kind) {
  try {
    getDb().prepare("DELETE FROM mazeret_active_panels WHERE guild_id = ? AND kind = ?").run(String(guildId), String(kind));
    return true;
  } catch (err) {
    logger.error(`[DB] deleteMazeretActivePanel failed: ${guildId}/${kind}`, err);
    return false;
  }
}


function decideIc(panelMessageId, status, decidedBy) {
  try {
    getDb()
      .prepare("UPDATE ic_approvals SET status = ?, decided_by = ?, decided_at = ? WHERE panel_message_id = ? AND status = 'pending'")
      .run(status, decidedBy ? String(decidedBy) : null, Date.now(), String(panelMessageId));
  } catch (err) {
    logger.error(`[DB] decideIc failed: ${panelMessageId}`, err);
    throw err;
  }
}

// ---------- Ticket log mesajı (tek-mesaj logu için) ----------


// ---------- Guard whitelist + ayarlar ----------

function getGuardLevel(guildId, userId) {
  try {
    const row = getDb().prepare('SELECT level FROM guard_whitelist WHERE guild_id = ? AND user_id = ?').get(String(guildId), String(userId));
    const lvl = Number(row?.level || 0);
    return lvl >= 1 && lvl <= 4 ? lvl : 0;
  } catch (err) {
    logger.error(`[DB] getGuardLevel failed: ${guildId}/${userId}`, err);
    return 0;
  }
}

function setGuardLevel(guildId, userId, level, addedBy) {
  try {
    const now = Date.now();
    const exists = getDb().prepare('SELECT 1 FROM guard_whitelist WHERE guild_id = ? AND user_id = ?').get(String(guildId), String(userId));
    getDb()
      .prepare(
        'INSERT INTO guard_whitelist (guild_id, user_id, level, added_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(guild_id, user_id) DO UPDATE SET level = excluded.level, added_by = excluded.added_by, updated_at = excluded.updated_at',
      )
      .run(String(guildId), String(userId), Number(level), addedBy ? String(addedBy) : null, now, now);
    return { created: !exists };
  } catch (err) {
    logger.error(`[DB] setGuardLevel failed: ${guildId}/${userId}`, err);
    throw err;
  }
}

function removeGuard(guildId, userId) {
  try {
    const res = getDb().prepare('DELETE FROM guard_whitelist WHERE guild_id = ? AND user_id = ?').run(String(guildId), String(userId));
    return Number(res.changes) > 0;
  } catch (err) {
    logger.error(`[DB] removeGuard failed: ${guildId}/${userId}`, err);
    return false;
  }
}

function listWhitelist(guildId) {
  try {
    return getDb().prepare('SELECT * FROM guard_whitelist WHERE guild_id = ? ORDER BY level DESC, created_at ASC').all(String(guildId));
  } catch (err) {
    logger.error(`[DB] listWhitelist failed: ${guildId}`, err);
    return [];
  }
}

function getGuardSettings(guildId) {
  try {
    const row = getDb().prepare('SELECT * FROM guard_settings WHERE guild_id = ?').get(String(guildId));
    return row ? { guild_id: String(row.guild_id), log_channel_id: row.log_channel_id ? String(row.log_channel_id) : null, enabled: Number(row.enabled) === 1 } : null;
  } catch (err) {
    logger.error(`[DB] getGuardSettings failed: ${guildId}`, err);
    return null;
  }
}

function saveGuardSettings(guildId, opts) {
  try {
    const o = opts || {};
    getDb()
      .prepare(
        'INSERT INTO guard_settings (guild_id, log_channel_id, enabled, updated_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(guild_id) DO UPDATE SET log_channel_id = excluded.log_channel_id, enabled = excluded.enabled, updated_at = excluded.updated_at',
      )
      .run(String(guildId), o.logChannelId ? String(o.logChannelId) : null, o.enabled ? 1 : 0, Date.now());
  } catch (err) {
    logger.error(`[DB] saveGuardSettings failed: ${guildId}`, err);
    throw err;
  }
}

function countGuardGuilds() {
  try {
    const row = getDb().prepare('SELECT COUNT(*) AS c FROM guard_settings WHERE enabled = 1').get();
    return Number(row?.c || 0);
  } catch (err) {
    logger.error('[DB] countGuardGuilds failed.', err);
    return 0;
  }
}

// ---------- Yeni log mimarisi: kanal tipi -> kanal ID kayıtları ----------

/** Sunucunun kayıtlı log kanal eşlemesi: { role: '123', channel: '456', ... } */
function getGuardLogChannels(guildId) {
  try {
    const rows = getDb().prepare('SELECT log_type, channel_id FROM guard_log_channels WHERE guild_id = ?').all(String(guildId));
    const out = {};
    for (const r of rows) out[String(r.log_type)] = String(r.channel_id);
    return out;
  } catch (err) {
    logger.error(`[DB] getGuardLogChannels failed: ${guildId}`, err);
    return {};
  }
}

/** Tek log tipinin kanal ID'si (yoksa null). */
function getGuardLogChannel(guildId, logType) {
  try {
    const row = getDb()
      .prepare('SELECT channel_id FROM guard_log_channels WHERE guild_id = ? AND log_type = ?')
      .get(String(guildId), String(logType));
    return row ? String(row.channel_id) : null;
  } catch (err) {
    logger.error(`[DB] getGuardLogChannel failed: ${guildId}/${logType}`, err);
    return null;
  }
}

/**
 * Log kanal kaydı yaz (upsert).
 * @param {string} guildId
 * @param {string} logType  - constants.LOG_CHANNELS içindeki key
 * @param {string} channelId
 * @param {string|null} categoryId
 */
function setGuardLogChannel(guildId, logType, channelId, categoryId = null) {
  try {
    const now = Date.now();
    getDb()
      .prepare(
        'INSERT INTO guard_log_channels (guild_id, log_type, channel_id, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(guild_id, log_type) DO UPDATE SET channel_id = excluded.channel_id, category_id = excluded.category_id, updated_at = excluded.updated_at',
      )
      .run(String(guildId), String(logType), String(channelId), categoryId ? String(categoryId) : null, now, now);
  } catch (err) {
    logger.error(`[DB] setGuardLogChannel failed: ${guildId}/${logType}`, err);
    throw err;
  }
}

/** Kayıtlı log kanalını sil (kanal Discord'da silinmişse temizlik için). */
function deleteGuardLogChannel(guildId, logType) {
  try {
    getDb()
      .prepare('DELETE FROM guard_log_channels WHERE guild_id = ? AND log_type = ?')
      .run(String(guildId), String(logType));
  } catch (err) {
    logger.error(`[DB] deleteGuardLogChannel failed: ${guildId}/${logType}`, err);
  }
}

/** Sunucudaki toplam log kanalı sayısı (health/rapor için). */
function countGuardLogChannels(guildId) {
  try {
    const row = getDb().prepare('SELECT COUNT(*) AS c FROM guard_log_channels WHERE guild_id = ?').get(String(guildId));
    return Number(row?.c || 0);
  } catch (err) {
    logger.error(`[DB] countGuardLogChannels failed: ${guildId}`, err);
    return 0;
  }
}

// ===================== TRANSCRIPT DATABASE FUNCTIONS =====================

function generateSecureToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function generateTranscriptId() {
  return 'tr_' + crypto.randomBytes(16).toString('base64url');
}

function createTranscript({
  guildId,
  channelId,
  ticketId,
  ticketOwnerId,
  claimedById,
  closedById,
  messageCount = 0,
  userCount = 0,
  attachmentCount = 0,
  imageCount = 0,
  videoCount = 0,
  fileCount = 0,
  webUrl = null,
  expiresAt = null,
}) {
  try {
    const transcriptId = generateTranscriptId();
    const token = generateSecureToken(24);
    const now = Date.now();

    getDb()
      .prepare(
        `INSERT INTO transcripts (
          transcript_id, guild_id, channel_id, ticket_id, ticket_owner_id, claimed_by_id, closed_by_id,
          message_count, user_count, attachment_count, image_count, video_count, file_count,
          token, created_at, closed_at, expires_at, web_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        transcriptId,
        String(guildId),
        String(channelId),
        Number(ticketId),
        String(ticketOwnerId),
        claimedById ? String(claimedById) : null,
        closedById ? String(closedById) : null,
        Number(messageCount),
        Number(userCount),
        Number(attachmentCount),
        Number(imageCount),
        Number(videoCount),
        Number(fileCount),
        token,
        now,
        now,
        expiresAt ? Number(expiresAt) : null,
        webUrl ? String(webUrl) : null,
      );

    return { transcriptId, token };
  } catch (err) {
    logger.error(`[DB] createTranscript failed: ${ticketId}`, err);
    throw err;
  }
}

function getTranscriptById(transcriptId) {
  try {
    return getDb().prepare('SELECT * FROM transcripts WHERE transcript_id = ?').get(String(transcriptId)) || null;
  } catch (err) {
    logger.error(`[DB] getTranscriptById failed: ${transcriptId}`, err);
    return null;
  }
}

function getTranscriptByToken(token) {
  try {
    return getDb().prepare('SELECT * FROM transcripts WHERE token = ?').get(String(token)) || null;
  } catch (err) {
    logger.error(`[DB] getTranscriptByToken failed`, err);
    return null;
  }
}

function getTranscriptByTicketId(ticketId) {
  try {
    return getDb().prepare('SELECT * FROM transcripts WHERE ticket_id = ?').get(Number(ticketId)) || null;
  } catch (err) {
    logger.error(`[DB] getTranscriptByTicketId failed: ${ticketId}`, err);
    return null;
  }
}

function getTranscriptMessages(transcriptId, options = {}) {
  try {
    const { limit = 5000, offset = 0, userId = null, before = null, after = null } = options;
    let sql = 'SELECT * FROM transcript_messages WHERE transcript_id = ?';
    const params = [String(transcriptId)];

    if (userId) {
      sql += ' AND user_id = ?';
      params.push(String(userId));
    }
    if (before) {
      sql += ' AND created_at < ?';
      params.push(Number(before));
    }
    if (after) {
      sql += ' AND created_at > ?';
      params.push(Number(after));
    }

    sql += ' ORDER BY created_at ASC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    return getDb().prepare(sql).all(...params);
  } catch (err) {
    logger.error(`[DB] getTranscriptMessages failed: ${transcriptId}`, err);
    return [];
  }
}

function getTranscriptUsers(transcriptId) {
  try {
    return getDb()
      .prepare('SELECT * FROM transcript_users WHERE transcript_id = ? ORDER BY message_count DESC')
      .all(String(transcriptId));
  } catch (err) {
    logger.error(`[DB] getTranscriptUsers failed: ${transcriptId}`, err);
    return [];
  }
}

function getTranscriptAttachments(transcriptId) {
  try {
    return getDb()
      .prepare('SELECT * FROM transcript_attachments WHERE transcript_id = ? ORDER BY created_at ASC')
      .all(String(transcriptId));
  } catch (err) {
    logger.error(`[DB] getTranscriptAttachments failed: ${transcriptId}`, err);
    return [];
  }
}

function updateTranscriptStatus(transcriptId, status) {
  try {
    getDb().prepare('UPDATE transcripts SET status = ? WHERE transcript_id = ?').run(String(status), String(transcriptId));
  } catch (err) {
    logger.error(`[DB] updateTranscriptStatus failed: ${transcriptId}`, err);
  }
}

function deleteTranscript(transcriptId) {
  try {
    getDb().prepare('DELETE FROM transcripts WHERE transcript_id = ?').run(String(transcriptId));
  } catch (err) {
    logger.error(`[DB] deleteTranscript failed: ${transcriptId}`, err);
  }
}

function listTranscriptsByGuild(guildId, options = {}) {
  try {
    const { limit = 50, offset = 0, status = null } = options;
    let sql = 'SELECT * FROM transcripts WHERE guild_id = ?';
    const params = [String(guildId)];

    if (status) {
      sql += ' AND status = ?';
      params.push(String(status));
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    return getDb().prepare(sql).all(...params);
  } catch (err) {
    logger.error(`[DB] listTranscriptsByGuild failed: ${guildId}`, err);
    return [];
  }
}

// ---------- Çekiliş kayıtları ----------

function createGiveaway({ guildId, channelId, prize, durationSec, endAt, winnerCount, maxParticipants, requiredRoleId, hostId }) {
  try {
    const res = getDb()
      .prepare(
        `INSERT INTO giveaways (guild_id, channel_id, panel_message_id, prize, duration_sec, end_at, winner_count, max_participants, required_role_id, host_id, status, winners, excluded, result_message_id, created_at, ended_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'active', '[]', '[]', NULL, ?, NULL)`,
      )
      .run(
        String(guildId),
        String(channelId),
        String(prize).slice(0, 200),
        Number(durationSec),
        Number(endAt),
        Math.max(1, Number(winnerCount) || 1),
        Math.max(0, Number(maxParticipants) || 0),
        requiredRoleId ? String(requiredRoleId) : null,
        String(hostId),
        Date.now(),
      );
    return Number(res.lastInsertRowid);
  } catch (err) {
    logger.error(`[DB] createGiveaway failed: ${guildId}`, err);
    throw err;
  }
}

function getGiveaway(id) {
  try {
    return getDb().prepare('SELECT * FROM giveaways WHERE id = ?').get(Number(id)) || null;
  } catch (err) {
    logger.error(`[DB] getGiveaway failed: ${id}`, err);
    return null;
  }
}

/** Panel mesaj ID'sinden çekilişi bul (reaksiyon/buton çözümleme için). */
function getGiveawayByMessage(messageId) {
  try {
    return (
      getDb().prepare("SELECT * FROM giveaways WHERE panel_message_id = ? AND status IN ('active', 'ending')").get(String(messageId)) ||
      null
    );
  } catch (err) {
    logger.error(`[DB] getGiveawayByMessage failed: ${messageId}`, err);
    return null;
  }
}

function getActiveGiveaways() {
  try {
    return getDb().prepare("SELECT * FROM giveaways WHERE status = 'active' ORDER BY end_at ASC").all();
  } catch (err) {
    logger.error('[DB] getActiveGiveaways failed.', err);
    return [];
  }
}

function setGiveawayPanelMessage(id, panelMessageId) {
  try {
    getDb().prepare('UPDATE giveaways SET panel_message_id = ? WHERE id = ?').run(String(panelMessageId), Number(id));
  } catch (err) {
    logger.error(`[DB] setGiveawayPanelMessage failed: ${id}`, err);
  }
}

function setGiveawayResultMessage(id, resultMessageId) {
  try {
    getDb().prepare('UPDATE giveaways SET result_message_id = ? WHERE id = ?').run(String(resultMessageId), Number(id));
  } catch (err) {
    logger.error(`[DB] setGiveawayResultMessage failed: ${id}`, err);
  }
}

/**
 * Katılımcı ekler. Dönüş: { added: boolean, count: number }.
 * INSERT OR IGNORE sayesinde aynı kullanıcı iki kez sayılmaz.
 */
function addGiveawayParticipant(giveawayId, userId) {
  try {
    const db = getDb();
    const res = db
      .prepare('INSERT OR IGNORE INTO giveaway_participants (giveaway_id, user_id, joined_at) VALUES (?, ?, ?)')
      .run(Number(giveawayId), String(userId), Date.now());
    const row = db.prepare('SELECT COUNT(*) AS c FROM giveaway_participants WHERE giveaway_id = ?').get(Number(giveawayId));
    return { added: Number(res.changes) > 0, count: Number(row?.c || 0) };
  } catch (err) {
    logger.error(`[DB] addGiveawayParticipant failed: ${giveawayId}/${userId}`, err);
    throw err;
  }
}

function removeGiveawayParticipant(giveawayId, userId) {
  try {
    const db = getDb();
    const res = db.prepare('DELETE FROM giveaway_participants WHERE giveaway_id = ? AND user_id = ?').run(Number(giveawayId), String(userId));
    const row = db.prepare('SELECT COUNT(*) AS c FROM giveaway_participants WHERE giveaway_id = ?').get(Number(giveawayId));
    return { removed: Number(res.changes) > 0, count: Number(row?.c || 0) };
  } catch (err) {
    logger.error(`[DB] removeGiveawayParticipant failed: ${giveawayId}/${userId}`, err);
    throw err;
  }
}

function getGiveawayParticipants(giveawayId) {
  try {
    return getDb()
      .prepare('SELECT user_id FROM giveaway_participants WHERE giveaway_id = ? ORDER BY joined_at ASC')
      .all(Number(giveawayId))
      .map((r) => String(r.user_id));
  } catch (err) {
    logger.error(`[DB] getGiveawayParticipants failed: ${giveawayId}`, err);
    return [];
  }
}

function countGiveawayParticipants(giveawayId) {
  try {
    const row = getDb().prepare('SELECT COUNT(*) AS c FROM giveaway_participants WHERE giveaway_id = ?').get(Number(giveawayId));
    return Number(row?.c || 0);
  } catch (err) {
    logger.error(`[DB] countGiveawayParticipants failed: ${giveawayId}`, err);
    return 0;
  }
}

/**
 * Sonuçlandırmayı sahiplen (çift finalize engeli).
 * Sadece status='active' ise 'ending' yapar. Dönüş: true = kilit alındı.
 */
function claimGiveawayFinalize(id) {
  try {
    const res = getDb().prepare("UPDATE giveaways SET status = 'ending' WHERE id = ? AND status = 'active'").run(Number(id));
    return Number(res.changes) > 0;
  } catch (err) {
    logger.error(`[DB] claimGiveawayFinalize failed: ${id}`, err);
    return false;
  }
}

function finishGiveaway(id, winners, excluded) {
  try {
    getDb()
      .prepare("UPDATE giveaways SET status = 'ended', winners = ?, excluded = ?, ended_at = ? WHERE id = ?")
      .run(JSON.stringify(winners || []), JSON.stringify(excluded || []), Date.now(), Number(id));
  } catch (err) {
    logger.error(`[DB] finishGiveaway failed: ${id}`, err);
    throw err;
  }
}

function updateGiveawayWinners(id, winners, excluded) {
  try {
    getDb()
      .prepare('UPDATE giveaways SET winners = ?, excluded = ? WHERE id = ?')
      .run(JSON.stringify(winners || []), JSON.stringify(excluded || []), Number(id));
  } catch (err) {
    logger.error(`[DB] updateGiveawayWinners failed: ${id}`, err);
    throw err;
  }
}
