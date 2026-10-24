#!/usr/bin/env node
/*
  Prépare la copie GitHub Pages du tableau de bord à partir de la page publiée (artifact).
  Usage : node scripts/publier.js <page.html>   (à lancer depuis la racine du dépôt)
  Produit : index.html (avec en-tête de partage Open Graph), og.png (aperçu 1200 × 630), data/veille.json
*/
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const SITE = 'https://strategic-game-design.github.io/veille-strategique/';
const src = process.argv[2];
if (!src) { console.error('Usage : node scripts/publier.js <page.html>'); process.exit(1); }
let html = fs.readFileSync(src, 'utf8');
// 1. contenu de la page (sans le squelette éventuel de l'artifact)
const b0 = html.search(/<body[^>]*>/i);
if (b0 >= 0) { html = html.slice(html.indexOf('>', b0) + 1); const b1 = html.lastIndexOf('</body>'); if (b1 >= 0) html = html.slice(0, b1); }
// 2. données
const i = html.indexOf('const D = '), j = html.indexOf('const REPORT');
if (i < 0 || j < 0) { console.error('Constante D introuvable'); process.exit(2); }
const D = JSON.parse(html.slice(i + 10, j).trim().replace(/;$/, ''));
const MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(D.date_releve || '') || [];
const dateL = d.length ? `${+d[3] === 1 ? '1er' : +d[3]} ${MOIS[+d[2] - 1]} ${d[1]}` : '';
const n = (D.historique || []).length, S = D.scores, F = D.france;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const title = `Veille stratégique mondiale · bulletin n° ${n} du ${dateL}`;
const desc = `${(D.notes && D.notes.titre) || 'Situation stratégique'}. Stabilité mondiale ${S.stabilite.niveau} (${S.stabilite.libelle}), risque de guerre ${S.guerre.niveau} (${S.guerre.libelle}), France ${F.niveau} (${F.libelle}). Échelle de 5 (calme) à 1 (critique).`;
const v = (D.date_releve || '').replace(/-/g, '');
const favicon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0e1a30"/><rect x="8" y="8" width="48" height="48" fill="none" stroke="#e3e9f3" stroke-width="4"/><text x="32" y="40" text-anchor="middle" font-family="Arial,sans-serif" font-weight="900" font-size="18" fill="#e3e9f3">VSM</text></svg>');
const head = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0e1a30">
<link rel="icon" href="${favicon}">
<meta property="og:type" content="website">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="Veille stratégique mondiale">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${SITE}">
<meta property="og:image" content="${SITE}og.png?v=${v}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Carte des tensions et niveaux du bulletin du ${esc(dateL)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${SITE}og.png?v=${v}">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>
`;
// le <title> interne de la page est retiré : celui de l'en-tête prime
const body = html.replace(/<title>[^<]*<\/title>\s*/, '');
fs.writeFileSync('index.html', head + body + '\n</body></html>\n');
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/veille.json', JSON.stringify(D, null, 1));
fs.writeFileSync('.nojekyll', '');
// 3. aperçu og.png
let pw; try { pw = require('playwright'); } catch (e) { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
(async () => {
  const opts = fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
  const b = await pw.chromium.launch(opts);
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await p.goto('file://' + path.resolve('index.html') + '#apercu');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: 'og.png' });
  await b.close();
  console.log('index.html, og.png et data/veille.json écrits —', title);
})().catch(e => { console.error('Aperçu non généré :', e.message); process.exit(3); });
