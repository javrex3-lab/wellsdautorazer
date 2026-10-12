/**
 * TICKET E2E TESTI — gerçek Discord sunucusunda, gerçek handler yolu.
 *
 * Bu test GERÇEKTEN ticket açar (createTicketFromSelect), sonra doğrular:
 *   1. Başvuru ticket'ı doğru kategoride  -> channel.parentId === CAT
 *   2. Şikayet ticket'ı doğru kategoride
 *   3. Diğer ticket'ı doğru kategoride
 *   4. Rol gerçekten etiketlenmiş (ilk mesajda <@&ROLE>)
 *   5. Rol TEK SEFER etiketlenmiş (kanalda 1 mesajda geçiyor)
 *   6. İzinler: sahip görür/yazar, staff görür/yazar, @everyone göremez
 *   7. Butonlar mevcut (Sahiplenen/Kapat)
 *   8. Test sonunda tüm kanallar silinir
 *
 * NOT: Bu test gerçek Ticket Manager rolünü ETİKETLER. Bot açıkken çalıştır.
 */
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, ChannelType, PermissionsBitField } = require('discord.js');
const config = require('./src/config');

const CAT = config.ticket.categoryId;
const ROLE = config.ticket.pingRoleId;
const OWNER = process.env.TICKET_TEST_USER || '1056585742731726918'; // kendi ID'n

let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log('    OK   ' + n); }
  else { fail++; console.log('    FAIL ' + n + (x ? '  -> ' + x : '')); }
};

const { createTicketFromSelect } = require('./src/handlers/ticketHandler');
const db = require('./src/database/database');

/* ---- interaction taklidi ---- */
function fakeInteraction({ guild, client, user, categoryKey }) {
  const state = { replies: [] };
  const push = (p) => state.replies.push(p);
  return {
    guild,
    client,
    user: { id: user.id, tag: user.tag, username: user.username },
    member: { user, permissions: new PermissionsBitField(8n) },
    deferred: false,
    replied: false,
    async deferReply() { this.deferred = true; },
    async editReply(p) { push(p); return p; },
    async reply(p) { push(p); this.replied = true; return p; },
    state,
    categoryKey,
  };
}

(async () => {
  db.initDatabase();
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember],
  });

  await client.login(config.token);
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) { console.log('SUNUCU BULUNAMADI'); process.exit(1); }
  await guild.members.fetch();

  console.log('='.repeat(68));
  console.log('  TICKET E2E — canlı Discord');
  console.log('='.repeat(68));
  console.log('  Kategori : ' + CAT + ' ("' + (await guild.channels.fetch(CAT)).name + '")');
  console.log('  Ping rolü: ' + ROLE);
  console.log('  Test user: ' + OWNER);
  console.log('');

  const created = [];
  const CATS = [
    { key: 'basvuru', ad: 'Başvuru' },
    { key: 'sikayet', ad: 'Şikayet' },
    { key: 'diger', ad: 'Diğer' },
  ];

  for (const c of CATS) {
    console.log('  ── ' + c.ad + ' (' + c.key + ') ──');
    // Her kullanıcı için 1 açık ticket sınırı var; testler arası temizlik
    const onceki = require('./src/database/database').getOpenTicket(guild.id, OWNER);
    if (onceki) {
      await guild.channels.delete(onceki.channel_id, 'test temizlik').catch(() => {});
      require('./src/database/database').deleteTicket(onceki.id);
    }

    const ix = fakeInteraction({ guild, client, user: client.users.cache.get(OWNER) || { id: OWNER, tag: 'test#0001', username: 'test' }, categoryKey: c.key });
    await createTicketFromSelect(ix, c.key);

    const son = ix.state.replies[ix.state.replies.length - 1];
    const chId = son?.content?.match(/<#(\d+)>/)?.[1];
    if (!chId) {
      ok(c.ad + ': kanal açıldı', false, JSON.stringify(son).slice(0, 140));
      continue;
    }
    const ch = await guild.channels.fetch(chId);
    created.push(chId);

    // --- 1) Doğru kategoride mi ---
    ok(c.ad + ': kanal doğru kategoride', String(ch.parentId) === String(CAT), `parentId=${ch.parentId}`);

    // --- 2) Kategori gerçekten GuildCategory mi ---
    const parent = await guild.channels.fetch(ch.parentId);
    ok(c.ad + ': parent bir GuildCategory', parent?.type === ChannelType.GuildCategory, `tip=${parent?.type}`);

    // --- 3) İzinler ---
    const ovs = new Map(ch.permissionOverwrites.cache.map((o) => [o.id, o]));
    const everyoneOv = ovs.get(guild.id);
    ok(c.ad + ': @everyone göremiyor', everyoneOv?.deny?.has('ViewChannel'), 'ViewChannel deny bekleniyordu');

    const ownerOv = ovs.get(OWNER);
    ok(
      c.ad + ': sahip görebiliyor + yazabiliyor',
      !!ownerOv?.allow?.has('ViewChannel') && !!ownerOv?.allow?.has('SendMessages'),
      'sahip izinleri eksik',
    );

    const staffOv = ovs.get(ROLE);
    ok(
      c.ad + ': yetkili rolü görebiliyor + yazabiliyor',
      !!staffOv?.allow?.has('ViewChannel') && !!staffOv?.allow?.has('SendMessages'),
      'staff izinleri eksik',
    );

    // --- 4) Rol etiketi + TEK SEFER ---
    const msgs = await ch.messages.fetch({ limit: 20 });
    let rolMesaji = 0;
    let rolMesajId = null;
    for (const m of msgs.values()) {
      if (m.content?.includes(`<@&${ROLE}>`)) { rolMesaji++; rolMesajId = m.id; }
    }
    ok(c.ad + ': rol etiketlenmiş (gerçek mention)', rolMesaji >= 1, 'etiket bulunamadı');
    ok(c.ad + ': rol TEK sefer etiketlenmiş', rolMesaji === 1, `${rolMesaji} mesajda geçiyor`);

    // allowedMentions gerçekten rolü açıyor mu (mention gerçekten çözülmüş mü)
    if (rolMesajId) {
      const m = await ch.messages.fetch(rolMesajId);
      const roleMention = m.mentions.roles?.get(ROLE);
      ok(c.ad + ': Discord rolü mention olarak çözdü', !!roleMention, 'mention_roles boş');
    }

    // --- 5) Karşılama embed'i + butonlar korunmuş mu ---
    const ilk = await ch.messages.fetch(ch.id ? (await db.getDb().prepare('SELECT panel_message_id FROM tickets WHERE channel_id = ?').get(chId))?.panel_message_id : null).catch(() => null);
    if (ilk) {
      ok(c.ad + ': karşılama embed\'i var', !!ilk.embeds?.[0], 'embed yok');
      const butonlar = (ilk.components || []).flatMap((r) => r.components || []).map((b) => b.customId);
      ok(c.ad + ': Sahiplen butonu var', butonlar.includes('ticket_claim'), butonlar.join(','));
      ok(c.ad + ': Kapat butonu var', butonlar.includes('ticket_close'), butonlar.join(','));
    } else {
      ok(c.ad + ': karşılama mesajı okunabildi', false, 'panel mesajı bulunamadı');
    }

    // --- 6) DB kaydı ---
    const rec = db.getTicketByChannel(chId); // imza: (channelId)
    ok(c.ad + ': DB kaydı doğru', !!rec && String(rec.user_id) === OWNER, 'kayıt yok/yol');
    ok(c.ad + ': DB kategori doğru', rec?.category_key === c.key, rec?.category_key);

    console.log('');
  }

  // ---- Temizlik ----
  console.log('  ── Temizlik ──');
  for (const id of created) {
    const t = db.getTicketByChannel(id); // imza: (channelId)
    if (t) db.deleteTicket(t.id);
    await guild.channels.delete(id, 'E2E test sonu').catch(() => {});
  }
  console.log('    ' + created.length + ' test kanalı silindi');

  // Rollü eski haline getir (kod geçici açıp kapatıyor, doğrula)
  const role = await guild.roles.fetch(ROLE);
  console.log('    Ping rolü mentionable: ' + role.mentionable + (role.mentionable ? ' (beklenen: false)' : ' ✓'));

  db.closeDatabase();
  client.destroy();

  console.log('\n' + '='.repeat(68));
  console.log(`  ${pass} geçti, ${fail} kaldı`);
  console.log('='.repeat(68));
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('HATA:', e); process.exit(1); });
