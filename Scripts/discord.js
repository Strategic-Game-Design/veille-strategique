#!/usr/bin/env node
/*
  Publie le bulletin et ses alertes sur Discord via un webhook.
  Lancé par l'action GitHub .github/workflows/discord.yml après chaque mise à jour de data/veille.json.
  Secrets : DISCORD_WEBHOOK (salon des bulletins, forum ou texte), DISCORD_WEBHOOK_ALERTES (facultatif : salon des alertes ;
  sans lui, les alertes accompagnent le bulletin). Variable : DISCORD_ROLE_ID (facultatif : rôle mentionné pour les alertes critiques).
  Dans un salon forum, chaque bulletin crée son propre post.
  Sans DISCORD_WEBHOOK, affiche le message au lieu de l'envoyer (test).
*/
const fs = require('fs');
const SITE = 'https://strategic-game-design.github.io/veille-strategique/';
const AV = 'https://raw.githubusercontent.com/Strategic-Game-Design/veille-strategique/main/avatars/';
const RAW = 'https://raw.githubusercontent.com/Strategic-Game-Design/veille-strategique/main/';
const D = JSON.parse(fs.readFileSync('data/veille.json', 'utf8'));
let NEW = []; try { NEW = JSON.parse(fs.readFileSync('data/nouvelles_alertes.json', 'utf8')); } catch (e) {}
const H = D.historique || [], last = H[H.length - 1] || {}, prev = H.length > 1 ? H[H.length - 2] : null;
const MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(D.date_releve || '') || [];
const dateL = m.length ? `${+m[3] === 1 ? '1er' : +m[3]} ${MOIS[+m[2] - 1]} ${m[1]}` : '';
const fr = x => x == null ? '—' : Number(x).toFixed(2).replace('.', ',');
const dl = (a, b) => { if (b == null) return ''; const d = Math.round((a - b) * 100) / 100; return d < 0 ? ` ▼ ${fr(-d)}` : d > 0 ? ` ▲ ${fr(d)}` : ' ='; };
const S = D.scores, F = D.france, N = D.notes || {};
const worst = Math.min(S.stabilite.niveau, S.guerre.niveau, F.niveau);
const COL = { 1: 0xbd2f29, 2: 0xcf6420, 3: 0xad8200, 4: 0x5f8f2c, 5: 0x2e7d5b };
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const pts = (N.points_cles || []).slice(0, 5).map((p, i) => `**§${i + 1} ${p.titre}**${p.chiffre ? ` · ${p.chiffre}` : ''}\n${cut(p.texte, 180)}`).join('\n');
const bulletin = {
  title: `Bulletin n° ${H.length} · ${dateL}`,
  url: SITE,
  description: cut(`**${N.titre || ''}**\n${N.chapeau || ''}`, 600),
  color: COL[worst] || 0x1a2b4c,
  fields: [
    { name: 'Stabilité mondiale', value: `**${S.stabilite.niveau}** · ${S.stabilite.libelle}\n${fr(S.stabilite.niveau_continu)}${dl(S.stabilite.niveau_continu, prev && prev.stabilite_continu)}`, inline: true },
    { name: 'Risque de guerre', value: `**${S.guerre.niveau}** · ${S.guerre.libelle}\n${fr(S.guerre.niveau_continu)}${dl(S.guerre.niveau_continu, prev && prev.guerre_continu)}`, inline: true },
    { name: 'France', value: `**${F.niveau}** · ${F.libelle}\n${fr(F.niveau_continu)}${dl(F.niveau_continu, prev && prev.france_continu)}`, inline: true },
    ...(pts ? [{ name: 'Points clés', value: cut(pts, 1024) }] : []),
  ],
  image: { url: `${RAW}og.png?v=${(D.date_releve || '').replace(/-/g, '')}` },
  footer: { text: 'Veille stratégique mondiale · échelle de 5 (calme) à 1 (critique) · sources ouvertes' },
  timestamp: new Date(`${D.date_releve}T08:00:00+02:00`).toISOString(),
};
const alertes = NEW.slice(0, 9).map(a => ({
  title: cut(`${a.sev >= 5 ? '🔴' : a.sev >= 4 ? '🟠' : '🔵'} ${a.titre}`, 250),
  url: SITE + (a.lien || ''),
  description: cut(a.texte, 400),
  color: a.sev >= 5 ? 0xbd2f29 : a.sev >= 4 ? 0xcf6420 : 0x2c4a80,
}));
const role = process.env.DISCORD_ROLE_ID;
const critique = NEW.some(a => a.sev >= 5);
const ping = critique && role ? ` <@&${role}>` : '';
const mentions = { parse: [], roles: critique && role ? [role] : [] };
const hookB = process.env.DISCORD_WEBHOOK, hookA = process.env.DISCORD_WEBHOOK_ALERTES;
const nbA = NEW.length ? `${NEW.length} alerte${NEW.length > 1 ? 's' : ''} depuis le relevé précédent` : '';
const msgs = [];
if (hookA) {
  msgs.push({ hook: hookB, forum: true, nom: 'le bulletin', payload: { username: 'Veille stratégique', avatar_url: AV + 'veille.png', content: `📡 **Nouveau bulletin de veille** — ${N.titre || dateL}`, embeds: [bulletin], allowed_mentions: { parse: [] } } });
  if (alertes.length) msgs.push({ hook: hookA, nom: 'les alertes', payload: { username: 'Veille stratégique · alertes', avatar_url: AV + 'alertes.png', content: `🚨 **${nbA}** — bulletin du ${dateL}${ping}`, embeds: alertes, allowed_mentions: mentions } });
} else {
  msgs.push({ hook: hookB, forum: true, nom: 'le bulletin', payload: { username: 'Veille stratégique', avatar_url: AV + 'veille.png', content: `📡 **Nouveau bulletin de veille** — ${N.titre || dateL}` + (nbA ? `\n${nbA}${ping}` : ''), embeds: [bulletin, ...alertes].slice(0, 10), allowed_mentions: mentions } });
}
const titreFil = `Bulletin n° ${H.length} · ${dateL}`;
async function poster(hook, body) {
  const r = await fetch(hook + (hook.includes('?') ? '&' : '?') + 'wait=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, texte: r.ok ? '' : await r.text() };
}
(async () => {
  if (!hookB) { for (const m of msgs) console.log(`--- ${m.nom}${m.forum ? ` (post de forum « ${titreFil} »)` : ''}\n` + JSON.stringify(m.payload, null, 1)); return; }
  let erreur = false;
  for (const m of msgs) {
    let r;
    if (m.forum) { r = await poster(m.hook, { ...m.payload, thread_name: titreFil }); if (!r.ok && r.status === 400) r = await poster(m.hook, m.payload); }
    else r = await poster(m.hook, m.payload);
    if (r.ok) console.log(`Discord : ${m.nom} → envoyé`); else { erreur = true; console.error(`Discord a refusé ${m.nom} :`, r.status, r.texte); }
  }
  if (erreur) process.exit(1);
})().catch(e => { console.error('Envoi impossible :', e.message); process.exit(1); });
