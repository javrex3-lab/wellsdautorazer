/**
 * test/ticket-sahiplen-panel.test.js
 *
 * "Yetkili - Sahiplen" akışı:
 *   1) sahiplenince panelde "Yetkili bekleniyor" -> "Yetkili sahiplendi" olur
 *   2) başka bir yetkili sahiplenmeye çalışırsa "zaten sahiplenildi" der
 *
 * ÖNEMLİ: Bu akış daha önce ÇALIŞMIYORDU. `ticket_sessions` tablosunda
 * `panel_message_id` kolonu yoktu; sahiplenince `fetch(undefined)` hata verip
 * sessizce yutuluyor ve panel hiç güncellenmiyordu. Test bu regresyonu
 * kilitler.
 *
 * Gerçek kod çalıştırılır. Discord bağlantısı YOKTUR.
 */
process.env.DB_PATH = require('path').join(require('os').tmpdir(), 'tksahip-' + Date.now() + '.db');

const fs = require('fs');
const path = require('path');
const db = require('../src/database/database');
const views = require('../src/utils/ticketViews');
const tickets = require('../src/handlers/tickets');

const KOK = path.resolve(__dirname, '..');

const G = '1354465879311777893';
const CATEGORY = '1522774034323079329';
const BOT = '1559192913009713222';
const O = '100000000000000001';
const S1 = '1056585742731726918';
const S2 = '1056585742731726999';
const YETKI = '1522773972393922730';

db.initDatabase();

let pass = 0,
  fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log('  OK   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '  -> ' + extra : ''));
  }
};
const bolum = (t) => console.log('\n' + '-'.repeat(4) + ' ' + t);

console.log('='.repeat(70));
console.log('  YETKİLİ - SAHİPLEN: PANEL GÜNCELLEME + "ZATEN SAHİPLENİLDİ"');
console.log('='.repeat(70));

/* ------------------------------------------------------ sahte Discord */
const kanallar = [];
let kanalSayac = 0;

const guild = {
  id: G,
  name: 'WELL SD #V12',
  iconURL: () => 'https://cdn.discordapp.com/icons/' + G + '/abc.png?size=512',
  roles: { everyone: { id: G } },
  members: { me: { permissions: { has: () => true }, roles: { highest: { position: 90 } } }, fetch: async () => null },
  channels: {
    fetch: async (id) => {
      if (id === CATEGORY) return { id: CATEGORY, type: 4, name: 'ticket', permissionsFor: () => ({ has: () => true }) };
      const k = kanallar.find((x) => x.id === id);
      if (k) return k;
      throw Object.assign(new Error('yok'), { code: 10003, status: 404 });
    },
    create: async (o) => {
      kanalSayac++;
      const ch = {
        id: '10000000000000001' + kanalSayac,
        name: o.name,
        type: o.type,
        parentId: o.parent,
        topic: o.topic,
        permissionOverwrites: o.permissionOverwrites,
        sent: [],
        mesajlar: [],
        editCagrilari: [],
        isTextBased: () => true,
        isDMBased: () => false,
        send: async (p) => {
          const m = { id: 'MSG' + (ch.sent.length + 1), ...p, edit: async (q) => ch.editCagrilari.push(q) };
          ch.sent.push(p);
          ch.mesajlar.push(m);
          return m;
        },
        delete: async () => {},
        messages: {
          fetch: async (id) => {
            const m = ch.mesajlar.find((x) => x.id === id);
            if (!m) throw Object.assign(new Error('yok'), { code: 10008 });
            return m;
          },
        },
      };
      kanallar.push(ch);
      return ch;
    },
  },
};

const etk = (o) => {
  const c = { reply: null, edit: null, update: null, deferred: false };
  return {
    _c: c,
    customId: o.customId,
    channelId: o.channelId,
    user: { id: o.userId, tag: 'd27q#0001', username: 'd27q' },
    member: { id: o.userId, permissions: { has: () => !!o.staff }, roles: { cache: new Map() } },
    guild,
    guildId: G,
    channel: kanallar.find((x) => x.id === o.channelId) || null,
    client: { user: { id: BOT } },
    replied: false,
    deferred: false,
    isRepliable: () => true,
    reply: async (p) => ((c.reply = p), true),
    editReply: async (p) => ((c.edit = p), true),
    update: async (p) => ((c.update = p), true),
    deferReply: async () => ((c.deferred = true), true),
  };
};
const yanit = (i) => JSON.stringify(i._c.edit || i._c.reply || i._c.update || {});

(async () => {
  /* ================================================================== */
  bolum('1) ŞEMA — panel_message_id kolonu');

  {
    const t = db.createTicketSession({ guildId: G, ownerId: O, kind: 'basvuru' });
    const kolonlar = Object.keys(db.getDb().prepare('SELECT * FROM ticket_sessions WHERE id = ?').get(t.id));
    check('panel_message_id kolonu VAR', kolonlar.includes('panel_message_id'), kolonlar.join(','));
    check('setTicketPanelMessage yazıyor', db.setTicketPanelMessage(t.id, 'MSG123') === true);
    check('yazılan değer okunuyor', db.getDb().prepare('SELECT panel_message_id FROM ticket_sessions WHERE id = ?').get(t.id).panel_message_id === 'MSG123');
    check('boş mesaj id reddediliyor', db.setTicketPanelMessage(t.id, null) === false);
    check('geçersiz ticket id çökmüyor', db.setTicketPanelMessage(999999, 'MSG1') === true);

    const src = fs.readFileSync(path.join(KOK, 'src/database/schema.js'), 'utf8');
    check('şema tanımında da var (yeni DB’ler için)', /panel_message_id TEXT/.test(src));
    const dbSrc = fs.readFileSync(path.join(KOK, 'src/database/database.js'), 'utf8');
    check('ALTER migrasyonu var (eski DB’ler için)', /ALTER TABLE ticket_sessions ADD COLUMN panel_message_id/.test(dbSrc));
  }

  /* ================================================================== */
  bolum('2) TICKET AÇILIŞI — panel mesajının kimliği kaydediliyor');

  const ac = etk({ userId: O, staff: false, customId: 'tk_ac_basvuru', channelId: '999000000000000010' });
  await tickets.handleOpenButton(ac, 'basvuru');

  const bilgi = db.getOpenTicketByUser(G, O);
  check('Ticket açıldı', !!bilgi, String(bilgi?.id));
  check('panel_message_id boş DEĞİL', !!bilgi?.panel_message_id, String(bilgi?.panel_message_id));

  const kanal = kanallar.find((x) => x.id === bilgi.channel_id);
  check('Kanal oluşturuldu', !!kanal, bilgi.channel_id);
  const ilkMesaj = kanal.mesajlar[0];
  check('Kayıt, gerçekten gönderilen mesajın kimliği', bilgi.panel_message_id === ilkMesaj.id, bilgi.panel_message_id + ' vs ' + ilkMesaj.id);
  check('Açılışta "Yetkili bekleniyor"', ilkMesaj.embeds[0].data.description.includes('Yetkili bekleniyor'), ilkMesaj.embeds[0].data.description.slice(-50));

  /* ================================================================== */
  bolum('3) SAHİPLENME — panel gerçekten güncelleniyor');

  const s1 = etk({ userId: S1, staff: true, customId: 'tk_sahiplen', channelId: bilgi.channel_id });
  await tickets.handleSahiplen(s1);

  check('Mesaj DÜZENLENDİ (edit çağrısı yapıldı)', kanal.editCagrilari.length >= 1, 'edit çağrısı: ' + kanal.editCagrilari.length);

  const duzen = kanal.editCagrilari[0];
  const aciklama = duzen?.embeds?.[0]?.data?.description || '';
  check('Panelde "Yetkili bekleniyor" ARTIK YOK', !aciklama.includes('Yetkili bekleniyor'), aciklama.slice(-60));
  check('Panelde "Yetkili sahiplendi" VAR', aciklama.includes('Yetkili sahiplendi'), aciklama.slice(-60));
  check('Sahibin kimliği gösteriliyor', aciklama.includes(`<@${S1}>`), '');
  check('Durum kutusu güncellendi', aciklama.includes(`\`\`\`Yetkili sahiplendi: <@${S1}>\`\`\``), aciklama.slice(-60));
  check('Sahiplenme alanı eklendi', (duzen?.embeds?.[0]?.data?.fields || []).some((f) => f.name.includes('Ticket Sahibi Yetkili')), JSON.stringify((duzen?.embeds?.[0]?.data?.fields || []).map((f) => f.name)));
  check('Butonlar da yenilendi (2 satır)', Array.isArray(duzen?.components) && duzen.components.length === 2, String(duzen?.components?.length));

  check('DB: claimed_by yazıldı', db.getTicketByChannel(bilgi.channel_id).claimed_by === S1, String(db.getTicketByChannel(bilgi.channel_id).claimed_by));
  check('DB: claimed_at yazıldı', !!db.getTicketByChannel(bilgi.channel_id).claimed_at);
  check('DB: durum hâlâ açık', db.getTicketByChannel(bilgi.channel_id).status === 'open');

  /* ================================================================== */
  bolum('4) İKİNCİ YETKİLİ — "zaten sahiplenildi"');

  const s2 = etk({ userId: S2, staff: true, customId: 'tk_sahiplen', channelId: bilgi.channel_id });
  await tickets.handleSahiplen(s2);
  const m = yanit(s2);

  check('"zaten sahiplenildi" diyor', m.includes('zaten sahiplenildi'), m);
  check('Sahibi gösteriyor', m.includes(`<@${S1}>`), m);
  check('Ticket hâlâ açık', db.getTicketByChannel(bilgi.channel_id).status === 'open');
  check('Sahibi DEĞİŞMEDİ', db.getTicketByChannel(bilgi.channel_id).claimed_by === S1, String(db.getTicketByChannel(bilgi.channel_id).claimed_by));
  check('İkinci yetkiliye özel mesaj (eski sahibin adıyla)', (s2._c.edit?.content || s2._c.reply?.content || '').includes('Sahibi:'), String(s2._c.edit?.content || s2._c.reply?.content));

  /* ================================================================== */
  bolum('5) AYNI YETKİLİ TEKRAR BASARSA');

  const s1b = etk({ userId: S1, staff: true, customId: 'tk_sahiplen', channelId: bilgi.channel_id });
  await tickets.handleSahiplen(s1b);
  check('Net mesaj veriyor', yanit(s1b).includes('zaten senin tarafından'), yanit(s1b));
  check('İstatistik tekrar artmadı', db.getTicketClaimCount(G, S1) === 1, String(db.getTicketClaimCount(G, S1)));

  /* ================================================================== */
  bolum('6) YETKİLİ OLMAYAN SAHİPLENEMEZ');

  const sahip = etk({ userId: O, staff: false, customId: 'tk_sahiplen', channelId: bilgi.channel_id });
  await tickets.handleSahiplen(sahip);
  check('Ticket sahibi kendi ticketını sahiplenemez', yanit(sahip).includes('yalnızca yetkililer'), yanit(sahip));
  check('Sahibi değiştiremedi', db.getTicketByChannel(bilgi.channel_id).claimed_by === S1, String(db.getTicketByChannel(bilgi.channel_id).claimed_by));

  /* ================================================================== */
  bolum('7) DURUM METNİ KURALLARI');

  check('Açık + sahipsiz: "Yetkili bekleniyor..."', views.durumMetni({ status: 'open' }) === 'Yetkili bekleniyor...', views.durumMetni({ status: 'open' }));
  check('Açık + sahipli: "Yetkili sahiplendi: <@id>"', views.durumMetni({ status: 'open', claimedBy: S1 }) === `Yetkili sahiplendi: <@${S1}>`);
  check('Kapatılmış: sahipli olsa bile kapalı yazar', views.durumMetni({ status: 'closed', claimedBy: S1 }) === 'Bu ticket kapatıldı.');
  check('Reddedilmiş: sahipli olsa bile red yazar', views.durumMetni({ status: 'rejected', claimedBy: S1 }) === 'Talebiniz reddedildi.');
  check('Kabul edilmiş: sahipli olsa bile kabul yazar', views.durumMetni({ status: 'accepted', claimedBy: S1 }) === 'Talebiniz kabul edildi. 🎉');

  /* ================================================================== */
  bolum('8) DİĞER SİSTEMLER ETKİLENMEDİ');

  {
    check('Banlılar dokunulmadı', typeof require('../src/handlers/banli').handleEtkilesim === 'function');
    check('Mazeret dokunulmadı', typeof require('../src/handlers/mazeret').handleSureSelect === 'function');
    check('IC dokunulmadı', typeof require('../src/handlers/icHandler').handleIcButton === 'function');
    check('Ana ticket paneli dokunulmadı', /function buildMainPanel\(/.test(fs.readFileSync(path.join(KOK, 'src/utils/ticketViews.js'), 'utf8')));

    check('.env değiştirilmedi', !fs.readFileSync(path.join(KOK, '.env'), 'utf8').includes('panel_message_id'));
    const pkg = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));
    check('Yeni dependency eklenmedi', Object.keys(pkg.dependencies).length === 9, String(Object.keys(pkg.dependencies).length));
  }

  /* ================================================================== */
  console.log('\n' + '='.repeat(70));
  console.log(`  SONUÇ:  ${pass} başarılı / ${pass + fail} toplam  /  ${fail} başarısız`);
  console.log('='.repeat(70));

  tickets._silmeZamanlayici.forEach((x) => clearTimeout(x));
  tickets._silmeZamanlayici.clear();
  db.closeDatabase();
  try {
    fs.unlinkSync(process.env.DB_PATH);
  } catch {
    /* yok */
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('TEST ÇÖKTÜ: ' + (e?.stack || e));
  process.exit(1);
});