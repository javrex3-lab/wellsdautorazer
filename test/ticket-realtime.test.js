/**
 * GERÇEK ETKİLEŞİM HATTI TESTİ — canlı Discord.
 *
 * Neden ayrı dosya: ticket açma akışının TAMAMINI gerçek entrypoint'ten
 * çağırır — interactionCreate.execute() → handleSelectMenu → createTicketFromSelect.
 * Önceki testler iç fonksiyonu doğrudan çağırıyor, bu katmanı atlıyordu
 * (bir handler'ın yazılı olması yüklendiğini kanıtlamaz).
 *
 * ⚠️ GERÇEKTEN ticket açar ve Ticket Manager rolünü etiketler.
 *    Varsayılan ATLANIR. Çalıştırmak için: $env:TICKET_E2E="1"
 */
const test = require('node:test');
const assert = require('node:assert');
const { Client, GatewayIntentBits, Partials, PermissionsBitField } = require('discord.js');

const config = require('../src/config');
const db = require('../src/database/database');
const interactionCreate = require('../src/events/interactionCreate');
const { buildCategoryMenu, buildTicketPanelEmbed } = require('../src/utils/ticketEmbeds');

const ACIK = process.env.TICKET_E2E === '1';
const O = { skip: ACIK ? false : 'TICKET_E2E=1 ile açılır (gerçek ticket açar + rol etiketler)' };
const TEST_USER = '1056585742731726918';

function selectInteraction({ guild, client, user, channel, message, values }) {
  const cevaplar = [];
  return {
    type: 3,
    isStringSelectMenu: () => true,
    isUserSelectMenu: () => false,
    isButton: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    isRepliable: () => true,
    guild,
    guildId: guild.id,
    client,
    user,
    member: { user, permissions: new PermissionsBitField(8n) },
    channel,
    channelId: channel.id,
    customId: 'ticket_category',
    values,
    message,
    cevaplar,
    deferred: false,
    replied: false,
    async deferReply(o) { this.deferred = true; cevaplar.push({ tip: 'defer', o }); },
    async editReply(o) { cevaplar.push({ tip: 'editReply', o }); return o; },
    async reply(o) { cevaplar.push({ tip: 'reply', o }); this.replied = true; return o; },
    async followUp(o) { cevaplar.push({ tip: 'followUp', o }); return o; },
    async update(o) { cevaplar.push({ tip: 'update', o }); return o; },
  };
}

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
  const o = db.getOpenTicket(guild.id, TEST_USER);
  if (o) { await guild.channels.delete(o.channel_id, 'E2E ön temizlik').catch(() => {}); db.deleteTicket(o.id); }

  // Panel canlı mı? Değilse ÖNCE onar — testler panel olmadan çalışamaz.
  // (Bot çalışırken ready.js bunu zaten yapar; testte bot kapalı.)
  const { ensureTicketPanel } = require('../src/handlers/ticketHandler');
  const durum = await ensureTicketPanel(client, guild);
  assert.ok(durum.ok, `ticket paneli kullanılamaz durumda: ${durum.action}`);
  t.after(async () => { db.closeDatabase(); client.destroy(); });
  return { client, guild, user };
}

/* 1) Panelin kendisi gerçekten basılabilir mi? */
test('R1: sunucuda canlı bir ticket paneli var ve basılabilir', O, async (t) => {
  const { client, guild, user } = await setup(t);
  const kayit = db.getTicketPanel(guild.id);
  assert.ok(kayit, 'ticket_panels kaydı yok');

  const ch = await guild.channels.fetch(kayit.channel_id);
  const m = await ch.messages.fetch(kayit.message_id); // 10008 → panel ölmüş

  const sel = (m.components || []).flatMap((r) => r.components || []).find((c) => c.type === 3);
  assert.ok(sel, 'panelde select menüsü yok');
  // discord.js Message.components içindeki bileşenler camelCase sunar
  // (customId); REST JSON ise custom_id kullanır. İkisini de kabul et.
  const selId = sel.customId ?? sel.custom_id;
  assert.equal(selId, 'ticket_category', 'select customId eşleşmiyor: ' + selId);
  const values = sel.options.map((o) => o.value);
  for (const beklenen of ['ticketcat:basvuru', 'ticketcat:sikayet', 'ticketcat:diger']) {
    assert.ok(values.includes(beklenen), `${beklenen} seçeneği yok`);
  }
});

/* 2) Tam yol: interactionCreate.execute -> kanal + rol + DB */
test('R2: interactionCreate.execute() üzerinden ticket açılıyor', O, async (t) => {
  const { client, guild, user } = await setup(t);
  const kayit = db.getTicketPanel(guild.id);
  const ch = await guild.channels.fetch(kayit.channel_id);
  const panel = await ch.messages.fetch(kayit.message_id);

  const ix = selectInteraction({ guild, client, user, channel: ch, message: panel, values: ['ticketcat:sikayet'] });
  await interactionCreate.execute(ix);

  const son = ix.cevaplar[ix.cevaplar.length - 1];
  const chId = son?.o?.content?.match(/<#(\d+)>/)?.[1];
  assert.ok(ix.cevaplar.some((c) => c.tip === 'defer'), 'deferReply çağrılmadı');
  assert.ok(chId, 'ticket kanalı oluşmadı: ' + JSON.stringify(son?.o).slice(0, 150));

  const tk = await guild.channels.fetch(chId);
  assert.equal(String(tk.parentId), String(config.ticket.categoryId), 'yanlış kategoride açıldı');

  const msgs = await tk.messages.fetch({ limit: 20 });
  const pings = [...msgs.values()].filter((x) => x.content?.includes(`<@&${config.ticket.pingRoleId}>`));
  assert.equal(pings.length, 1, `rol ${pings.length} mesajda etiketlenmiş (1 olmalı)`);
  assert.ok(pings[0].mentions.roles.get(config.ticket.pingRoleId), 'mention çözülmedi');

  const rec = db.getTicketByChannel(chId);
  assert.ok(rec && String(rec.user_id) === TEST_USER, 'DB kaydı yanlış');

  db.deleteTicket(rec.id);
  await guild.channels.delete(chId, 'E2E bitti').catch(() => {});
});

/* 3) Hata yolları kullanıcıya bildiriliyor mu? */
test('R3: hatalı etkileşimler kullanıcıya yanıt veriyor', O, async (t) => {
  const { client, guild, user } = await setup(t);
  const kayit = db.getTicketPanel(guild.id);
  const ch = await guild.channels.fetch(kayit.channel_id);
  const panel = await ch.messages.fetch(kayit.message_id);

  // a) Bilinmeyen customId
  const a = selectInteraction({ guild, client, user, channel: ch, message: panel, values: ['x'] });
  a.customId = 'bilinmeyen';
  await interactionCreate.execute(a);
  assert.ok(
    a.cevaplar.some((c) => c.tip === 'reply' && /Bilinmeyen seçim/.test(JSON.stringify(c.o))),
    'bilinmeyen customId için kullanıcı yanıtı yok',
  );

  // b) Geçersiz kategori
  const b = selectInteraction({ guild, client, user, channel: ch, message: panel, values: ['ticketcat:yok'] });
  await interactionCreate.execute(b);
  assert.ok(
    b.cevaplar.some((c) => /Geçersiz kategori/.test(JSON.stringify(c.o))),
    'geçersiz kategori için kullanıcı yanıtı yok',
  );
  assert.equal(b.cevaplar.filter((c) => c.tip === 'reply').length, 1, 'aynı interactiona 2 kez yanıt verildi');
});

/* 4) DB ölü mesajı gösteriyorsa kendini onarır mı? (ensureTicketPanel)
 *    Gerçek üretim senaryosu birebir: panel silinir, DB eski ID'de kalır.
 *    Yayılma (eventual consistency) için beklemeden, DB'ye kasıtlı olarak
 *    var olmayan bir mesaj ID'si yazılır. */
test('R4: DB ölü mesajı gösteriyorsa panel otomatik yeniden kuruluyor', O, async (t) => {
  const { client, guild } = await setup(t);
  const { ensureTicketPanel } = require('../src/handlers/ticketHandler');
  const { upsertTicketPanel, getTicketPanel } = require('../src/database/database');

  const canli = getTicketPanel(guild.id);
  const kanali = await guild.channels.fetch(canli.channel_id);

  // DB'yi ölü bir mesaj ID'sine yedir (mesajı silmeye gerek yok)
  const OLU_ID = '1000000000000000000';
  upsertTicketPanel(guild.id, canli.channel_id, OLU_ID);
  assert.equal(getTicketPanel(guild.id).message_id, OLU_ID, 'test önkoşulu: DB ölü ID gösteriyor');

  const r = await ensureTicketPanel(client, guild);
  assert.equal(r.action, 'yeniden_olusturuldu', 'ölü panel fark edilmedi: ' + r.action);
  assert.ok(r.ok && r.messageId && r.messageId !== OLU_ID, 'yeni panel oluşturulmadı');

  // Yeni panel gerçekten basılabilir mi
  const yeni = await kanali.messages.fetch(r.messageId);
  const sel = (yeni.components || []).flatMap((x) => x.components || []).find((c) => c.type === 3);
  assert.ok(sel, 'yeni panelde select menüsü yok');
  assert.equal(sel.customId ?? sel.custom_id, 'ticket_category', 'yeni panel selectId yanlış');
  const values = sel.options.map((o) => o.value);
  assert.ok(values.includes('ticketcat:basvuru') && values.includes('ticketcat:sikayet') && values.includes('ticketcat:diger'),
    'yeni panelde kategori seçenekleri eksik: ' + values.join(','));

  // DB yeni mesajı gösteriyor mu
  assert.equal(getTicketPanel(guild.id).message_id, r.messageId, 'DB güncellenmedi');

  // Art arda çağrıda "ayakta" demeli (gereksiz yeniden gönderim olmasın)
  const tekrar = await ensureTicketPanel(client, guild);
  assert.equal(tekrar.action, 'ayakta', 'sağlam panel gereksiz yere yeniden gönderildi');
  assert.equal(tekrar.messageId, r.messageId, 'panel mesajı değişti');

  // Eski (ölü gösterilen) paneli temizle, DB yenisini gösteriyor kalsın
  await kanali.messages.fetch(r.messageId).then((x) => x.delete()).catch(() => {});
  await ensureTicketPanel(client, guild); // tekrar kur
});
