#!/usr/bin/env node
/*
  Prépare la copie GitHub Pages du tableau de bord à partir de la page publiée (artifact).
  Usage : node scripts/publier.js <page.html>   (à lancer depuis la racine du dépôt)
  Produit : index.html (en-tête de partage), og.png (aperçu 1200 × 630), feed.xml (bulletins) et alertes.xml (alertes),
            data/veille.json, data/alertes.json (historique des alertes), data/nouvelles_alertes.json (alertes de ce relevé)
  Les alertes comparent le relevé avec l'ancien data/veille.json : lancer le script AVANT de remplacer ce fichier.
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
<link rel="alternate" type="application/atom+xml" title="Bulletins" href="${SITE}feed.xml">
<link rel="alternate" type="application/atom+xml" title="Alertes" href="${SITE}alertes.xml">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>
`;
// le <title> interne de la page est retiré : celui de l'en-tête prime
const body = html.replace(/<title>[^<]*<\/title>\s*/, '');

// ---------- flux et alertes ----------
let OLD=null; try { OLD = JSON.parse(fs.readFileSync('data/veille.json','utf8')); } catch(e) {}
let HIST=[]; try { HIST = JSON.parse(fs.readFileSync('data/alertes.json','utf8')); } catch(e) {}
const LIB={stabilite:'Stabilité mondiale',guerre:'Risque de guerre mondiale',france:'France',exterieur:'France · risque extérieur',interieur:'France · tension intérieure',alertes:'France · alertes officielles'};
function niveaux(X){ if(!X) return {}; const o={stabilite:[X.scores.stabilite.niveau,X.scores.stabilite.libelle,X.scores.stabilite.niveau_continu],guerre:[X.scores.guerre.niveau,X.scores.guerre.libelle,X.scores.guerre.niveau_continu],france:[X.france.niveau,X.france.libelle,X.france.niveau_continu]};
  for(const c of ['exterieur','interieur','alertes']){const k=X.france.composantes[c];o[c]=[k.niveau,k.libelle,k.niveau_continu];} return o; }
function nouvellesAlertes(N,O){
  const out=[]; if(!O || O.date_releve===N.date_releve) return out;
  const a=niveaux(N), b=niveaux(O);
  for(const k in a){ if(b[k] && a[k][0]!==b[k][0]) out.push({type:'niveau',sev:a[k][0]<b[k][0]?5:2,titre:`${LIB[k]} : niveau ${b[k][0]} → ${a[k][0]} (${a[k][1]})`,texte:`Valeur continue ${String(b[k][2]).replace('.',',')} → ${String(a[k][2]).replace('.',',')}. ${a[k][0]<b[k][0]?'Dégradation':'Amélioration'} d'un niveau entier.`,lien:['france','exterieur','interieur','alertes'].includes(k)?'#france':'#synthese'}); }
  const pg=(X,k)=>X&&X.scores.guerre.paliers?X.scores.guerre.paliers[k]:false;
  for(const k of ['echanges_de_feu_directs_ou_article5','guerre_ouverte_puissances_nucleaires']) if(pg(N,k)&&!pg(O,k)) out.push({type:'palier',sev:5,titre:`Palier franchi : ${k==='echanges_de_feu_directs_ou_article5'?'tirs directs entre puissances nucléaires ou article 5':'guerre ouverte entre puissances nucléaires'}`,texte:'Le plancher qualitatif de l\u2019indice guerre s\u2019abaisse.',lien:'#methode'});
  const ind=X=>new Map([...(X.indicateurs||[]),...((X.france||{}).indicateurs||[])].map(x=>[x.id,x]));
  const ia=ind(N), ib=ind(O);
  for(const [id,x] of ia){ const y=ib.get(id); const where=x.composante?`#france-${x.composante}`:`#monde-${x.domaine}`;
    if(!y){ if(x.severite>=4) out.push({type:'nouveau',sev:x.severite,titre:`Nouveau foyer suivi : ${x.libelle} (${x.severite}/5)`,texte:x.valeur,lien:where}); continue; }
    if(x.severite>=5&&y.severite<5) out.push({type:'critique',sev:5,titre:`${x.libelle} passe à 5/5`,texte:x.valeur,lien:where});
    else if(x.severite<5&&y.severite>=5) out.push({type:'detente',sev:x.severite,titre:`${x.libelle} redescend à ${x.severite}/5`,texte:x.valeur,lien:where}); }
  const ech=X=>new Map(((X.france||{}).echelles||[]).map(e=>[e.nom,String(e.niveau_actuel||'').split(/[;(]/)[0].trim().toLowerCase()]));
  const ea=ech(N), eb=ech(O);
  for(const [nom,v] of ea){ if(!/^(Vigipirate|État d'urgence|Notations)/.test(nom)) continue; const w=eb.get(nom); if(w!==undefined && w!==v) out.push({type:'posture',sev:4,titre:`Posture officielle modifiée : ${nom.split(' (')[0]}`,texte:((N.france.echelles.find(e=>e.nom===nom)||{}).niveau_actuel||'').slice(0,300),lien:'#france-postures'}); }
  return out.map((x,i)=>Object.assign(x,{date:N.date_releve,id:`${N.date_releve}-${i+1}`}));
}
const NEW=nouvellesAlertes(D,OLD);
HIST=[...NEW,...HIST.filter(h=>h.date!==D.date_releve||!NEW.length)].slice(0,60);
const xe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const iso=dt=>`${dt}T08:00:00+02:00`;
const MO=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const fr=dt=>{const [y,m,j]=String(dt).split('-').map(Number);return j?`${j===1?'1er':j} ${MO[m-1]} ${y}`:dt;};
const nf=x=>typeof x==='number'?x.toFixed(2).replace('.',','):String(x??'');
function atom(titre,self,entries){ const up=entries.length?entries[0].updated:iso(D.date_releve);
  return `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="fr">\n<title>${xe(titre)}</title>\n<id>${SITE}${self}</id>\n<link rel="self" href="${SITE}${self}"/>\n<link rel="alternate" href="${SITE}"/>\n<updated>${up}</updated>\n<author><name>Veille stratégique mondiale</name></author>\n${entries.map(e=>`<entry>\n<title>${xe(e.title)}</title>\n<id>${xe(e.id)}</id>\n<link href="${xe(e.link)}"/>\n<updated>${e.updated}</updated>\n<summary type="html">${xe(e.html)}</summary>\n</entry>`).join('\n')}\n</feed>\n`; }
const H=(D.historique||[]).slice(-20).reverse();
const bull=H.map((h,k)=>{ const num=(D.historique||[]).length-k; const cur=k===0;
  const html=(cur&&D.notes&&D.notes.chapeau?`<p>${D.notes.chapeau}</p>`:'')+`<p>Stabilité ${h.stabilite_niveau} (${nf(h.stabilite_continu)}) · Guerre ${h.guerre_niveau} (${nf(h.guerre_continu)}) · France ${h.france_niveau} (${nf(h.france_continu)})</p>`+(h.faits_marquants?`<p>${h.faits_marquants}</p>`:'')+(cur?`<p><img src="${SITE}og.png?v=${v}" alt=""/></p>`:'');
  return {title:`Bulletin n° ${num} · ${fr(h.date)}${cur&&D.notes&&D.notes.titre?' — '+D.notes.titre:''}`,id:`${SITE}#bulletin-${h.date}`,link:cur?SITE:`${SITE}#archive-${h.date}`,updated:iso(h.date),html}; });
fs.writeFileSync('feed.xml', atom('Veille stratégique mondiale — bulletins','feed.xml',bull));
fs.writeFileSync('alertes.xml', atom('Veille stratégique mondiale — alertes','alertes.xml',HIST.map(a=>({title:`${a.sev>=5?'🔴':a.sev>=4?'🟠':'🔵'} ${a.titre}`,id:`${SITE}#alerte-${a.id}`,link:SITE+(a.lien||''),updated:iso(a.date),html:`<p>${xe(a.texte||'')}</p><p>Bulletin du ${fr(a.date)}</p>`}))));

fs.writeFileSync('index.html', head + body + '\n</body></html>\n');
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/veille.json', JSON.stringify(D, null, 1));
fs.writeFileSync('data/alertes.json', JSON.stringify(HIST, null, 1));
fs.writeFileSync('data/nouvelles_alertes.json', JSON.stringify(NEW, null, 1));
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
  console.log(`Fichiers à commiter : index.html og.png feed.xml alertes.xml data/veille.json data/alertes.json data/nouvelles_alertes.json .nojekyll — ${title} — ${NEW.length} alerte(s) nouvelle(s)`);
})().catch(e => { console.error('Aperçu non généré :', e.message); process.exit(3); });
