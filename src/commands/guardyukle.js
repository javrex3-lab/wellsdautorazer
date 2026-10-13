/**
 * /guardyukle - Guard whitelist'i kalıcı kaynaktan (data/guard-whitelist-seed.json)
 * geri yükler.
 *
 * Neden var: Railway gibi geçici dosya sistemli ortamlarda veritabanı her
 * redeploy'da sıfırlanır. Kaynak dosya repoda durur; bu komut veritabanını
 * tek komutla eski haline getirir.
 *
 * GÜVENLİK:
 *  - SİLME YAPMAZ. Sadece eksik olanı ekler, seviyesi değişeni günceller.
 *  - Idempotenttir: tekrar çalıştırmak duplicate oluşturmaz.
 *  - Kaynak dosya bozuksa hiçbir şeye dokunmadan hata verir.
 */
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { buildErrorEmbed } = require('../utils/embeds');
const { setGuardLevel, getGuardLevel } = require('../database/database');
const { canManageGuard } = require('../guard/permissions');
const { LEVEL_META } = require('../guard/constants');
const { sendGuardLog } = require('../guard/logService');
const logger = require('../utils/logger');

const TOHUM_DOSYA = path.join(__dirname, '..', '..', 'data', 'guard-whitelist-seed.json');

/**
 * Tohum dosyasını okur ve doğrular.
 * @returns {{ok:true, kayitlar:Array}|{ok:false, hata:string}}
 */
function tohumOku(dosya = TOHUM_DOSYA) {
  let ham;
  try {
    ham = fs.readFileSync(dosya, 'utf8');
  } catch (err) {
    return { ok: false, hata: `Tohum dosyası okunamadı: ${err.message}` };
  }

  let veri;
  try {
    veri = JSON.parse(ham);
  } catch (err) {
    return { ok: false, hata: `Tohum dosyası bozuk JSON: ${err.message}` };
  }

  const liste = Array.isArray(veri?.kayitlar) ? veri.kayitlar : null;
  if (!liste) return { ok: false, hata: 'Tohum dosyasında "kayitlar" dizisi yok.' };

  const temiz = [];
  const hatali = [];
  for (const k of liste) {
    const id = String(k?.user_id ?? '').trim();
    const lvl = Number(k?.level);
    if (!/^\d{17,20}$/.test(id)) {
      hatali.push(`${k?.user_id ?? '(boş)'} → geçersiz kullanıcı ID`);
      continue;
    }
    if (!Number.isInteger(lvl) || lvl < 1 || lvl > 4) {
      hatali.push(`${id} → geçersiz seviye ${k?.level}`);
      continue;
    }
    temiz.push({ id, level: lvl });
  }

  if (!temiz.length) return { ok: false, hata: `Tohum dosyasında geçerli kayıt yok. ${hatali.join('; ')}` };
  return { ok: true, kayitlar: temiz, atlanan: hatali };
}

module.exports = {
  openToGuardManagers: true,
  data: new SlashCommandBuilder()
    .setName('guardyukle')
    .setDescription('Guard whitelist\'i kalıcı kaynaktan geri yükler (redeploy sonrası).'),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction
        .reply({ embeds: [buildErrorEmbed('Bu komut yalnızca sunucuda kullanılabilir.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
    if (!canManageGuard(interaction.member)) {
      return interaction
        .reply({ embeds: [buildErrorEmbed('Bu komutu yalnızca Guard yöneticileri kullanabilir.')], flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const t = tohumOku();
    if (!t.ok) {
      logger.error(`/guardyukle: ${t.hata}`);
      return interaction
        .editReply({ embeds: [buildErrorEmbed(`Geri yükleme yapılamadı — hiçbir kayıt değiştirilmedi.\n${t.hata}`)] })
        .catch(() => {});
    }

    let eklendi = 0;
    let guncellendi = 0;
    let ayni = 0;
    const hatalar = [];

    for (const k of t.kayitlar) {
      const mevcut = getGuardLevel(interaction.guildId, k.id);
      try {
        const { created } = setGuardLevel(interaction.guildId, k.id, k.level, interaction.user.id);
        if (created) eklendi++;
        else if (mevcut === k.level) ayni++;
        else guncellendi++;
      } catch (err) {
        logger.error(`[guardyukle] ${k.id} yazılamadı:`, err);
        hatalar.push(`<@${k.id}>: ${err.code || err.message}`);
      }
    }

    // Gerçek durumu veritabanından TEKRAR oku (başarı mesajı yalnızca doğrulandıysa)
    const dogrulama = t.kayitlar.filter((k) => getGuardLevel(interaction.guildId, k.id) === k.level);
    const eksikler = t.kayitlar.filter((k) => !dogrulama.includes(k));

    logger.success(
      `/guardyukle: ${eklendi} eklendi, ${guncellendi} güncellendi, ${ayni} zaten vardı ` +
        `(${dogrulama.length}/${t.kayitlar.length} doğrulandı)`,
    );

    await sendGuardLog({
      guild: interaction.guild,
      title: 'Whitelist Geri Yüklendi',
      action: '`/guardyukle`',
      detail: `${eklendi} eklendi · ${guncellendi} güncellendi · ${ayni} zaten vardı`,
      actor: { id: interaction.user.id },
      status: hatalar.length ? { ok: false, text: 'Kısmi hata' } : { ok: true, text: 'Tamamlandı' },
    }).catch(() => {});

    const baslik = hatalar.length ? '⚠️ WHITELIST KISMİ YÜKLENDİ' : '✅ WHITELIST GERİ YÜKLENDİ';
    const renk = hatalar.length ? 0xe67e22 : 0x2ecc71;

    const embed = new EmbedBuilder()
      .setColor(renk)
      .setTitle(baslik)
      .addFields(
        { name: 'Eklendi', value: `${eklendi} kullanıcı`, inline: true },
        { name: 'Güncellendi', value: `${guncellendi} kullanıcı`, inline: true },
        { name: 'Zaten vardı', value: `${ayni} kullanıcı`, inline: true },
        { name: 'Doğrulama', value: `${dogrulama.length} / ${t.kayitlar.length} kayıt doğrulandı`, inline: false },
      )
      .setFooter({ text: 'Hiçbir kayıt SİLİNMEDİ · komut tekrar çalıştırılabilir' })
      .setTimestamp();

    if (eksikler.length) {
      embed.addFields({
        name: '❌ Doğrulanamayan',
        value: eksikler.slice(0, 10).map((k) => `<@${k.id}>`).join(', '),
      });
    }
    if (t.atlanan?.length) {
      embed.addFields({ name: '⚠️ Atlanan (geçersiz satır)', value: t.atlanan.slice(0, 5).join('\n') });
    }
    if (hatalar.length) {
      embed.addFields({ name: 'Hatalar', value: hatalar.slice(0, 5).join('\n') });
    }

    return interaction.editReply({ embeds: [embed] }).catch(() => {});
  },

  _tohumOku: tohumOku,
  _TOHUM_DOSYA: TOHUM_DOSYA,
};