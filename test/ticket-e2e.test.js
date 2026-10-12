/**
 * TICKET UÇTAN UCA TESTLERİ — GERÇEK Discord sunucusunda.
 *
 * ⚠️ DİKKAT: Bu testler GERÇEKTEN ticket kanalı AÇAR ve Ticket Manager
 * rolünü ETİKETLER. Varsayılan olarak ATLANIR (skip = başarı sayılmaz).
 * Çalıştırmak için:  $env:TICKET_E2E="1"; node --test test/ticket-e2e.test.js
 *
 * Kapsam (ticketHandler.js createTicketFromSelect gerçek yolu):
 *   1. Başvuru / Şikayet / Diğer ticket'ları doğru kategoride açılıyor
 *   2. Parent gerçekten GuildCategory
 *   3. @everyone göremiyor, sahip ve yetkili görebiliyor/yazabiliyor
 *   4. Ping rolü GERÇEK mention olarak etiketleniyor (bir kez)
 *   5. Rol aynı ticket için tekrar etiketlenmiyor
 *   6. Karşılama embed'i + Ticketi Sahiplen / Kapat butonları korunmuş
 *   7. DB kaydı doğru (guild, kanal, kategori)
 *   8. Butonlar çalışıyor: Sahiplen → Kapat(onay) → İptal → Kapat(kesin)
 *   9. Transcript sistemi çalışıyor (mesaj + kullanıcı satırları yazılıyor)
 *  10. Test sonunda tüm kanallar ve kayıtlar temizleniyor
 */
const test = require('node:test');
const assert = require('node:assert');
const { Client, GatewayIntentBits, Partials, ChannelType, PermissionsBitField } = require('discord.js');

const config = require('../src/config');
const db = require('../src/database/database');
const { createTicketFromSelect, handleTicketButton } = require('../src/handlers/ticketHandler');

const ACIK = process.env.TICKET_E2E === '1';
const O = { skip: ACIK ? false : 'TICKET_E2E=1 ile açılır (gerçek kanal açar + rol etiketler)' };
const TEST_USER = '1056585742731726918';
const KATEGORILER = ['basvuru', 'sikayet', 'diger'];

/** Builder nesnelerinden buton customId'lerini çıkarır. */
function btnIds(payload) {
  return (payload?.components || [])
    .map((r) => (typeof r.toJSON === 'function' ? r.toJSON() : r))
    .flatMap((r) => r.components || [])
    .map((b) => b.custom_id ?? b.customId);
}

function fakeSelect(guild, client, user, categoryKey) {
  return {
    guild,
    guildId: guild.id,
    client,
    user,
    member: { user, permissions: new PermissionsBitField(8n) },
    deferred: false,
    replied: false,
    state: [],
    async deferReply() { this.deferred = true; },
    async editReply(p) { this.state.push(p); return p; },
    async reply(p) { this.state.push(p); return p; },
  };
}

function fakeButton({ guild, client, user, customId, message, channel }) {
  return {
    guild,
    guildId: guild.id,
    client,
    channel,
    channelId: channel.id,
    message,
    user,
    member: { user, permissions: new PermissionsBitField(8n) },
    customId,
    state: [],
    deferred: false,
    replied: false,
    async deferReply() { this.deferred = true; },
    async deferUpdate() { this.deferred = true; },
    async update(p) { await message.edit(p); return p; },
    async editReply(p) { this.state.push(p); return p; },
    async reply(p) { this.state.push(p); this.replied = true; return p; },
    async followUp(p) { this.state.push(p); return p; },
    isRepliable() { return true; },
  };
}

/** Ortak kurulum: botu bağla, sunucuyu getir, DB'yi aç. */
async function setup(t) {
  db.initDatabase();
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember],
  });
  await client.login(config.token);
  const guild = client.guilds.cache.get(config.guildId);
  await guild.members.fetch();
  const user = client.users.cache.get(TEST_USER);

  t.after(async () => {
    db.closeDatabase();
    client.destroy();
  });
  return { client, guild, user };
}

/** Önceki açık test ticket'ını temizle (kullanıcı başına 1 açık ticket sınırı var). */
async function temizleOnceki(guild) {
  const o = db.getOpenTicket(guild.id, TEST_USER);
  if (!o) return;
  await guild.channels.delete(o.channel_id, 'E2E ön temizlik').catch(() => {});
  db.deleteTicket(o.id);
}

/* ================================================================== */
/* 1-7: Oluşturma akışı — üç kategori + rol etiketi + izinler         */
/* ================================================================== */

for (const key of KATEGORILER) {
  test(`T-${key}: ticket doğru kategoride açılıyor, rol etiketleniyor`, O, async (t) => {
    const { client, guild, user } = await setup(t);
    await temizleOnceki(guild);

    const ix = fakeSelect(guild, client, user, key);
    await createTicketFromSelect(ix, key);

    const son = ix.state[ix.state.length - 1];
    const chId = son?.content?.match(/<#(\d+)>/)?.[1];
    assert.ok(chId, 'ticket kanalı oluşmadı: ' + JSON.stringify(son).slice(0, 160));

    const ch = await guild.channels.fetch(chId);
    const parent = await guild.channels.fetch(ch.parentId);

    // --- Kategori ---
    assert.equal(String(ch.parentId), String(config.ticket.categoryId), 'yanlış kategoride açıldı');
    assert.equal(parent.type, ChannelType.GuildCategory, 'parent GuildCategory değil');

    // --- İzinler ---
    const ovs = new Map(ch.permissionOverwrites.cache.map((o) => [o.id, o]));
    assert.ok(ovs.get(guild.id)?.deny?.has('ViewChannel'), '@everyone görebiliyor (güvenlik açığı)');
    const oo = ovs.get(TEST_USER)?.allow;
    assert.ok(oo?.has('ViewChannel') && oo?.has('SendMessages'), 'sahip yazamıyor');
    const so = ovs.get(config.ticket.staffRoleId)?.allow;
    assert.ok(so?.has('ViewChannel') && so?.has('SendMessages'), 'yetkili rolü yazamıyor');

    // --- Rol etiketi ---
    const msgs = await ch.messages.fetch({ limit: 20 });
    const pingliler = [...msgs.values()].filter((m) => m.content?.includes(`<@&${config.ticket.pingRoleId}>`));
    assert.equal(pingliler.length, 1, `rol ${pingliler.length} mesajda etiketlenmiş (1 olmalı)`);
    // Gerçek mention mı (metin değil)
    assert.ok(pingliler[0].mentions.roles.get(config.ticket.pingRoleId), 'rol mention olarak çözülmedi');
    assert.equal(pingliler[0].mentions.roles.get(config.ticket.pingRoleId).id, config.ticket.pingRoleId);

    // --- Panel + butonlar korunmuş ---
    const rec = db.getTicketByChannel(chId);
    assert.equal(rec.category_key, key, 'DB kategori yanlış');
    assert.equal(String(rec.user_id), TEST_USER, 'DB sahibi yanlış');
    const panel = await ch.messages.fetch(rec.panel_message_id);
    assert.ok(panel.embeds?.[0], 'karşılama embed\'i yok');
    const b = btnIds(panel);
    assert.ok(b.includes('ticket_claim'), 'Sahiplen butonu yok: ' + b.join(','));
    assert.ok(b.includes('ticket_close'), 'Kapat butonu yok: ' + b.join(','));

    // --- Temizlik ---
    db.deleteTicket(rec.id);
    await guild.channels.delete(chId, 'E2E bitti').catch(() => {});
  });
}

/* ================================================================== */
/* 8-9: Butonlar + transcript                                         */
/* ================================================================== */

test('T-btn: Sahiplen / Kapat / İptal / Kapat akışı + transcript', O, async (t) => {
  const { client, guild, user } = await setup(t);
  await temizleOnceki(guild);

  const ix = fakeSelect(guild, client, user, 'sikayet');
  await createTicketFromSelect(ix, 'sikayet');
  const chId = ix.state[ix.state.length - 1].content.match(/<#(\d+)>/)?.[1];
  assert.ok(chId, 'ticket açılamadı');
  const ch = await guild.channels.fetch(chId);
  let rec = db.getTicketByChannel(chId);
  const panel = await ch.messages.fetch(rec.panel_message_id);

  /* --- Ticketi Sahiplen --- */
  await handleTicketButton(fakeButton({ guild, client, user, customId: 'ticket_claim', message: panel, channel: ch }));
  rec = db.getTicketByChannel(chId);
  assert.equal(String(rec.claimed_by), TEST_USER, 'claimed_by dolmadı');
  assert.ok(rec.claimed_at, 'claimed_at yazılmadı');

  /* --- Kapat: onay ekranı --- */
  const closeReq = fakeButton({ guild, client, user, customId: 'ticket_close', message: panel, channel: ch });
  await handleTicketButton(closeReq);
  const cevap = closeReq.state[closeReq.state.length - 1];
  const cb = btnIds(cevap);
  assert.ok(cb.includes('ticket_close_yes'), 'Evet butonu yok: ' + cb.join(','));
  assert.ok(cb.includes('ticket_close_no'), 'Hayır butonu yok: ' + cb.join(','));
  assert.ok(cevap?.embeds?.[0], 'onay embed\'i yok');
  // Panel bozulmamalı
  const panel2 = await ch.messages.fetch(rec.panel_message_id);
  assert.ok(btnIds(panel2).includes('ticket_claim'), 'panel butonları bozuldu');

  /* --- İptal --- */
  const confirmMsg = { id: 'e', silindi: false, async delete() { this.silindi = true; } };
  await handleTicketButton(fakeButton({ guild, client, user, customId: 'ticket_close_no', message: confirmMsg, channel: ch }));
  assert.ok(confirmMsg.silindi, 'onay mesajı silinmedi');
  assert.equal(db.getTicketByChannel(chId).status, 'open', 'iptal edilmesine rağmen ticket kapandı');

  /* --- Kesin kapat --- */
  await handleTicketButton(fakeButton({ guild, client, user, customId: 'ticket_close', message: panel2, channel: ch }));
  await handleTicketButton(
    fakeButton({ guild, client, user, customId: 'ticket_close_yes', message: { async delete() {} }, channel: ch }),
  );
  await new Promise((r) => setTimeout(r, 2500)); // transcript üretimi beklenir

  rec = db.getTicketByChannel(chId);
  assert.equal(rec.status, 'closed', 'ticket kapanmadı');

  /* --- Sahip yazma yetkisini kaybetti mi? (spec 13) --- */
  const chK = await guild.channels.fetch(chId);
  const ownerOv = chK.permissionOverwrites.cache.get(TEST_USER);
  assert.equal(ownerOv?.deny?.has('SendMessages'), true, 'sahip kapatıldıktan sonra yazmaya devam ediyor');
  assert.ok(ownerOv?.allow?.has('ViewChannel'), 'sahip ticket\'ı görememeli');

  /* --- Transcript gerçekten satır yazdı mı --- */
  const tr = db.getDb().prepare('SELECT transcript_id, message_count, user_count FROM transcripts WHERE ticket_id = ?').get(rec.id);
  assert.ok(tr, 'transcript kaydı yok');
  const mCount = db.getDb().prepare('SELECT COUNT(*) c FROM transcript_messages WHERE transcript_id = ?').get(tr.transcript_id).c;
  const uCount = db.getDb().prepare('SELECT COUNT(*) c FROM transcript_users WHERE transcript_id = ?').get(tr.transcript_id).c;
  assert.ok(mCount > 0, 'transcript_messages boş (txn çalışmıyor)');
  assert.ok(uCount > 0, 'transcript_users boş (txn çalışmıyor)');
  assert.equal(tr.message_count, mCount, 'message_count tutarsız');

  /* --- Temizlik --- */
  db.deleteTicket(rec.id);
  await guild.channels.delete(chId, 'E2E bitti').catch(() => {});
});
