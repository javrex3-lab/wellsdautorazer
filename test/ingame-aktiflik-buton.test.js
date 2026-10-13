/**
 * test/ingame-aktiflik-buton.test.js
 *
 * /ingame ve /aktiflik buton akışı + BUTON YUTULMASI REGRESYON KİLİDİ.
 *
 * GERÇEK HATA (2026-10):
 *   buttonHandler.js -> `if (ban.handleEtkilesim(interaction)) return true;`
 *   handleEtkelesim ASYNC olduğu için her zaman bir Promise döner; Promise her
 *   zaman truthy olduğundan bu satır TÜM butonları yutuyordu. Sonuç:
 *   interaction'a yanıt verilmiyordu, DB'ye yazılmıyordu, mesaj güncellenmiyordu
 *   ve Discord 3 saniye sonra "This interaction failed" gösteriyordu.
 *
 * Kapsam: yalnızca /ingame ve /aktiflik. Başka sistemlere dokunulmaz.
 */
process.env.DB_PATH = require('path').join(require('os').tmpdir(), 'ingamebtn-' + Date.now() + '.db');

const fs = require('fs');
const path = require('path');
const db = require('../src/database/database');
const { handleButton, inferType } = require('../src/handlers/buttonHandler');
const ban = require('../src/handlers/banli');
const embeds = require('../src/utils/embeds');
const ingameCmd = require('../src/commands/ingame');
const aktiflikCmd = require('../src/commands/aktiflik');

const KOK = path.resolve(__dirname, '..');

const G = '1354465879311777893';
const KANAL = '900000000000000001';
const MSG_IG = '1000000000000000001';
const MSG_AK = '1000000000000000002';
const U1 = '100000000000000001';
const U2 = '100000000000000002';
const U3 = '100000000000000003';

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
console.log('  /INGAME + /AKTİFLİK BUTON AKIŞI (regresyon kilidi)');
console.log('='.repeat(70));

/* ------------------------------------------------- sahte Discord interaction */
function etk({ customId, messageId, userId, mesajVar = true }) {
  const st = { cagrilar: [] };
  const kanalMesaji = {
    id: messageId,
    embeds: [],
    components: [],
    edit: async (p) => {
      st.cagrilar.push('edit');
      kanalMesaji.embeds = p.embeds || [];
      kanalMesaji.components = p.components || [];
      return kanalMesaji;
    },
  };
  const it = {
    customId,
    channelId: KANAL,
    guildId: G,
    message: mesajVar ? kanalMesaji : null,
    user: { id: userId, tag: 'test#0001', username: 'test' },
    member: { id: userId, permissions: { has: () => true }, roles: { cache: new Map() } },
    guild: { id: G, channels: { cache: new Map(), fetch: async () => null } },
    channel: { id: KANAL, send: async () => ({}) },
    client: { user: { id: '1559192913009713222' } },
    replied: false,
    deferred: false,
    isRepliable: () => true,
    isButton: () => true,
    reply: async (p) => {
      st.cagrilar.push('reply');
      it.replied = true;
      st.payload = p;
      return kanalMesaji;
    },
    // interaction.update() butonun bağlı olduğu mesajı DÜZENLER
    update: async (p) => {
      st.cagrilar.push('update');
      it.replied = true;
      st.payload = p;
      return kanalMesaji.edit(p);
    },
    deferReply: async () => {
      st.cagrilar.push('deferReply');
      it.deferred = true;
    },
    deferUpdate: async () => {
      st.cagrilar.push('deferUpdate');
      it.deferred = true;
    },
    editReply: async (p) => {
      st.cagrilar.push('editReply');
      st.payload = p;
      return kanalMesaji;
    },
    followUp: async (p) => {
      st.cagrilar.push('followUp');
      st.followUp = p;
      return { id: 'f' };
    },
  };
  return { it, st, kanalMesaji };
}

const ac = (p) => JSON.stringify(p || {});
const panelAc = (km) => (km.embeds[0] ? km.embeds[0].data : null);

/* ================================================================== */
(async () => {

bolum('1) REGRESYON KİLİDİ — buton yutulması');

{
  // handleEtkilesim async → Promise → her zaman truthy.
  // await YOKSA handler erken döner ve interaction cevapsız kalır.
  const p = ban.handleEtkilesim({ customId: 'ingame_join' });
  check('handleEtkilesim async (Promise döner)', p instanceof Promise);
  check('Promise her zaman truthy (bug\'ın sebebi)', Boolean(p) === true);
  check('Gerçek sonucu false', (await p) === false, String(await ban.handleEtkilesim({ customId: 'ingame_join' })));

  const kaynak = fs.readFileSync(path.join(KOK, 'src/handlers/buttonHandler.js'), 'utf8');
  check(
    'KODDA await EKSİK DEĞİL (regresyon kilidi)',
    /if\s*\(\s*await\s+ban\.handleEtkilesim\(interaction\)\s*\)/.test(kaynak),
    'bulunan: ' + (kaynak.match(/if\s*\([^)]*ban\.handleEtkilesim[^)]*\)/) || ['YOK'])[0],
  );
  check('Eski hatali desen KALMADI', !/if\s*\(\s*ban\.handleEtkilesim\(/.test(kaynak));
}

{
  // Kritik regresyon: interaction HER ZAMAN yanıt almalı.
  for (const [cid, tip, msgId] of [
    ['ingame_join', 'ingame', MSG_IG],
    ['ingame_leave', 'ingame', MSG_IG],
    ['aktiflik_join', 'aktiflik', MSG_AK],
  ]) {
    db.deleteSystem(msgId);
    db.upsertSystem({ messageId: msgId, channelId: KANAL, guildId: G, type: tip, createdBy: U1 });
    const { it, st } = etk({ customId: cid, messageId: msgId, userId: U1 });
    await handleButton(it);
    const cevap = st.cagrilar.length > 0;
    check(
      `${cid}: interaction YANIT ALDI (Discord "failed" göstermez)`,
      cevap,
      'çağrılar: ' + JSON.stringify(st.cagrilar),
    );
    check(`${cid}: update/reply içinden biri kullanıldı`, st.cagrilar.includes('update') || st.cagrilar.includes('reply'));
  }
}

/* ================================================================== */
bolum('2) /ingame — Katıl / Ayrıl');

db.deleteSystem(MSG_IG);
db.upsertSystem({ messageId: MSG_IG, channelId: KANAL, guildId: G, type: 'ingame', createdBy: U1 });

{
  const { it, st, kanalMesaji } = etk({ customId: 'ingame_join', messageId: MSG_IG, userId: U1 });
  const r = await handleButton(it);
  check('Katıl: işlendi', r !== false, String(r));
  check('Katıl: mesaj güncellendi', st.cagrilar.includes('update'), JSON.stringify(st.cagrilar));
  check('Katıl: kullanıcıya ephemeral bilgi', st.cagrilar.includes('followUp') && st.followUp?.flags === 64, JSON.stringify(st.cagrilar));

  const liste = db.getIngameLists(MSG_IG);
  check('Katıl: DB kaydı oluştu', liste.joined.length === 1 && liste.joined[0] === U1, JSON.stringify(liste));
  check('Katıl: ayrılanlar boş', liste.left.length === 0, JSON.stringify(liste));

  const e = panelAc(kanalMesaji);
  check('Katıl: embed başlığı doğru', (e?.title || '').includes('INGAME'), e?.title);
  check('Katıl: listede Discord etiketi var', ac(e?.fields?.[0]?.value).includes(`<@${U1}>`), ac(e?.fields?.[0]?.value));
  check('Katıl: butonlar korundu', ac(e && kanalMesaji.components).includes('ingame_join'));
}

{
  // Aynı kullanıcı tekrar Katıl → duplicate yok, bilgi verilir
  const { it, st } = etk({ customId: 'ingame_join', messageId: MSG_IG, userId: U1 });
  await handleButton(it);
  const liste = db.getIngameLists(MSG_IG);
  check('Tekrar Katıl: DUPLICATE OLUŞMADI', liste.joined.length === 1, JSON.stringify(liste));
  check('Tekrar Katıl: ephemeral "zaten" mesajı', st.cagrilar.includes('reply') && /zaten/i.test(st.payload?.content || ''), ac(st.payload));
}

{
  const { it, st } = etk({ customId: 'ingame_leave', messageId: MSG_IG, userId: U1 });
  await handleButton(it);
  const liste = db.getIngameLists(MSG_IG);
  check('Ayrıl: katılanlardan çıktı', liste.joined.length === 0, JSON.stringify(liste));
  check('Ayrıl: ayrılanlara eklendi', liste.left.length === 1 && liste.left[0] === U1, JSON.stringify(liste));
  check('Ayrıl: mesaj güncellendi', st.cagrilar.includes('update'));
  check('Ayrıl: mesaj yeniden çizildi', (panelAc(st.payload?.embeds ? { embeds: st.payload.embeds } : { embeds: [] })?.title || '').includes('INGAME'));
}

{
  // Ayrıl -> Katıl geri dönüş
  await handleButton(etk({ customId: 'ingame_join', messageId: MSG_IG, userId: U1 }).it);
  const liste = db.getIngameLists(MSG_IG);
  check('Geri dönüş: katılanlara döndü', liste.joined.length === 1 && liste.left.length === 0, JSON.stringify(liste));
}

{
  // AYNI ANDA İKİ LİSTEDE OLAMAZ (mutual exclusion)
  db.setIngameStatus(MSG_IG, U3, 'left');
  check('Mutual exclusion: U3 sadece ayrılanlarda', !db.getIngameStatus(MSG_IG, U3) === false || db.getIngameStatus(MSG_IG, U3) === 'left', db.getIngameStatus(MSG_IG, U3));
  const l = db.getIngameLists(MSG_IG);
  check('Mutual exclusion: listede tek yerde', l.joined.includes(U3) !== l.left.includes(U3), JSON.stringify(l));
}

/* ================================================================== */
bolum('3) /aktiflik — Katıl');

db.deleteSystem(MSG_AK);
db.upsertSystem({ messageId: MSG_AK, channelId: KANAL, guildId: G, type: 'aktiflik', createdBy: U1 });

{
  const { it, st, kanalMesaji } = etk({ customId: 'aktiflik_join', messageId: MSG_AK, userId: U1 });
  const r = await handleButton(it);
  check('Katıl: işlendi', r !== false, String(r));
  check('Katıl: mesaj güncellendi', st.cagrilar.includes('update'), JSON.stringify(st.cagrilar));

  const liste = db.getAktiflikList(MSG_AK);
  check('Katıl: DB kaydı', liste.length === 1 && liste[0] === U1, JSON.stringify(liste));

  const e = panelAc(kanalMesaji);
  check('Katıl: listede Discord etiketi var', ac(e?.fields?.[0]?.value).includes(`<@${U1}>`), ac(e?.fields?.[0]?.value));
}

{
  const { it, st } = etk({ customId: 'aktiflik_join', messageId: MSG_AK, userId: U1 });
  await handleButton(it);
  const liste = db.getAktiflikList(MSG_AK);
  check('Tekrar Katıl: DUPLICATE OLUŞMADI', liste.length === 1, JSON.stringify(liste));
  check('Tekrar Katıl: "zaten listedesiniz" bilgisi', /zaten/i.test(st.followUp?.content || st.payload?.content || ''), ac(st.followUp || st.payload));
  check('Tekrar Katıl: mesaj yine de güncellendi', st.cagrilar.includes('update'), JSON.stringify(st.cagrilar));
}

/* ================================================================== */
bolum('4) ÇOKLU KULLANICI — veri kaybı yok');

{
  await handleButton(etk({ customId: 'aktiflik_join', messageId: MSG_AK, userId: U2 }).it);
  const liste = db.getAktiflikList(MSG_AK);
  check('Aktiflik: 2 kullanıcı var', liste.length === 2, JSON.stringify(liste));
  check('Aktiflik: ilk kullanıcı KORUNDU', liste.includes(U1), JSON.stringify(liste));
  check('Aktiflik: ikinci kullanıcı eklendi', liste.includes(U2), JSON.stringify(liste));
  check('Aktiflik: duplicate yok', new Set(liste).size === liste.length, JSON.stringify(liste));

  await handleButton(etk({ customId: 'ingame_join', messageId: MSG_IG, userId: U2 }).it);
  const ig = db.getIngameLists(MSG_IG);
  check('Ingame: 2 kullanıcı katıldı', ig.joined.length === 2, JSON.stringify(ig));
  check('Ingame: ilk kullanıcı KORUNDU', ig.joined.includes(U1), JSON.stringify(ig));
}

{
  // PANEL İZOLASYONU: ingame işlemi aktiflik listesini ETKİLEMEMELİ
  const aktifOnce = db.getAktiflikList(MSG_AK);
  await handleButton(etk({ customId: 'ingame_join', messageId: MSG_IG, userId: U3 }).it);
  const aktifSonra = db.getAktiflikList(MSG_AK);
  check('Panel izolasyonu: aktiflik listesi değişmedi', ac(aktifOnce) === ac(aktifSonra), ac(aktifOnce) + ' -> ' + ac(aktifSonra));
}

/* ================================================================== */
bolum('5) HATA DURUMLARI — kontrollü yanıt');

{
  const { it, st } = etk({ customId: 'aktiflik_join', messageId: MSG_AK, userId: U1, mesajVar: false });
  const r = await handleButton(it);
  check('Mesaj bilgisi yoksa: işlendi', r !== false, String(r));
  check('Mesaj bilgisi yoksa: ephemeral hata', st.cagrilar.includes('reply') && st.cagrilar.length === 1, JSON.stringify(st.cagrilar));
  check('Mesaj bilgisi yoksa: HICBIR cevapsiz kalmadi', st.cagrilar.length > 0, JSON.stringify(st.cagrilar));
}

{
  const BILINMEYEN = '1000000000000009999';
  db.deleteSystem(BILINMEYEN);
  const { it, st } = etk({ customId: 'aktiflik_join', messageId: BILINMEYEN, userId: U2 });
  const r = await handleButton(it);
  check('DB kaydı yoksa (adopt): işlendi', r !== false, String(r));
  check('DB kaydı yoksa: mesaj güncellendi', st.cagrilar.includes('update'), JSON.stringify(st.cagrilar));
  check('DB kaydı yoksa: self-healing kayıt oluştu', db.getSystem(BILINMEYEN)?.type === 'aktiflik', JSON.stringify(db.getSystem(BILINMEYEN)));
  check('DB kaydı yoksa: katılım yine de kaydedildi', db.getAktiflikList(BILINMEYEN).includes(U2), JSON.stringify(db.getAktiflikList(BILINMEYEN)));
  check('DB kaydı yoksa: durum gizlenmedi (followUp notu)', ac(st.followUp).includes('Not:'), ac(st.followUp));
}

{
  // update patlarsa (mesaj silinmis olabilir) — interaction yine de cevap alir
  const SILINMIS = '1000000000000008888';
  db.deleteSystem(SILINMIS);
  db.upsertSystem({ messageId: SILINMIS, channelId: KANAL, guildId: G, type: 'aktiflik', createdBy: U1 });
  const { it, st } = etk({ customId: 'aktiflik_join', messageId: SILINMIS, userId: U3 });
  it.update = async () => {
    const e = new Error('Unknown Message');
    e.code = 10008;
    throw e;
  };
  const r = await handleButton(it);
  check('Güncelleme hatası: interaction yine de yanıtlandı', st.cagrilar.length > 0, JSON.stringify(st.cagrilar));
  // update() basarisiz olursa interaction.replied false kalir; o durumda
  // reply() kullanmak dogrudur. Kullanici her durumda yanit almali.
  check('Güncelleme hatası: kullanıcı yanıt aldı (reply veya followUp)', st.cagrilar.includes('followUp') || st.cagrilar.includes('reply'), JSON.stringify(st.cagrilar));
  check('Güncelleme hatası: 10008 kaydı temizlendi', db.getSystem(SILINMIS) === null, JSON.stringify(db.getSystem(SILINMIS)));
  check('Güncelleme hatası: r !== false', r !== false, String(r));
}

/* ================================================================== */
bolum('6) DİĞER SİSTEMLER BOZULMADI');

{
  // bn_ butonlari hala calisiyor mu (fix'in yan etkisi kontrolu)
  check('banlılar CID.BILDIR = bn_bildir', ban.CID.BILDIR === 'bn_bildir', ban.CID.BILDIR);

  const bh = fs.readFileSync(path.join(KOK, 'src/handlers/buttonHandler.js'), 'utf8');
  check('Ticket butonları ban satırından ÖNCE', bh.indexOf('tickets.CID.KABUL') < bh.indexOf('ban.handleEtkilesim'));
  check('IC butonları ban satırından ÖNCE', bh.indexOf("customId === 'ic_approve'") < bh.indexOf('ban.handleEtkilesim'));
  check('Mazeret butonları ban satırından ÖNCE', bh.indexOf('mz.CID.BILDIR') < bh.indexOf('ban.handleEtkilesim'));
  check('quit_roles ban satırından SONRA (düzeltmeyle çalışır)', bh.indexOf("'quit_roles'") > bh.indexOf('ban.handleEtkilesim'));
  check('fivem_p_ ban satırından SONRA (düzeltmeyle çalışır)', bh.indexOf("'fivem_p_'") > bh.indexOf('ban.handleEtkilesim'));
  check('ingame/aktiflik listesi ban satırından SONRA', bh.indexOf("'ingame_join', 'ingame_leave'") > bh.indexOf('ban.handleEtkilesim'));
  check('handleButton hala async', /async function handleButton/.test(bh));
  check('inferType hala export ediliyor', typeof inferType === 'function');
}

{
  check('inferType: ingame_join -> ingame', inferType('ingame_join') === 'ingame', inferType('ingame_join'));
  check('inferType: ingame_leave -> ingame', inferType('ingame_leave') === 'ingame');
  check('inferType: aktiflik_join -> aktiflik', inferType('aktiflik_join') === 'aktiflik', inferType('aktiflik_join'));
  check('inferType: bilinmeyen -> null', inferType('xx_yy') === null, String(inferType('xx_yy')));
}

/* ================================================================== */
bolum('7) YENİDEN BAŞLATMA SONRASI (kalıcılık)');

{
  check('Katılımcı verisi DB\'de (bellekte değil)', typeof db.getIngameLists(MSG_IG).joined[0] === 'string');
  check('Sistem kaydı DB\'de', db.getSystem(MSG_IG)?.type === 'ingame', JSON.stringify(db.getSystem(MSG_IG)));
  check('Sistem kaydı aktiflik için de var', db.getSystem(MSG_AK)?.type === 'aktiflik');

  // Bot yeniden baslasa da ayni mesaja basildiginda kayit cozulur
  const yeni = db.getSystem(MSG_AK);
  check('Yeniden başlatma: mesaj kimliğiyle çözülür', yeni?.message_id === MSG_AK, yeni?.message_id);
  check('Yeniden başlatma: kanal bilgisi saklanır', yeni?.channel_id === KANAL, yeni?.channel_id);
  check('Yeniden başlatma: guild bilgisi saklanır', yeni?.guild_id === G, yeni?.guild_id);

  // Butonlar statik customId kullanir (mesaj kimligi gömülü DEĞİL) → eski mesajlar calisir
  const igB = ingameCmd.buildButtons().toJSON().components.map((x) => x.custom_id);
  const akB = aktiflikCmd.buildButtons().toJSON().components.map((x) => x.custom_id);
  check('Buton customId statik (eski mesajlarda da çalışır)', ac(igB) === ac(['ingame_join', 'ingame_leave']), ac(igB));
  check('Aktiflik customId statik', ac(akB) === ac(['aktiflik_join']), ac(akB));
  check('Butonlarda mesaj kimliği gömülü değil', !ac(igB).includes(MSG_IG) && !ac(akB).includes(MSG_AK));
}

/* ================================================================== */
bolum('8) EVENT KAYDI — birden fazla kez kayıt EDİLMİYOR');

{
  const idx = fs.readFileSync(path.join(KOK, 'index.js'), 'utf8');
  const interactionCreate = idx.match(/require\('\.\/src\/events\/interactionCreate'\)/g) || [];
  check('interactionCreate require EDİLMİYOR (bir kez)', interactionCreate.length === 1, String(interactionCreate.length));
  const kayit = idx.match(/client\.on\(interactionEvent\.name/g) || [];
  check('client.on(interactionCreate) bir kez', kayit.length === 1, String(kayit.length));
  const once = idx.match(/client\.once\(readyEvent\.name/g) || [];
  check('readyEvent client.once ile kayıtlı (iki kez çalışmaz)', once.length === 1, String(once.length));

  const ev = fs.readFileSync(path.join(KOK, 'src/events/interactionCreate.js'), 'utf8');
  check('event adı interactionCreate', /name:\s*'interactionCreate'/.test(ev));
  check('tek execute export ediliyor', (ev.match(/async execute\(/g) || []).length === 1);
  check('isButton dalı var', /interaction\.isButton\(\)/.test(ev));
  check('bilinmeyen buton kullanıcıya bildiriliyor', /Bilinmeyen buton/.test(ev));
  check('çift yanıt koruması (replied/deferred kontrolü)', /!interaction\.replied && !interaction\.deferred/.test(ev));
}

/* ================================================================== */
bolum('9) GÜVENLİK / HİJYEN');

{
  const kaynaklar = [
    'src/handlers/buttonHandler.js',
    'src/commands/ingame.js',
    'src/commands/aktiflik.js',
    'src/utils/embeds.js',
  ].map((f) => fs.readFileSync(path.join(KOK, f), 'utf8'));
  const token = kaynaklar.join('\n');
  const gizli = /\bMTIz[A-Za-z0-9_-]{20,}|DISCORD_BOT_TOKEN\s*=\s*['"][^'"]+['"]/.test(token);
  check('Token gömülü değil', !gizli);
  check('Boş catch bloğu yok (buttonHandler)', !/\}\s*catch\s*\{\s*\}/.test(kaynaklar[0]));
  check('Panel görselleri config üzerinden okunuyor', /config\.ingamePanelImage/.test(kaynaklar[3]) && /config\.aktiflikPanelImage/.test(kaynaklar[3]));

  check('formatUserList boş listede "Henüz kimse yok" döner', embeds.formatUserList([]).includes('Henüz kimse yok'));
  check('formatUserList 1024 karakter sınırını aşmıyor', embeds.formatUserList(Array(300).fill('100000000000000001')).length <= 1024);
  check('katılımcılar benzersiz Discord ID ile takip ediliyor', /user_id/.test(fs.readFileSync(path.join(KOK, 'src/database/schema.js'), 'utf8')));
  check('PRIMARY KEY (message_id, user_id) — duplicate DB seviyesinde engelli', /PRIMARY KEY \(message_id, user_id\)/.test(fs.readFileSync(path.join(KOK, 'src/database/schema.js'), 'utf8')));

  check('.env değiştirilmedi', !fs.readFileSync(path.join(KOK, '.env'), 'utf8').includes('ingame_join'));
  const pkg = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));
  check('Yeni dependency eklenmedi', Object.keys(pkg.dependencies).length === 9, String(Object.keys(pkg.dependencies).length));
}

/* ================================================================== */
console.log('\n' + '='.repeat(70));
console.log(`  SONUÇ:  ${pass} başarılı / ${pass + fail} toplam  /  ${fail} başarısız`);
console.log('='.repeat(70));

db.closeDatabase();
try {
  fs.unlinkSync(process.env.DB_PATH);
} catch {
  /* yok */
}
process.exit(fail ? 1 : 0);
})();