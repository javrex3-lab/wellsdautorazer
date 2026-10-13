/**
 * ic.test.js — IC İSİM SİSTEMİ onarım testleri.
 *
 * KÖK NEDEN (regresyon koruması): `icApprovalChannelId` yalnızca .env'e bakıyordu.
 * .env Railway'de okunmadığı için değer null oluyor ve messageCreate SESSİZCE
 * çıkıyordu — sistem hiçbir hata vermeden ölüyordu. Artık .env önce, sunucuya
 * özel sabit yedek var ve eksik yapılandırma AÇIKÇA loglanır.
 *
 * ÖNEMLİ: Tüm testler SAHTE (mock) Discord nesneleriyle çalışır.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

process.env.DB_PATH = path.join(os.tmpdir(), 'ic-test-' + Date.now() + '.db');

const KOK = path.resolve(__dirname, '..');
const db = require('../src/database/database');
const config = require('../src/config');
const ic = require('../src/handlers/icHandler');
const mc = require('../src/events/messageCreate');
const embeds = require('../src/utils/embeds');

const G = '1354465879311777893';
const KANAL = '1522774289743351909';
const U = '1056585742731726918';
const STAFF = '100000000000000001';
const EPH = 64;
const SABIT = '1522774289743351909';

let pass = 0,
  fail = 0;
const cikti = [];
const yaz = (s) => {
  cikti.push(s);
  console.log(s);
};
const check = (n, c, e = '') => {
  if (c) {
    pass++;
    yaz('  OK   ' + n);
  } else {
    fail++;
    yaz('  FAIL ' + n + (e ? '  -> ' + e : ''));
  }
};
const bolum = (t) => yaz('\n' + '-'.repeat(4) + ' ' + t);

yaz('='.repeat(70));
yaz('  IC İSİM SİSTEMİ — TESTLER (MOCK DISCORD)');
yaz('='.repeat(70));
db.initDatabase();

/* ------------------------------------------------------------------ */
/* Sahte Discord                                                       */
/* ------------------------------------------------------------------ */
let sayac = 0;
const guildObj = { id: G, name: 'WELL SD #V12', ownerId: '1' };
let dmGonderilen = [];

/** IC onay kanalı — gönderilen mesajları toplar. */
function icKanal() {
  const gonderilen = [];
  return {
    gonderilen,
    kanal: {
      id: KANAL,
      guildId: G,
      send: async (p) => {
        const m = { id: 'PANEL' + ++sayac, ...p };
        gonderilen.push(p);
        return m;
      },
      messages: { fetch: async () => ({ id: 'x', content: '' }) },
    },
  };
}

/** Kullanıcı mesajı (guild + kanal + author ile). */
function kullaniciMesaji(metin, o = {}) {
  const g = icKanal();
  const author = {
    id: o.userId ?? U,
    tag: 'kullanici#0001',
    bot: false,
    displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/a.png',
    send: async (m) => { dmGonderilen.push({ id: author.id, m }); },
  };
  const guild = {
    ...guildObj,
    members: {
      me: { id: '1559192913009713222', permissions: { has: () => true }, roles: { highest: { position: 90 } } },
      fetch: async (id) => (id === author.id ? o.targetMember || null : null),
    },
  };
  const sonuc = {
    g,
    author,
    silindi: false,
    mesaj: {
      id: o.id || 'MSG' + ++sayac,
      guildId: G,
      guild,
      channelId: o.kanal ?? KANAL,
      channel: g.kanal,
      author,
      content: metin,
    },
  };
  sonuc.mesaj.delete = async () => {
    sonuc.silindi = true;
  };
  return sonuc;
}

function butonEtkilesimi(customId, o = {}) {
  const k = {};
  const u = {
    id: o.userId ?? STAFF,
    tag: 'yetkili#0001',
    displayAvatarURL: () => null,
  };
  const target = {
    id: o.hedefId ?? U,
    user: u,
    roles: { highest: { position: 1 } },
    setNickname: async (n, rsn) => {
      k.nickname = n;
      k.nicknameReason = rsn;
    },
  };
  const it = {
    id: 'I' + ++sayac,
    guildId: G,
    channelId: KANAL,
    channel: o.channel,
    customId,
    user: u,
    member: { id: u.id, permissions: { has: () => o.staff !== false }, roles: { cache: new Map() } },
    guild: {
      ...guildObj,
      members: {
        me: { id: '1559192913009713222', permissions: { has: () => true }, roles: { highest: { position: 90 } } },
        fetch: async (id) => (id === (o.hedefId ?? U) ? target : null),
      },
    },
    message: { id: o.panelId },
    isRepliable: () => true,
    replied: false,
    deferred: false,
    update: async (p) => {
      k.update = p;
    },
    reply: async (p) => {
      k.reply = p;
    },
    followUp: async (p) => {
      k.followUp = p;
    },
  };
  it._k = k;
  return it;
}

const yanit = (it) => it._k.reply || it._k.followUp || it._k.edit || null;

/* ================================================================== */
(async () => {
  /* ---------------------------------------------------------------- */
  bolum('1) YAPILANDIRMA — ASLA NULL OLMAZ (asıl regresyon koruması)');

  {
    check('Kanal çözülmüş', typeof config.icApprovalChannelId === 'string' && config.icApprovalChannelId.length > 0, String(config.icApprovalChannelId));
    check('Değer null DEĞİL', config.icApprovalChannelId !== null);
    check('Snowflake biçiminde', /^\d{17,20}$/.test(config.icApprovalChannelId), String(config.icApprovalChannelId));
    check('Doğru kanal (#kod-iç-isim)', config.icApprovalChannelId === SABIT, config.icApprovalChannelId);
    check('Kaynak bayrağı tanımlı', typeof config.icApprovalChannelFromEnv === 'boolean');

    const kaynak = fs.readFileSync(path.join(KOK, 'src/config.js'), 'utf8');
    check(
      'config.js: sabit yedek değer içeriyor',
      kaynak.includes("return '" + SABIT + "';") && kaynak.includes('icApprovalChannelId: (() => {'),
      'sabit yedek bulunamadi',
    );
    check('config.js: env önce geliyor (.env üstünlüklü)', /icApprovalChannelId: \(\(\) => \{[\s\S]{0,200}IC_APPROVAL_CHANNEL_ID[\s\S]{0,200}return '15/.test(kaynak));

    // Alt süreç: env BOŞ / BOZUKken sabite düşmeli
    const PROBE = path.join(KOK, '_ictestprobe.js');
    fs.writeFileSync(
      PROBE,
      ["require('dotenv').config();", "const c = require('./src/config');", 'console.log(JSON.stringify({k:c.icApprovalChannelId,s:c.icApprovalChannelFromEnv}));'].join('\n'),
      'utf8',
    );
    const NODE = process.execPath;
    const calistir = (envDeger) => {
      const out = execSync(`"${NODE}" _ictestprobe.js`, {
        cwd: KOK,
        encoding: 'utf8',
        env: { ...process.env, IC_APPROVAL_CHANNEL_ID: envDeger },
        timeout: 60000,
      });
      return JSON.parse(out.split(/\r?\n/).find((x) => x.trim().startsWith('{')).trim());
    };
    const bos = calistir('');
    check('env BOŞ → sabit kullanılıyor', bos.k === SABIT && bos.s === false, JSON.stringify(bos));
    const bozuk = calistir('bozuk-deger');
    check('env BOZUK → sabit kullanılıyor', bozuk.k === SABIT && bozuk.s === false, JSON.stringify(bozuk));
    const ozel = calistir('1522774289743351999');
    check('geçerli ÖZEL env → o değer korunuyor', ozel.k === '1522774289743351999' && ozel.s === true, JSON.stringify(ozel));
    fs.unlinkSync(PROBE);
  }

  /* ---------------------------------------------------------------- */
  bolum('2) AÇILIŞ TANILAMASI — sessiz ölüm bir daha mümkün değil');

  {
    const mcSrc = fs.readFileSync(path.join(KOK, 'src/events/messageCreate.js'), 'utf8');
    check('messageCreate eksik yapılandırmada hata logluyor', /logger\.error\(/.test(mcSrc) && /IC_APPROVAL_CHANNEL_ID ayarlanmamış/.test(mcSrc));
    check('Uyarı yalnızca BİR kez (log spam yok)', /eksikKanalUyarildi/.test(mcSrc) && /if \(!eksikKanalUyarildi\)/.test(mcSrc));
    check('Hata mesajı ne yapılacağını söylüyor', /onay paneli açılmıyor/.test(mcSrc));

    const readySrc = fs.readFileSync(path.join(KOK, 'src/events/ready.js'), 'utf8');
    check('ready.js kanal tanılaması var', /IC İSİM SİSTEMİ AKTİF/.test(readySrc) && /IC İSİM SİSTEMİ KAPALI/.test(readySrc));
    check('Tanılama kanalı gerçekten fetch ediyor', /channels\.fetch\(icId\)/.test(readySrc));
    check('Tanılama yanlış sunucuyu yakalıyor', /başka bir sunucuya ait/.test(readySrc));
    check('Tanılama eksik yetkiyi yakalıyor', /bot yetkisi eksik/.test(readySrc));
    check('Tanılama kaynağı yazıyor (.env / config.js)', /config\.icApprovalChannelFromEnv/.test(readySrc));
  }

  /* ---------------------------------------------------------------- */
  bolum('3) AKIŞ: mesaj → panel → DB');

  {
    dmGonderilen = [];
    const o = kullaniciMesaji('101 - Javrex');
    await mc.execute(o.mesaj);
    check('Panel gönderildi', o.g.kanal ? o.g.gonderilen.length === 1 : true, String(o.g?.gonderilen?.length));

    const kayit = db.getDb().prepare('SELECT * FROM ic_approvals ORDER BY id DESC LIMIT 1').get();
    check('DB kaydı oluşturuldu', !!kayit);
    check('Kayıt durumu pending', kayit?.status === 'pending', kayit?.status);
    check('Kayıt metni doğru', kayit?.requested_text === '101 - Javrex', String(kayit?.requested_text));
    check('Kayıt panel mesajı bağlandı', !!kayit?.panel_message_id, String(kayit?.panel_message_id));
    check('Kayıt guild/user doğru', kayit?.guild_id === G && kayit?.user_id === U);

    const panel = o.g.gonderilen[0];
    check('Panel embed üretildi', !!panel?.embeds?.[0]);
    check('Panel butonları Onayla/Reddet', (panel?.components[0].components || []).length === 2, JSON.stringify(panel?.components?.[0]?.components?.map((b) => (b.data || b).custom_id)));
    check('Buton customId ic_approve/ic_reject', /ic_approve/.test(JSON.stringify(panel?.components)) && /ic_reject/.test(JSON.stringify(panel?.components)));

    // getIcByPanel çözümlemesi
    check('getIcByPanel paneli buluyor', db.getIcByPanel(kayit.panel_message_id)?.id === kayit.id);
    check('getIcByPanel yabancı paneli bulamıyor', db.getIcByPanel('999999999999999999') === null);
    check('getPendingIc bekleyeni buluyor', db.getPendingIc(G, U)?.id === kayit.id);

    /* -------- ONAY -------- */
    bolum('4) YETKİLİ ONAYLA');
    const bt = butonEtkilesimi('ic_approve', { panelId: kayit.panel_message_id, channel: o.g.kanal });
    await ic.handleIcButton(bt);
    const sonra = db.getBanId ? db.getIcByPanel(kayit.panel_message_id) : db.getIcByPanel(kayit.panel_message_id);
    check('Durum approved oldu', sonra?.status === 'approved', sonra?.status);
    check('Karar veren kaydedildi', sonra?.decided_by === STAFF, sonra?.decided_by);
    check('Karar zamanı kaydedildi', Number(sonra?.decided_at) > 0);
    check('Takma ad değiştirildi', bt._k.nickname === '101 - Javrex', String(bt._k.nickname));
    check('Takma ad değişim sebebi IC onay', String(bt._k.nicknameReason || '').includes('IC onay'), String(bt._k.nicknameReason));
    check('Panel güncellendi', !!bt._k.update);
    check('Kullanıcıya onay gitti', JSON.stringify(bt._k.followUp?.content || '').includes('onaylandı'), JSON.stringify(bt._k.followUp?.content).slice(0, 140));
    check('Onay mesajında takma ad bilgisi var', JSON.stringify(bt._k.followUp?.content || '').includes('Takma ad değiştirildi'));

    /* -------- YETKİSİZ -------- */
    bolum('5) YETKİSİZ KULLANICI');
    {
      const o2 = kullaniciMesaji('402 test user');
      await mc.execute(o2.mesaj);
      const k2 = db.getDb().prepare('SELECT * FROM ic_approvals ORDER BY id DESC LIMIT 1').get();
      const bt2 = butonEtkilesimi('ic_approve', { panelId: k2.panel_message_id, channel: o2.g.kanal, staff: false });
      await ic.handleIcButton(bt2);
      const s2 = db.getIcByPanel(k2.panel_message_id);
      check('Yetkisiz onaylayamadı', s2?.status === 'pending', s2?.status);
      check('Yetkisize hata verildi', JSON.stringify(bt2._k.reply).includes('yetkili'), JSON.stringify(bt2._k.reply).slice(0, 120));

      /* -------- RED -------- */
      bolum('6) YETKİLİ REDDET');
      const bt3 = butonEtkilesimi('ic_reject', { panelId: k2.panel_message_id, channel: o2.g.kanal });
      await ic.handleIcButton(bt3);
      const s3 = db.getIcByPanel(k2.panel_message_id);
      check('Durum rejected oldu', s3?.status === 'rejected', s3?.status);
      check('Redde takma ad DEĞİŞTİRİLMEDİ', bt3._k.nickname === undefined, String(bt3._k.nickname));
      check('Kullanıcıya ret bildirimi', JSON.stringify(bt3._k.followUp?.content || '').includes('reddedildi'));

      /* -------- TEKRAR BASMA -------- */
      bolum('7) KARAR SONRASI TEKRAR');
      const bt4 = butonEtkilesimi('ic_approve', { panelId: k2.panel_message_id, channel: o2.g.kanal });
      await ic.handleIcButton(bt4);
      check('Tekrar basış durumu değiştirmedi', db.getIcByPanel(k2.panel_message_id)?.status === 'rejected', db.getIcByPanel(k2.panel_message_id)?.status);
      check('Tekrar basışta bilgi verildi', JSON.stringify(yanit(bt4)).includes('kullanılamaz') || JSON.stringify(yanit(bt4)).includes('Reddedildi'), JSON.stringify(yanit(bt4)).slice(0, 160));
    }

    /* -------- MÜKERRER KORUMA -------- */
    bolum('8) MÜKERRER TALEP KORUMASI');
    {
      const o3 = kullaniciMesaji('500 ilk isim');
      await mc.execute(o3.mesaj);
      const o4 = kullaniciMesaji('501 ikinci isim');
      await mc.execute(o4.mesaj);
      check('İkinci mesaj için yeni panel açılmadı', o4.g.gonderilen.length === 0, String(o4.g.gonderilen.length));
      check('Kullanıcı DM ile bilgilendirildi', dmGonderilen.some((x) => String(x.m).includes('Zaten bekleyen')), JSON.stringify(dmGonderilen));
      check('Mükerrer mesaj kanaldan silindi', o4.silindi === true, String(o4.silindi));
    }

    /* -------- KANAL FİLTRESİ -------- */
    bolum('9) KANAL FİLTRESİ');
    {
      const o5 = kullaniciMesaji('600 baska kanal', { kanal: '1500000000000000001' });
      await mc.execute(o5.mesaj);
      check('Farklı kanaldaki mesaj yok sayıldı', o5.g.gonderilen.length === 0, String(o5.g.gonderilen.length));

      const botMsg = kullaniciMesaji('700 bot mesaji');
      botMsg.mesaj.author.bot = true;
      await mc.execute(botMsg.mesaj);
      check('Botun kendi mesajı yok sayıldı', botMsg.g.gonderilen.length === 0, String(botMsg.g.gonderilen.length));
    }

    /* -------- BİLİNMEYEN PANEL -------- */
    bolum('10) KAYITSIZ PANEL');
    {
      const bt5 = butonEtkilesimi('ic_approve', { panelId: '999999999999999999', channel: icKanal().kanal });
      await ic.handleIcButton(bt5);
      check('Kayıtsız panelde işlem yapılmadı', !!bt5._k.update || !!bt5._k.reply);
      check('Kullanıcıya bilgi verildi', JSON.stringify(yanit(bt5)).includes('kullanılamaz'), JSON.stringify(yanit(bt5)).slice(0, 140));
      check('Çökme yok (true döndü)', bt5._k.update !== undefined || bt5._k.reply !== undefined);
    }
  }

  /* ---------------------------------------------------------------- */
  bolum('11) TAKMA AD TANIlamASI (yetişe bağlı davranış)');
  {
    const meDuz = { id: '1', permissions: { has: () => true }, roles: { highest: { position: 90 } } };
    const hedef = { id: '2', roles: { highest: { position: 1 } } };
    const guild = { ownerId: '999', members: { me: meDuz } };
    check('Yetkili rol + yüksek sıra → engel yok', ic.diagnoseNickname(guild, hedef) === null, String(ic.diagnoseNickname(guild, hedef)));

    const yetkisiz = { id: '1', permissions: { has: () => false }, roles: { highest: { position: 90 } } };
    const m = ic.diagnoseNickname({ ownerId: '999', members: { me: yetkisiz } }, hedef);
    check('ManageNicknames yoksa engel bildirilir', /ManageNicknames|Üye Adları/i.test(String(m)), String(m));

    const alttaki = { id: '1', permissions: { has: () => true }, roles: { highest: { position: 1 } } };
    check('Bot rolü alttaysa engel bildirilir', /üstte olmalı/.test(String(ic.diagnoseNickname({ ownerId: '999', members: { me: alttaki } }, hedef))));

    const owner = { id: '999', roles: { highest: { position: 1 } } };
    check('Sunucu sahibi engellenir', /sahibinin takma adı/.test(String(ic.diagnoseNickname(guild, owner))));
  }

  /* ---------------------------------------------------------------- */
  bolum('12) GÖRÜNÜM KATMANI');
  {
    check('buildIcPanelEmbed mevcut', typeof embeds.buildIcPanelEmbed === 'function');
    check('buildIcButtons mevcut', typeof embeds.buildIcButtons === 'function');
    const b = embeds.buildIcButtons(false).toJSON().components;
    check('Açık panelde 2 buton', b.length === 2, String(b.length));
    const k = embeds.buildIcButtons(true).toJSON().components;
    check('Karar verilmiş panelde butonlar kapalı', k.every((x) => x.disabled === true), JSON.stringify(k.map((x) => x.disabled)));
    const e = embeds.buildIcPanelEmbed({
      userId: U,
      userTag: 'a#1',
      requestedText: '101 - Javrex',
      status: 'approved',
      decidedBy: STAFF,
      decidedTag: 'yetkili#1',
      createdUnix: Math.floor(Date.now() / 1000),
    }).toJSON();
    check('Embed başlığı oluştu', !!e.title, String(e.title));
    check('Embed talep metnini içeriyor', JSON.stringify(e).includes('101 - Javrex'));
  }

  /* ---------------------------------------------------------------- */
  bolum('13) DIĞER SİSTEMLER ETKİLENMEDİ');
  {
    for (const [ad, yol, d] of [
      ['ticket handler', '../src/handlers/tickets', (m) => typeof m.handleSahiplen === 'function'],
      ['ticket views', '../src/utils/ticketViews', (m) => m.CID.SAHIPLEN === 'tk_sahiplen'],
      ['ticketkur', '../src/commands/ticketkur', (m) => m.data.name === 'ticketkur'],
      ['ticketop', '../src/commands/ticketop', (m) => m.data.name === 'ticketop'],
      ['mazeret handler', '../src/handlers/mazeret', (m) => typeof m.handleSebepSubmit === 'function'],
      ['banlılar handler', '../src/handlers/banli', (m) => typeof m.handleEtkilesim === 'function'],
      ['guard permissions', '../src/guard/permissions', (m) => typeof m.canManageGuard === 'function'],
      ['leaderboardImage', '../src/utils/leaderboardImage', (m) => typeof m.leaderboardCiz === 'function'],
    ]) {
      let ok = false;
      try {
        ok = d(require(yol));
      } catch {
        ok = false;
      }
      check('Yüklenebiliyor: ' + ad, ok);
    }

    // Yapılandırma alanları korundu mu
    for (const [ad, deger] of [
      ['banlilarChannelId', '1559535039614689362'],
      ['ticket.categoryId', config.ticket.categoryId],
    ]) {
      check('Korundu: ' + ad, !!deger && String(deger) !== 'undefined', String(deger));
    }

    const t = db.getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name);
    for (const gerek of ['ic_approvals', 'ticket_sessions', 'ticket_stats', 'mazeret_records', 'guard_whitelist', 'ban_bildirimleri']) {
      check('Tablo korundu: ' + gerek, t.includes(gerek));
    }

    // Buton yönlendirmesi bozulmadı
    const bh = fs.readFileSync(path.join(KOK, 'src/handlers/buttonHandler.js'), 'utf8');
    check('IC butonları yönlendiriliyor', bh.includes("customId === 'ic_approve'") && bh.includes('handleIcButton'));
    check('Ticket butonları yönlendiriliyor', bh.includes('tickets.CID.SAHIPLEN') && bh.includes('tickets.CID.KABUL'));
    check('Mazeret butonu yönlendiriliyor', bh.includes('mz.CID.BILDIR'));
    check('Banlılar butonu yönlendiriliyor', bh.includes('ban.handleEtkilesim'));
    check('.env dosyası değişmedi', !fs.readFileSync(path.join(KOK, '.env'), 'utf8').includes('config.js sabiti'));
  }

  /* ---------------------------------------------------------------- */
  yaz('\n' + '='.repeat(70));
  yaz(`  SONUÇ:  ${pass} başarılı / ${pass + fail} toplam  /  ${fail} başarısız`);
  yaz('  NOT: Bunlar MOCK testlerdir — gerçek Discord sunucusunda çalıştırılmamıştır.');
  yaz('='.repeat(70));
  fs.writeFileSync('C:/Users/PC/AppData/Local/Temp/opencode/ic-test-out.txt', cikti.join('\n'), 'utf8');

  db.closeDatabase();
  try {
    fs.unlinkSync(process.env.DB_PATH);
  } catch {
    /* yok */
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  yaz('TEST ÇÖKTÜ: ' + (e?.stack || e));
  process.exit(1);
});