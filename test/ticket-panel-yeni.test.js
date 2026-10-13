/**
 * test/ticket-panel-yeni.test.js
 *
 * Ana ticket panelinin YENİ düzeni ve kategori seçim menüsü (dropdown) akışı.
 *
 * Gerçek kod çalıştırılır (buildMainPanel / panelEkleri / handleKategoriSelect /
 * handleOpenButton / interactionCreate). Discord bağlantısı YOKTUR; sunucu,
 * kategori ve etkileşim nesneleri sahtedir ve DB geçici dosyaya yazılır.
 *
 * Kapsam: yalnızca ana panel + panelden ticket açma akışı.
 */
process.env.DB_PATH = require('path').join(require('os').tmpdir(), 'tkpanel-' + Date.now() + '.db');

const fs = require('fs');
const path = require('path');
const { MessagePayload } = require('discord.js');
const db = require('../src/database/database');
const config = require('../src/config');
const views = require('../src/utils/ticketViews');
const tickets = require('../src/handlers/tickets');

const KOK = path.resolve(__dirname, '..');

const G = '1354465879311777893';
const CATEGORY = '1522774034323079329';
const RULES_CHANNEL = '1525548689064464567';
const BOT = '1559192913009713222';

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

console.log('='.repeat(68));
console.log('  ANA TICKET PANELİ — YENİ DÜZEN + KATEGORİ SEÇİM MENÜSÜ');
console.log('='.repeat(68));

const RULES_URL = `https://discord.com/channels/${G}/${RULES_CHANNEL}`;

/* ================================================================== */
(async () => {

bolum('1) PANEL YAPISI — örnek düzene uygun');

const rows = views.buildMainPanelRows({ rulesUrl: RULES_URL }).map((r) => r.toJSON());
check('İki satır: kurallar bağlantısı + seçim menüsü', rows.length === 2, 'bulunan: ' + rows.length);
check('1. satır LinkButton (tip 2)', rows[0].components[0].type === 2, 'tip: ' + rows[0].components[0].type);
check('Kurallar butonu gerçek kural kanalına gidiyor', rows[0].components[0].url === RULES_URL, rows[0].components[0].url);
check('2. satır StringSelectMenu (tip 3)', rows[1].components[0].type === 3, 'tip: ' + rows[1].components[0].type);
check(
  'Placeholder istendiği gibi',
  rows[1].components[0].placeholder === 'TICKET OLUŞTURMAK İÇİN KATEGORİ SEÇİNİZ',
  rows[1].components[0].placeholder,
);

/* ================================================================== */
bolum('2) KATEGORİ SEÇENEKLERİ');

const opts = rows[1].components[0].options || [];
check('3 kategori seçeneği', opts.length === 3, 'bulunan: ' + opts.length);
check('Değerler: basvuru|sikayet|diger', opts.map((o) => o.value).join('|') === 'basvuru|sikayet|diger', opts.map((o) => o.value).join('|'));
check('Her değer geçerli bir ticket türü', opts.every((o) => views.isKnownKind(o.value)), opts.map((o) => o.value).join('|'));
check('Etiketler: Başvuru|Şikayet|Diğer', opts.map((o) => o.label).join('|') === 'Başvuru|Şikayet|Diğer', opts.map((o) => o.label).join('|'));
check('Emoji: 📝 / 📢 / 📩', opts.map((o) => o.emoji?.name).join('') === '\u{1F4DD}\u{1F4E2}\u{1F4E9}');
check('Menüde varsayılan seçili değer yok', !opts.some((o) => o.default), 'default olmamalı');

/* ================================================================== */
bolum('3) DISCORD API SINIRLARI (gönderim hatasına karşı)');

check('Seçenek sayısı 2..25 arasında', opts.length >= 2 && opts.length <= 25, String(opts.length));
check('Tüm etiketler ≤100 karakter', opts.every((o) => o.label.length <= 100));
check('Tüm açıklamalar ≤100 karakter', opts.every((o) => (o.description || '').length <= 100));
check('Tüm değerler ≤100 karakter', opts.every((o) => o.value.length <= 100));
check('Placeholder ≤150 karakter', rows[1].components[0].placeholder.length <= 150);
check('Placeholder boş değil', rows[1].components[0].placeholder.trim().length > 0);
check('customId ≤100 karakter', rows[1].components[0].custom_id.length <= 100);

/* ================================================================== */
bolum('4) EMBED İÇERİĞİ');

const panel = views.buildMainPanel({
  guildName: 'WELL SD #V12',
  imageUrl: 'attachment://ticket-panel.png',
  iconUrl: 'https://cdn.discordapp.com/icons/' + G + '/abc.png?size=512',
  rulesUrl: RULES_URL,
}).embed.toJSON();

check('Başlık sunucu adını içerir', panel.title.includes('WELL SD #V12'), panel.title);
check('Sunucu arması sağ üstte (thumbnail)', !!panel.thumbnail?.url, JSON.stringify(panel.thumbnail));
check('Banner embed içinde (image)', panel.image?.url === 'attachment://ticket-panel.png', String(panel.image?.url));
check('Açıklama "Hakkında" bölümü içerir', panel.description.includes('Ticket Sistemi Hakkında'));
check('Açıklama "Bildiğiniz" bölümü içerir', panel.description.includes('Bildiğiniz'));
check('Açıklama kural uyarısı içerir', panel.description.includes('kurallarımızı'));
check('Açıklama 4096 karakter sınırı içinde', panel.description.length <= 4096, String(panel.description.length));

{
  const arg = views.buildMainPanel({}).embed.toJSON();
  check('iconUrl yoksa thumbnail yok', arg.thumbnail === undefined);
  check('imageUrl yoksa image yok', arg.image === undefined);
}

/* ================================================================== */
bolum('5) rulesUrl VERİLMEZSE');

const satirsiz = views.buildMainPanelRows().map((r) => r.toJSON());
check('Kurallar satırı hiç oluşmuyor', satirsiz.length === 1, 'bulunan: ' + satirsiz.length);
check('Menü yine de var', satirsiz[0].components[0].type === 3, 'tip: ' + satirsiz[0].components[0].type);
check('Menü özel kimliği değişmedi', satirsiz[0].components[0].custom_id === 'tk_ac_kategori');

/* ================================================================== */
bolum('6) SUNUCU BAĞLAMI (panelEkleri)');

{
  const guild = { id: G, iconURL: () => 'https://cdn.discordapp.com/icons/' + G + '/abc.png?size=512' };
  const e = tickets.panelEkleri(guild);
  check('Sunucu arması alınıyor', e.iconUrl === guild.iconURL(), String(e.iconUrl));
  check('Kural adresi guild + kanal kimliğinden üretiliyor', e.rulesUrl === RULES_URL, String(e.rulesUrl));

  const armasiz = tickets.panelEkleri({ id: G, iconURL: () => null });
  check('Armasız sunucuda thumbnail null', armasiz.iconUrl === null, String(armasiz.iconUrl));
  check('Armasız sunucuda da kural adresi var', armasiz.rulesUrl === RULES_URL);

  const iconAtan = tickets.panelEkleri({ id: G });
  check('iconURL metodu yoksa çökmez', iconAtan.iconUrl === null, String(iconAtan.iconUrl));

  const bozuk = tickets.panelEkleri({
    id: G,
    iconURL: () => {
      throw new Error('yok');
    },
  });
  check('iconURL patlarsa yutulmaz, panel yine kurulur', bozuk.iconUrl === null);
  check('iconURL patlasa da kural adresi üretilir', bozuk.rulesUrl === RULES_URL);
}

check('config: rulesChannelId gerçek kural kanalı', config.ticket.rulesChannelId === RULES_CHANNEL, String(config.ticket.rulesChannelId));

/* ================================================================== */
bolum('7) ETKİLEŞİM YÖNLENDİRMESİ');

check('CID.AC_KATEGORI tanımlı', views.CID.AC_KATEGORI === 'tk_ac_kategori', String(views.CID.AC_KATEGORI));
check('handleKategoriSelect export edildi', typeof tickets.handleKategoriSelect === 'function');
{
  const src = fs.readFileSync(path.join(KOK, 'src/events/interactionCreate.js'), 'utf8');
  check('interactionCreate select dalında yönlendiriliyor', /tk\.CID\.AC_KATEGORI/.test(src) && /tk\.handleKategoriSelect/.test(src));
  check('interactionCreate select dalı mazeretten sonra geliyor', src.indexOf('mz.handleSureSelect') < src.indexOf('tk.handleKategoriSelect'));
  const bh = fs.readFileSync(path.join(KOK, 'src/handlers/buttonHandler.js'), 'utf8');
  check('ESKİ buton yönlendirmesi korundu (geriye uyum)', /tickets\.OPEN_KIND\[customId\]/.test(bh));
}

/* ================================================================== */
bolum('8) GEÇERSİZ SEÇİM — SESSİCE YUTULMAZ');

const sahteEtkilesim = (o = {}) => {
  const c = { reply: null, edit: null, update: null, deferred: false };
  return {
    _c: c,
    customId: o.customId ?? views.CID.AC_KATEGORI,
    values: o.values,
    channelId: o.channelId === undefined ? '999000000000000010' : o.channelId,
    user: { id: o.userId || '100000000000000001', tag: 'test#0001', username: 'test' },
    member: { id: o.userId || '100000000000000001', permissions: { has: () => !!o.staff } },
    guild: o.guild || null,
    channel: null,
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
const yanit = (it) => JSON.stringify(it._c.edit || it._c.reply || it._c.update || {});

{
  const kotu = sahteEtkilesim({ values: ['hacklenmis_tur'] });
  const r = await tickets.handleKategoriSelect(kotu);
  check('Geçersiz değer false DÖNMÜYOR (işlenmiş sayılır)', r !== false, String(r));
  check('Geçersiz değerde ticket AÇILMADI', kotu._c.deferred === false, JSON.stringify(kotu._c));
  check('Geçersiz değer kullanıcıya bildiriliyor', yanit(kotu).includes('Geçersiz kategori'), yanit(kotu));
  check('Geçersiz değer ephemeral yanıt', (kotu._c.reply?.flags ?? 0) === 64, JSON.stringify(kotu._c.reply?.flags));
}

{
  const bos = sahteEtkilesim({ values: [] });
  const r = await tickets.handleKategoriSelect(bos);
  check('Boş seçim çökmüyor', r !== false);
  check('Boş seçimde ticket açılmadı', bos._c.deferred === false);
}

{
  const tanimsiz = sahteEtkilesim({ values: undefined });
  check('values alanı yoksa çökmüyor', (await tickets.handleKategoriSelect(tanimsiz)) !== false);
  check('values yoksa ticket açılmadı', tanimsiz._c.deferred === false);
}

/* ================================================================== */
bolum('9) GEÇERLİ SEÇİM — GERÇEKTEN TICKET AÇAR (uçtan uca)');

const olusan = [];
const guild = {
  id: G,
  name: 'WELL SD #V12',
  iconURL: () => 'https://cdn.discordapp.com/icons/' + G + '/abc.png?size=512',
  roles: { everyone: { id: G } },
  members: { me: { permissions: { has: () => true }, roles: { highest: { position: 90 } } } },
  channels: {
    fetch: async (id) =>
      id === CATEGORY
        ? { id: CATEGORY, type: 4, name: 'ticket', permissionsFor: () => ({ has: () => true }) }
        : Promise.reject(new Error('yok')),
    create: async (opts) => {
      const ch = {
        id: '9990000000000020' + olusan.length,
        name: opts.name,
        type: opts.type,
        parentId: opts.parent,
        permissionOverwrites: opts.permissionOverwrites,
        sent: [],
        deleted: false,
        isTextBased: () => true,
        send: async (p) => {
          ch.sent.push(p);
          return { id: 'm' + ch.sent.length };
        },
        delete: async () => {
          ch.deleted = true;
        },
      };
      olusan.push(ch);
      return ch;
    },
  },
};

{
  const kullanici = '100000000000000777';
  const it = sahteEtkilesim({ values: ['basvuru'], userId: kullanici, guild });
  const r = await tickets.handleKategoriSelect(it);

  check('Dropdown işlendi', r !== false, String(r));
  check('Etkileşim anında ACK edildi', it._c.deferred === true, JSON.stringify(it._c));
  check('1 kanal oluşturuldu', olusan.length === 1, 'oluşan: ' + olusan.length);
  check('Kanal doğru kategoride', olusan[0]?.parentId === CATEGORY, String(olusan[0]?.parentId));

  const kayit = db.getOpenTicketByUser(G, kullanici);
  check('DB kaydı doğru türde', kayit?.kind === 'basvuru', String(kayit?.kind));
  check('DB kaydı doğru kullanıcıda', kayit?.owner_id === kullanici, String(kayit?.owner_id));
  check('Kanal açılış embed\'i gönderildi', (olusan[0]?.sent?.length ?? 0) >= 1, 'mesaj: ' + (olusan[0]?.sent?.length ?? 0));
}

{
  // Şikayet türü de menüden açılabilmeli
  const kullanici = '100000000000000778';
  const it = sahteEtkilesim({ values: ['sikayet'], userId: kullanici, guild });
  await tickets.handleKategoriSelect(it);
  check('Şikayet seçimi de kanal açtı', olusan.length === 2, 'oluşan: ' + olusan.length);
  check('Şikayet kaydı doğru türde', db.getOpenTicketByUser(G, kullanici)?.kind === 'sikayet');
}

{
  // Aynı kullanıcı ikinci kez seçerse ikinci ticket açılmamalı
  const tekrar = '100000000000000777';
  const it = sahteEtkilesim({ values: ['diger'], userId: tekrar, guild });
  await tickets.handleKategoriSelect(it);
  check('Kullanıcı başına tek açık ticket korunuyor', olusan.length === 2, 'oluşan: ' + olusan.length);
  check('Tekrar seçimde kullanıcıya bildiriliyor', yanit(it).includes('Zaten açık bir ticketınız var'), yanit(it));
}

/* ================================================================== */
bolum('10) PANEL GÖNDERİMİ — görsel attachment adı doğru mu');

{
  const gonderilen = [];
  let n = 0;
  const kanal = {
    id: '999000000000000001',
    guildId: G,
    name: 'ticket-panel',
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async (p) => {
      gonderilen.push(p);
      return { id: '9990000000000099' + ++n };
    },
    messages: {
      fetch: async () => Promise.reject(Object.assign(new Error('yok'), { code: 10008 })),
    },
  };

  db.deleteTicketPanel(G);
  const r = await tickets.sendMainPanel({}, guild, kanal);

  check('Panel gönderildi', r.ok === true && r.action === 'gonderildi', r.action);

  const mesaj = gonderilen[0];
  const beklenen = 'attachment://ticket-panel.png';
  check('Embed görseli attachment:// ile bağlı', mesaj.embeds[0].data.image?.url === beklenen, String(mesaj.embeds[0].data.image?.url));
  check('Mesaja 1 dosya eklendi', (mesaj.files || []).length === 1, String((mesaj.files || []).length));

  // discord.js'in attachment'a vereceği GERÇEK adı çöz
  const adlar = [];
  for (const f of mesaj.files || []) adlar.push((await MessagePayload.resolveFile(f)).name);
  check('Attachment adı embed referansıyla eşleşiyor', adlar.includes('ticket-panel.png'), JSON.stringify(adlar));
  check(
    'SONUÇ — banner panelin içinde çözülüyor',
    mesaj.embeds[0].data.image?.url === beklenen && adlar.includes('ticket-panel.png'),
    JSON.stringify(adlar),
  );

  check('Sunucu arması panele girdi', !!mesaj.embeds[0].data.thumbnail?.url, String(mesaj.embeds[0].data.thumbnail?.url));
  check('Kurallar bağlantısı panele girdi', mesaj.components[0].toJSON().components[0].url === RULES_URL);
  check('Kategori menüsü panele girdi', mesaj.components[1].toJSON().components[0].custom_id === 'tk_ac_kategori');
  check('Toplam 2 bileşen satırı', mesaj.components.length === 2, String(mesaj.components.length));
}

/* ================================================================== */
bolum('11) DÜZENLEME — duplicate yok, görsel korunuyor');

{
  const editCagrisi = [];
  db.upsertTicketPanel(G, '999000000000000001', '99900000000000991');
  const kanal = {
    id: '999000000000000001',
    guildId: G,
    name: 'ticket-panel',
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async () => {
      throw new Error('DÜZENLEME YOLUNDA YENİ MESAJ GÖNDERİLMEMELİ');
    },
    messages: {
      fetch: async () => ({
        id: '99900000000000991',
        embeds: [{ image: { url: 'https://cdn.discordapp.com/attachments/1/2/ticket-panel.png' } }],
        edit: async (p) => editCagrisi.push(p),
      }),
    },
  };

  const r = await tickets.sendMainPanel({}, guild, kanal);
  check('Duplicate oluşmadı, mesaj güncellendi', r.ok === true && r.action === 'guncellendi', r.action);
  check('Güncellemede yeni mesaj gönderilmedi', editCagrisi.length === 1, String(editCagrisi.length));
  check(
    'Görsel korundu (CDN adresi kaldı)',
    editCagrisi[0].embeds[0].data.image?.url === 'https://cdn.discordapp.com/attachments/1/2/ticket-panel.png',
    editCagrisi[0].embeds[0].data.image?.url,
  );
  check('Güncellemede 2 bileşen satırı gönderiliyor', editCagrisi[0].components.length === 2, String(editCagrisi[0].components?.length));
  check('Güncellemede de menü gidiyor', editCagrisi[0].components[1].toJSON().components[0].custom_id === 'tk_ac_kategori');
  check('Güncellemede dosya TEKRAR yüklenmiyor', editCagrisi[0].files === undefined, JSON.stringify(editCagrisi[0].files));
  db.deleteTicketPanel(G);
}

/* ================================================================== */
bolum('12) DİĞER SİSTEMLER ETKİLENMEDİ');

{
  check('Banlılar paneli dokunulmadı', typeof require('../src/commands/banlilar').execute === 'function');
  check('Mazeret paneli dokunulmadı', typeof require('../src/commands/mazeretpanel').execute === 'function');
  check('ticketop komutu dokunulmadı', typeof require('../src/commands/ticketop').execute === 'function');
  check('IC sistemi dokunulmadı', typeof require('../src/handlers/icHandler').handleIcButton === 'function');

  const ticketViewsSrc = fs.readFileSync(path.join(KOK, 'src/utils/ticketViews.js'), 'utf8');
  check('Açılan ticket embed\'i korundu', /function buildTicketEmbed/.test(ticketViewsSrc));
  check('Sahiplenme embed\'i korundu', /function buildSahiplenmeEmbed/.test(ticketViewsSrc));
  check('Sahiplenme butonu korundu', /Sahiplenme embed|SAHIPLEN/.test(ticketViewsSrc));

  const eski = fs.readFileSync(path.join(KOK, '.env'), 'utf8');
  check('.env değiştirilmedi', !eski.includes('tk_ac_kategori') && !eski.includes('TICKET_RULES_CHANNEL_ID ='));

  const pkg = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));
  check('Yeni dependency eklenmedi', Object.keys(pkg.dependencies).length === 9, String(Object.keys(pkg.dependencies).length));
}

/* ================================================================== */
console.log('\n' + '='.repeat(68));
console.log(`  SONUÇ:  ${pass} başarılı / ${pass + fail} toplam  /  ${fail} başarısız`);
console.log('='.repeat(68));

db.closeDatabase();
try {
  fs.unlinkSync(process.env.DB_PATH);
} catch {
  /* yok */
}
process.exit(fail ? 1 : 0);
})();