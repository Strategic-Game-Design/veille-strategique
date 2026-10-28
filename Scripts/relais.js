#!/usr/bin/env node
/*
  Relais RSS → Discord (remplace MonitoRSS, sans limite de flux).
  Lancé toutes les 30 min par .github/workflows/relais.yml.
  Configuration : relais.json à la racine du dépôt — une entrée par flux :
    { "nom": "Diploweb", "url": "https://…", "webhook": "WEBHOOK_INFOG", "couleur": "#1f4e79" }
  "webhook" est le NOM d'un secret GitHub (jamais l'URL elle-même : le dépôt est public).
  Mémoire : data/relais_etat.json (articles déjà envoyés). Au premier passage d'un flux,
  seuls les "premier_envoi" articles les plus récents sont postés (2 par défaut), le reste est marqué comme lu.
  Sans le secret correspondant, le relais affiche ce qu'il enverrait (mode test).
*/
const fs = require('fs');
const CONF = JSON.parse(fs.readFileSync('relais.json', 'utf8'));
const ETAT_F = 'data/relais_etat.json';
let ETAT = {}; try { ETAT = JSON.parse(fs.readFileSync(ETAT_F, 'utf8')); } catch (e) {}
const MAX_PAR_PASSAGE = 8, MEMOIRE = 300;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', laquo: '«', raquo: '»', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ndash: '–', mdash: '—' };
const dec = s => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));
const cdata = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const txt = s => { let x = cdata(s); if (/&lt;\/?[a-z]/i.test(x)) x = dec(x); return dec(x.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); };
const tag = (x, t) => { const m = new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i').exec(x); return m ? m[1] : ''; };
const attr = (x, t, a) => { const m = new RegExp(`<${t}\\b[^>]*\\b${a}="([^"]*)"`, 'i').exec(x); return m ? dec(m[1]) : ''; };
const cut = (s, n) => s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;

function lire(xml) {
  const atom = /<feed[\s>]/i.test(xml);
  const blocs = xml.match(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  return blocs.map(b => {
    const lien = atom ? (attr(b.replace(/<link[^>]*rel="(?!alternate)[^"]*"[^>]*>/gi, ''), 'link', 'href') || attr(b, 'link', 'href')) : txt(tag(b, 'link'));
    const id = txt(tag(b, atom ? 'id' : 'guid')) || lien;
    const brut = cdata(tag(b, 'content:encoded') || tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'));
    const img = attr(b, 'media:content', 'url') || attr(b, 'media:thumbnail', 'url') || (/<enclosure\b[^>]*type="image/i.test(b) ? attr(b, 'enclosure', 'url') : '') || ((/<img[^>]+src="([^"]+)"/i.exec(dec(brut)) || [])[1] || '');
    const date = txt(tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'published') || tag(b, 'updated'));
    const auteur = txt(tag(b, 'dc:creator') || tag(tag(b, 'author'), 'name') || '');
    return { id, titre: txt(tag(b, 'title')), lien, resume: txt(brut), img, date, auteur };
  }).filter(a => a.id && a.titre);
}

// image de l'article : celle du flux, sinon l'image de partage (og:image / twitter:image) de la page
async function imageDePage(url) {
  if (!/^https?:/.test(url || '')) return '';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)', Accept: 'text/html' }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return '';
    const html = (await r.text()).slice(0, 300000);
    const m = /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)["']/i.exec(html) || /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i.exec(html);
    return m ? new URL(dec(m[1]), url).href : '';
  } catch (e) { return ''; }
}
const pause = ms => new Promise(r => setTimeout(r, ms));
async function poster(hook, body) {
  for (let essai = 0; essai < 4; essai++) {
    const r = await fetch(hook + (hook.includes('?') ? '&' : '?') + 'wait=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 429) { const j = await r.json().catch(() => ({})); await pause(((j.retry_after || 2) * 1000) + 250); continue; }
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return;
  }
  throw new Error('limite de débit Discord');
}

(async () => {
  let change = false, envoyes = 0, erreurs = 0;
  for (const f of CONF.flux || []) {
    if (f.actif === false) continue;
    let items;
    try {
      const r = await fetch(f.url, { headers: { 'User-Agent': 'Mozilla/5.0 (relais veille-strategique; +https://strategic-game-design.github.io/veille-strategique/)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      items = lire(await r.text());
    } catch (e) { console.error(`✗ ${f.nom} : lecture impossible (${e.message})`); erreurs++; continue; }
    if (!items.length) { console.error(`✗ ${f.nom} : aucun article reconnu`); erreurs++; continue; }
    const vus = ETAT[f.url] || null, premier = !vus;
    const lus = new Set(vus || []);
    let nouveaux = items.filter(a => !lus.has(a.id));
    if (premier) nouveaux = nouveaux.slice(0, f.premier_envoi ?? 2);
    nouveaux = nouveaux.slice(0, MAX_PAR_PASSAGE).reverse(); // du plus ancien au plus récent
    const hook = process.env[f.webhook];
    const couleur = parseInt(String(f.couleur || '#1a2b4c').replace('#', ''), 16);
    const envoyesIci = new Set();
    for (const a of nouveaux) {
      const d = Date.parse(a.date);
      if (!a.img && f.images !== false && hook) a.img = await imageDePage(a.lien);
      const body = {
        username: f.nom, avatar_url: f.avatar || undefined, allowed_mentions: { parse: [] },
        embeds: [{
          title: cut(a.titre, 250), url: a.lien || undefined, color: couleur,
          description: a.resume ? cut(a.resume, 350) : undefined,
          author: { name: f.nom + (a.auteur ? ` · ${a.auteur}` : '') },
          ...(a.img && f.images !== false ? { image: { url: a.img } } : {}),
          ...(isNaN(d) ? {} : { timestamp: new Date(d).toISOString() }),
          footer: { text: f.etiquette || 'Relais de veille' },
        }],
      };
      if (!hook) { console.log(`[test] ${f.nom} → ${f.webhook} : ${a.titre}`); envoyesIci.add(a.id); continue; }
      try { await poster(hook, body); envoyesIci.add(a.id); envoyes++; await pause(1200); }
      catch (e) { console.error(`✗ ${f.nom} : envoi refusé (${e.message})`); erreurs++; break; }
    }
    // marquer comme lus : tout le flux au premier passage, sinon les articles envoyés (et les non-envoyés au-delà du plafond)
    const aMarquer = premier ? items.map(a => a.id) : items.filter(a => !lus.has(a.id) && (envoyesIci.has(a.id) || !nouveaux.some(n => n.id === a.id))).map(a => a.id);
    if (!hook && !premier) aMarquer.length = 0; // en test, ne rien consommer après l'initialisation
    if (aMarquer.length || premier) {
      ETAT[f.url] = [...aMarquer, ...(vus || [])].filter((v, i, t) => t.indexOf(v) === i).slice(0, MEMOIRE);
      change = true;
    }
    console.log(`✓ ${f.nom} : ${items.length} articles lus, ${envoyesIci.size} relayé(s)${premier ? ' (premier passage)' : ''}`);
  }
  if (change) fs.writeFileSync(ETAT_F, JSON.stringify(ETAT, null, 1));
  console.log(`Relais terminé : ${envoyes} message(s) envoyé(s)${erreurs ? `, ${erreurs} erreur(s)` : ''}.`);
})().catch(e => { console.error(e); process.exit(1); });
