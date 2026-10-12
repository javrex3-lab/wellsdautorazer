/**
 * Internal-action tracking: botun kendi Guard işlemleri (rollback/ban) yeni bir
 * saldırı olarak algılanmamalı. Kısa ömürlü bellek içi kayıt (TTL'li).
 */
const { TRACK_TTL_MS } = require('./constants');
const { AuditLogEvent } = require('discord.js');

const recent = new Map(); // `${guildId}:${auditType}:${targetId}` -> { exp, reason }

/**
 * Audit tipini her zaman SAYISALA normalize eder.
 *
 * Neden: markBotAction bir yerde sayısal (AuditLogEvent.ChannelCreate = 10),
 * başka bir yerde string ('CHANNEL_CREATE') geçilirse anahtarlar TUTMAZ ve
 * guard botun kendi işlemini saldırı sanıp geri alır. Bu sessizce ticket
 * kanalının açılıp anında silinmesine yol açmıştı. Normalizasyon iki tarafı
 * da aynı biçime getirir; yanlış string yazılsa bile eşleşme korunur.
 */
const STRING_ALIASES = new Map(
  Object.entries(AuditLogEvent)
    .map(([name, value]) => [String(name).toUpperCase(), Number(value)])
    .filter(([, v]) => Number.isFinite(v)),
);

function normalizeAuditType(auditType) {
  if (typeof auditType === 'number' && Number.isFinite(auditType)) return auditType;
  if (typeof auditType === 'string') {
    const n = Number(auditType);
    if (Number.isFinite(n)) return n;
    const alias = STRING_ALIASES.get(auditType.toUpperCase());
    if (alias !== undefined) return alias;
  }
  return auditType;
}

function keyOf(guildId, auditType, targetId) {
  return `${guildId}:${normalizeAuditType(auditType)}:${targetId}`;
}

function sweep() {
  const now = Date.now();
  for (const [k, v] of recent) {
    if (!v || v.exp <= now) recent.delete(k);
  }
  if (recent.size > 500) {
    // taşmaya karşı en eskileri buda
    const sorted = [...recent.entries()].sort((a, b) => a[1].exp - b[1].exp);
    for (const [k] of sorted.slice(0, recent.size - 500)) recent.delete(k);
  }
}

function markBotAction(guildId, auditType, targetId, reason = '') {
  try {
    recent.set(keyOf(guildId, auditType, targetId), { exp: Date.now() + TRACK_TTL_MS, reason: String(reason || '') });
    if (recent.size % 50 === 0 || recent.size > 500) sweep();
  } catch {
    /* takip kritik değil */
  }
}

function isBotAction(guildId, auditType, targetId) {
  try {
    const rec = recent.get(keyOf(guildId, auditType, targetId));
    if (!rec) return false;
    if (rec.exp <= Date.now()) {
      recent.delete(keyOf(guildId, auditType, targetId));
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = { markBotAction, isBotAction, normalizeAuditType, _recent: recent };
