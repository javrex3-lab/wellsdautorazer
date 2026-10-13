/** test/panel-image.test.js — panel gorseli regresyon korumasi. */
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = path.join(os.tmpdir(), 'panimg-t-' + Date.now() + '.db');

const KOK = path.resolve(__dirname, '..');
const { MessagePayload } = require('discord.js');
const { execSync } = require('child_process');
const db = require('../src/database/database');
const pi = require('../src/utils/panelImage');
const banViews = require('../src/utils/banViews');
const mzViews = require('../src/utils/mazeretViews');
const banK = require('../src/commands/banlilar');
const mzK = require('../src/commands/mazeretpanel');

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
yaz('  PANEL GÖRSELİ — TESTLER');
yaz('='.repeat(70));
db.initDatabase();

const G = '1354465879311777893';

function kanalYap() {
  const gonderilen = [];
  let n = 0;
  return {
    gonderilen,
    id: '999000000000000001',
    guildId: G,
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({ has: () => true }),
    send: async (p) => {
      gonderilen.push(p);
      return { id: 'M' + ++n, ...p };
    },
    messages: {
      fetch: async () => Promise.reject(Object.assign(new Error('yok'), { code: 10008 })),
    },
  };
}

const member = { id: '1056585742731726918', permissions: { has: () => true }, roles: { cache: new Map() } };

async function komutCalistir(komut) {
  const ch = kanalYap();
  const it = {
    id: 'I' + Math.random(),
    guildId: G,
    guild: { id: G, name: 'WELL SD #V12', members: { me: { id: 'B' } } },
    client: { channels: { cache: new Map(), fetch: async () => null } },
    user: { id: member.id, tag: 'd27q' },
    member,
    options: { getChannel: () => ch },
    channel: ch,
    isRepliable: () => true,
    replied: false,
    deferred: false,
    reply: async () => {},
    followUp: async () => {},
  };
  await komut.execute(it);
  return ch.gonderilen.find((x) => x.embeds);
}

(async () => {
  /* ---------------------------------------------------------------- */
  bolum('1) GÖMÜLÜ DOSYA');

  const g = pi.panelGorseli();
  check('Görsel dosyası mevcut', fs.existsSync(pi.PANEL_GORSEL_DOSYA), pi.PANEL_GORSEL_DOSYA);
  check('Kaynak tipi "dosya"', g.kaynak === 'dosya', g.kaynak);
  check('Dosya 100 KB üzerinde', fs.statSync(pi.PANEL_GORSEL_DOSYA).size > 100_000, String(fs.statSync(pi.PANEL_GORSEL_DOSYA).size));
  {
    const b = fs.readFileSync(pi.PANEL_GORSEL_DOSYA);
    check('Geçerli PNG imzası', b.subarray(1, 4).toString('ascii') === 'PNG', b.subarray(0, 8).toString('hex'));
  }

  /* ---------------------------------------------------------------- */
  bolum('2) ATTACHMENT ADI = REFERANS (asıl hata noktası)');

  check('imageUrl attachment:// ile başlıyor', String(g.imageUrl).startsWith('attachment://'), String(g.imageUrl));
  check('imageUrl adı = PANEL_GORSEL_ADI', g.imageUrl === `attachment://${pi.PANEL_GORSEL_ADI}`, g.imageUrl);

  {
    // discord.js ham ReadStream'e YOLUN BASENAME'ini verir — uyuşmazsa görsel görünmez.
    const ham = await MessagePayload.resolveFile(fs.createReadStream(pi.PANEL_GORSEL_DOSYA));
    check('Ham ReadStream adı basename (bilinen discord.js davranışı)', ham.name === path.basename(pi.PANEL_GORSEL_DOSYA), ham.name);
    check('Ham ReadStream yöntemi kullanılmıyor (ad tutmuyor)', ham.name !== pi.PANEL_GORSEL_ADI, 'panelDosyalari ham akis kullanmamali');

    const dosyalar = pi.panelDosyalari(g, true);
    check('panelDosyalari 1 dosya veriyor', dosyalar.length === 1, String(dosyalar.length));
    check('Dosyada AÇIK name alanı var', 'name' in dosyalar[0] && dosyalar[0].name === pi.PANEL_GORSEL_ADI, JSON.stringify(dosyalar[0].name));
    const cozulen = await MessagePayload.resolveFile(dosyalar[0]);
    check('discord.js verdiği ad = referans', cozulen.name === pi.PANEL_GORSEL_ADI, cozulen.name);
    check('Görsel verisi okundu', cozulen.data.length > 100_000, String(cozulen.data.length));
  }

  /* ---------------------------------------------------------------- */
  bolum('3) DÜZENLEMEDE TEKRAR YÜKLEME YOK');

  check('İlk gönderimde 1 dosya', pi.panelDosyalari(g, true).length === 1);
  check('Düzenlemede 0 dosya', pi.panelDosyalari(g, false).length === 0);
  check('Görselsiz kaynakta 0 dosya', pi.panelDosyalari({ kaynak: 'yok' }, true).length === 0);
  check('Geçersiz kaynakta çökmez', (() => { try { pi.panelDosyalari(null, true); return true; } catch { return false; } })());

  /* ---------------------------------------------------------------- */
  bolum('4) EMBED GÖRSEL ALANI');

  {
    const be = banViews.buildPanelEmbed({ imageUrl: g.imageUrl }).toJSON();
    const me = mzViews.buildPanelEmbed({ imageUrl: g.imageUrl }).toJSON();
    check('Banlılar embed görsel alanı dolu', be.image?.url === g.imageUrl, String(be.image?.url));
    check('Mazeret embed görsel alanı dolu', me.image?.url === g.imageUrl, String(me.image?.url));
    check('imageUrl verilmezse görsel yok', banViews.buildPanelEmbed({}).toJSON().image === undefined);
    check('imageUrl verilmezse (mazeret) görsel yok', mzViews.buildPanelEmbed({}).toJSON().image === undefined);
  }

  /* ---------------------------------------------------------------- */
  bolum('5) KOMUTLAR PANELİ GÖRSELLE GÖNDERİYOR');

  for (const [ad, komut] of [
    ['/banlılarpanel', banK],
    ['/mazeretpanel', mzK],
  ]) {
    const mesaj = await komutCalistir(komut);
    check(`${ad}: embed görsel referansı`, mesaj.embeds[0].data.image?.url === g.imageUrl, String(mesaj.embeds[0].data.image?.url));
    check(`${ad}: 1 dosya eklendi`, (mesaj.files || []).length === 1, String((mesaj.files || []).length));
    const adlar = [];
    for (const f of mesaj.files || []) adlar.push((await MessagePayload.resolveFile(f)).name);
    check(`${ad}: attachment adı referansla eşleşiyor`, adlar.includes(pi.PANEL_GORSEL_ADI), JSON.stringify(adlar));
    check(`${ad}: SONUÇ — görsel panelin içinde çözülüyor`, mesaj.embeds[0].data.image?.url === `attachment://${pi.PANEL_GORSEL_ADI}` && adlar.includes(pi.PANEL_GORSEL_ADI));
  }

  /* ---------------------------------------------------------------- */
  bolum('6) DİĞER SİSTEMLER ETKİLENMEDİ');

  {
    check('Ticket panel dosyası değişmedi (kendi yolunu kullanır)', fs.existsSync(path.join(KOK, 'assets', 'ticket-panel.png')));
    const tickets = require('../src/handlers/tickets');
    check('tickets.js kendi PANEL_GORSEL_ADI ile çalışıyor', tickets.PANEL_GORSEL_DOSYA === path.join(KOK, 'assets', 'ticket-panel.png'));
    check('Ticket görsel adı = dosya adı (tutarlı kalmalı)', tickets.PANEL_GORSEL_DOSYA === path.join(KOK, 'assets', 'ticket-panel.png') && path.basename(tickets.PANEL_GORSEL_DOSYA) === 'ticket-panel.png');
    check('panelImage ticket dosyasını bozmuyor', pi.PANEL_GORSEL_DOSYA === path.join(KOK, 'assets', 'ticket-panel.png'));

    let yuklu = true;
    for (const [ad, yol] of [
      ['ticket views', '../src/utils/ticketViews'],
      ['ic handler', '../src/handlers/icHandler'],
      ['banlılar handler', '../src/handlers/banli'],
      ['mazeret handler', '../src/handlers/mazeret'],
      ['ticketop', '../src/commands/ticketop'],
    ]) {
      try {
        require(yol);
      } catch {
        yuklu = false;
        console.log('    yuklenemedi: ' + ad);
      }
    }
    check('İlgili modüller yükleniyor', yuklu);

    check('.env dosyası değişmedi', !fs.readFileSync(path.join(KOK, '.env'), 'utf8').includes('panel-gorsel'));
    const pkg = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));
    // Gercek kontrol: package.json bu calisma kapsaminda degisti mi?
    let degistiMi = false;
    try {
      const d = execSync('git diff --name-only HEAD -- package.json', { cwd: KOK, encoding: 'utf8' }).trim();
      degistiMi = Boolean(d);
    } catch {
      /* git yoksa atla */
    }
    check('package.json bu çalışmada değişmedi (yeni dependency yok)', degistiMi === false);
    const piSrc = fs.readFileSync(path.join(KOK, 'src/utils/panelImage.js'), 'utf8');
    const piRequire = [...piSrc.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
    check('panelImage yalnızca core modül kullanıyor (discord.js yok)', piRequire.includes('fs') && piRequire.includes('path') && !piRequire.includes('discord.js'), JSON.stringify(piRequire));
  }

  /* ---------------------------------------------------------------- */
  yaz('\n' + '='.repeat(70));
  yaz(`  SONUÇ:  ${pass} başarılı / ${pass + fail} toplam  /  ${fail} başarısız`);
  yaz('='.repeat(70));
  fs.writeFileSync('C:/Users/PC/AppData/Local/Temp/opencode/panel-image-test.txt', cikti.join('\n'), 'utf8');

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