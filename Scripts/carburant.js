#!/usr/bin/env node
/*
  Collecteur carburant — prix et ruptures des stations-service (métropole + Corse).
  Source : flux instantané officiel prix-carburants.gouv.fr (donnees.roulez-eco.fr/opendata/instantane_ruptures),
  fichier XML décompressé passé en argument :  node Scripts/carburant.js <PrixCarburants_instantane_ruptures.xml>
  Lancé toutes les 3 h par .github/workflows/carburant.yml.
  Écrit data/carburant.json : situation instantanée (national, régions, départements), série quotidienne (400 j),
  indice de tension carburant, journal des alertes. Envoie les alertes sur Discord (secret DISCORD_WEBHOOK_ALERTES).
  L'appréciation « amont » (Brent, Ormuz, raffineries) et la projection viennent du relevé hebdomadaire
  (data/veille.json → carburant.amont), le reste est mesuré.
*/
const fs = require('fs');
const OUT = 'data/carburant.json';
const SITE = 'https://strategic-game-design.github.io/veille-strategique/';
const src = process.argv[2];
if (!src) { console.error('usage : node Scripts/carburant.js <fichier XML>'); process.exit(1); }

const CARB = { '1': 'Gazole', '2': 'SP95', '5': 'E10', '6': 'SP98', '3': 'E85', '4': 'GPLc' };
const NOMS = { Gazole: 'Gazole', SP95: 'SP95', E10: 'SP95-E10', SP98: 'SP98', E85: 'E85', GPLc: 'GPLc' };
const LISTE = ['Gazole', 'E10', 'SP98', 'SP95', 'E85', 'GPLc'];
const NOMDEP = {"01":"Ain","02":"Aisne","03":"Allier","04":"Alpes-de-Haute-Provence","05":"Hautes-Alpes","06":"Alpes-Maritimes","07":"Ardèche","08":"Ardennes","09":"Ariège","10":"Aube","11":"Aude","12":"Aveyron","13":"Bouches-du-Rhône","14":"Calvados","15":"Cantal","16":"Charente","17":"Charente-Maritime","18":"Cher","19":"Corrèze","2A":"Corse-du-Sud","2B":"Haute-Corse","21":"Côte-d'Or","22":"Côtes-d'Armor","23":"Creuse","24":"Dordogne","25":"Doubs","26":"Drôme","27":"Eure","28":"Eure-et-Loir","29":"Finistère","30":"Gard","31":"Haute-Garonne","32":"Gers","33":"Gironde","34":"Hérault","35":"Ille-et-Vilaine","36":"Indre","37":"Indre-et-Loire","38":"Isère","39":"Jura","40":"Landes","41":"Loir-et-Cher","42":"Loire","43":"Haute-Loire","44":"Loire-Atlantique","45":"Loiret","46":"Lot","47":"Lot-et-Garonne","48":"Lozère","49":"Maine-et-Loire","50":"Manche","51":"Marne","52":"Haute-Marne","53":"Mayenne","54":"Meurthe-et-Moselle","55":"Meuse","56":"Morbihan","57":"Moselle","58":"Nièvre","59":"Nord","60":"Oise","61":"Orne","62":"Pas-de-Calais","63":"Puy-de-Dôme","64":"Pyrénées-Atlantiques","65":"Hautes-Pyrénées","66":"Pyrénées-Orientales","67":"Bas-Rhin","68":"Haut-Rhin","69":"Rhône","70":"Haute-Saône","71":"Saône-et-Loire","72":"Sarthe","73":"Savoie","74":"Haute-Savoie","75":"Paris","76":"Seine-Maritime","77":"Seine-et-Marne","78":"Yvelines","79":"Deux-Sèvres","80":"Somme","81":"Tarn","82":"Tarn-et-Garonne","83":"Var","84":"Vaucluse","85":"Vendée","86":"Vienne","87":"Haute-Vienne","88":"Vosges","89":"Yonne","90":"Territoire de Belfort","91":"Essonne","92":"Hauts-de-Seine","93":"Seine-Saint-Denis","94":"Val-de-Marne","95":"Val-d'Oise"};
const REG = {"01":"ARA","02":"HDF","03":"ARA","04":"PAC","05":"PAC","06":"PAC","07":"ARA","08":"GES","09":"OCC","10":"GES","11":"OCC","12":"OCC","13":"PAC","14":"NOR","15":"ARA","16":"NAQ","17":"NAQ","18":"CVL","19":"NAQ","2A":"COR","2B":"COR","21":"BFC","22":"BRE","23":"NAQ","24":"NAQ","25":"BFC","26":"ARA","27":"NOR","28":"CVL","29":"BRE","30":"OCC","31":"OCC","32":"OCC","33":"NAQ","34":"OCC","35":"BRE","36":"CVL","37":"CVL","38":"ARA","39":"BFC","40":"NAQ","41":"CVL","42":"ARA","43":"ARA","44":"PDL","45":"CVL","46":"OCC","47":"NAQ","48":"OCC","49":"PDL","50":"NOR","51":"GES","52":"GES","53":"PDL","54":"GES","55":"GES","56":"BRE","57":"GES","58":"BFC","59":"HDF","60":"HDF","61":"NOR","62":"HDF","63":"ARA","64":"NAQ","65":"OCC","66":"OCC","67":"GES","68":"GES","69":"ARA","70":"BFC","71":"BFC","72":"PDL","73":"ARA","74":"ARA","75":"IDF","76":"NOR","77":"IDF","78":"IDF","79":"NAQ","80":"HDF","81":"OCC","82":"OCC","83":"PAC","84":"PAC","85":"PDL","86":"NAQ","87":"NAQ","88":"GES","89":"BFC","90":"BFC","91":"IDF","92":"IDF","93":"IDF","94":"IDF","95":"IDF"};

// ---------- lecture du flux ----------
const xml = new TextDecoder('latin1').decode(fs.readFileSync(src));
const now = new Date();
const attrs = s => { const o = {}; s.replace(/([\w:-]+)="([^"]*)"/g, (m, k, v) => { o[k] = v; }); return o; };
const pdvs = xml.match(/<pdv\b[\s\S]*?<\/pdv>/g) || [];
if (pdvs.length < 1000) { console.error(`Flux suspect : ${pdvs.length} stations seulement — arrêt sans écrire.`); process.exit(1); }
const depDe = cp => { cp = String(cp || '').padStart(5, '0'); if (cp.startsWith('20')) return +cp < 20200 ? '2A' : '2B'; const d = cp.slice(0, 2); return REG[d] ? d : null; };
const parseD = s => { if (!s) return null; const t = Date.parse(s.replace(' ', 'T') + (/[zZ+]/.test(s.slice(10)) ? '' : '+01:00')); return isNaN(t) ? null : t; };
const FRAIS = 8 * 864e5;            // prix de plus de 8 jours ignorés pour les moyennes
const RUPT_MAX_J = 21;               // une rupture déclarée depuis plus de 21 jours n'est plus comptée
const DIAG = {};                     // âge des ruptures déclarées, par carburant (contrôle)
const VERSION = 2;
const st = [];                       // { dep, prix:{carb:valeur}, rupt:Set }
let derniereMaj = 0;
for (const p of pdvs) {
  const a = attrs(/<pdv\b([^>]*)>/.exec(p)[1]);
  const dep = depDe(a.cp); if (!dep) continue;   // DOM et codes inconnus exclus (prix réglementés)
  const s = { dep, prix: {}, vend: new Set(), rupt: new Set() };
  for (const m of p.matchAll(/<prix\b([^>]*)\/?>/g)) {
    const x = attrs(m[1]); const c = CARB[x.id] || Object.keys(NOMS).find(k => k === x.nom) || (x.nom === 'E10' ? 'E10' : null); if (!c) continue;
    let v = parseFloat(String(x.valeur).replace(',', '.')); if (!(v > 0)) continue; if (v > 100) v /= 1000;
    s.vend.add(c); const t = parseD(x.maj); if (t && t > derniereMaj && t <= now.getTime() + 864e5) derniereMaj = t;
    if (v > 0.5 && v < 5 && (!t || now - t < FRAIS)) s.prix[c] = v;
  }
  for (const m of p.matchAll(/<rupture\b([^>]*)\/?>/g)) {
    const x = attrs(m[1]); const c = CARB[x.id] || (x.nom === 'E10' ? 'E10' : NOMS[x.nom] ? x.nom : null); if (!c) continue;
    if ((x.type || 'temporaire') !== 'temporaire') continue;
    const fin = parseD(x.fin); if (fin && fin < now.getTime()) continue;
    const deb = parseD(x.debut), age = deb ? (now - deb) / 864e5 : null;
    const b = age == null ? 'inconnu' : age < 3 ? '<3 j' : age < 7 ? '3-7 j' : age < 21 ? '7-21 j' : age < 90 ? '21-90 j' : '>90 j';
    (DIAG[c] = DIAG[c] || {})[b] = (DIAG[c][b] || 0) + 1;
    if (age == null || age > RUPT_MAX_J) continue;   // rupture « temporaire » ancienne = arrêt de distribution, pas une tension
    s.rupt.add(c); s.vend.add(c);
  }
  st.push(s);
}

// ---------- agrégats ----------
const r3 = v => Math.round(v * 1000) / 1000, r1 = v => Math.round(v * 10) / 10;
function agreger(liste) {
  const o = {};
  for (const c of LISTE) {
    const base = liste.filter(s => s.vend.has(c)); if (!base.length) continue;
    const px = base.map(s => s.prix[c]).filter(Boolean).sort((a, b) => a - b);
    const nr = base.filter(s => s.rupt.has(c)).length;
    o[c] = { prix: px.length ? r3(px.reduce((a, b) => a + b, 0) / px.length) : null, med: px.length ? r3(px[Math.floor(px.length / 2)]) : null, n: base.length, rupt: r1(100 * nr / base.length), nr };
  }
  return o;
}
const national = agreger(st);
const parDep = {}; for (const s of st) (parDep[s.dep] = parDep[s.dep] || []).push(s);
const deps = {}; for (const d in parDep) { const a = agreger(parDep[d]); deps[d] = {}; for (const c in a) deps[d][c] = [a[c].prix, a[c].rupt, a[c].n]; }
const parReg = {}; for (const s of st) (parReg[REG[s.dep]] = parReg[REG[s.dep]] || []).push(s);
const regions = {}; for (const r in parReg) { const a = agreger(parReg[r]); regions[r] = {}; for (const c in a) regions[r][c] = [a[c].prix, a[c].rupt, a[c].n]; }

// ---------- historique ----------
let OLD = {}; try { OLD = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}
if (OLD.version !== VERSION) OLD = { serie: [] };   // changement de méthode : on repart d'un historique propre
let V = {}; try { V = JSON.parse(fs.readFileSync('data/veille.json', 'utf8')); } catch (e) {}
const jour = new Date(now.getTime() + 2 * 3600e3).toISOString().slice(0, 10); // jour de Paris (approx.)
const serie = (OLD.serie || []).filter(e => e.d !== jour);
const prevJour = (OLD.serie || []).find(e => e.d === jour);
const point = { d: jour };
for (const c of LISTE) if (national[c]) point[c] = [national[c].prix, Math.max(national[c].rupt, prevJour && prevJour[c] ? prevJour[c][1] : 0)];
serie.push(point); serie.sort((a, b) => a.d < b.d ? -1 : 1); while (serie.length > 400) serie.shift();
const ilYa = n => { const t = new Date(Date.parse(jour) - n * 864e5).toISOString().slice(0, 10); let best = null; for (const e of serie) if (e.d <= t) best = e; return best; };
const var7 = {}, var30 = {};
for (const c of LISTE) { const p = national[c] && national[c].prix; const a = ilYa(7), b = ilYa(30);
  var7[c] = p && a && a[c] && a[c][0] ? r3(p - a[c][0]) : null; var30[c] = p && b && b[c] && b[c][0] ? r1(100 * (p - b[c][0]) / b[c][0]) : null; }

// ---------- indice de tension carburant ----------
const pal = (v, s) => v == null ? null : v < s[0] ? 1 : v < s[1] ? 2 : v < s[2] ? 3 : v < s[3] ? 4 : 5;
const ruptNat = Math.max(national.Gazole ? national.Gazole.rupt : 0, national.E10 ? national.E10.rupt : 0);
let pireDep = null; for (const d in deps) for (const c of ['Gazole', 'E10']) { const x = deps[d][c]; if (x && x[2] >= 15 && (!pireDep || x[1] > pireDep.v)) pireDep = { d, c, v: x[1] }; }
const nDep10 = Object.values(deps).filter(x => ['Gazole', 'E10'].some(c => x[c] && x[c][2] >= 15 && x[c][1] >= 10)).length;
const amont = V.carburant && V.carburant.amont && V.carburant.amont.sev ? V.carburant.amont : null;
const comp = [
  { k: 'ruptures', t: 'Ruptures nationales', sev: pal(ruptNat, [0.5, 1, 2, 5]), w: 0.35, val: `${String(ruptNat).replace('.', ',')} % des stations (gazole ou SP95-E10)` },
  { k: 'local', t: 'Foyers locaux', sev: pal(pireDep ? pireDep.v : 0, [3, 6, 10, 20]), w: 0.2, val: pireDep ? `${String(pireDep.v).replace('.', ',')} % au pire (${pireDep.d}, ${NOMS[pireDep.c]}) · ${nDep10} dép. ≥ 10 %` : '—' },
  { k: 'prix', t: 'Dynamique des prix', sev: pal(var30.Gazole, [0, 3, 6, 10]), w: 0.2, val: var30.Gazole == null ? 'historique insuffisant (30 j)' : `gazole ${var30.Gazole > 0 ? '+' : ''}${String(var30.Gazole).replace('.', ',')} % sur 30 j` },
  { k: 'amont', t: 'Approvisionnement amont', sev: amont ? amont.sev : null, w: 0.25, val: amont ? (amont.texte || '') : 'en attente du relevé hebdomadaire' },
];
const ok = comp.filter(c => c.sev != null), wt = ok.reduce((a, c) => a + c.w, 0);
const sev = r1(ok.reduce((a, c) => a + c.sev * c.w, 0) / wt) || 1;
const continu = Math.round((6 - sev) * 100) / 100;
let niveau = Math.min(5, Math.max(1, Math.round(continu)));
if (ruptNat >= 10) niveau = Math.min(niveau, 1); else if (ruptNat >= 5 || nDep10 >= 5) niveau = Math.min(niveau, 2);
const LIB = { 5: 'Normal', 4: 'Vigilance', 3: 'Tension marquée', 2: 'Pénurie régionale', 1: 'Pénurie nationale' };

// ---------- alertes (sur franchissement, avec hystérésis) ----------
const actives = Object.assign({}, OLD.alertes_actives || {});
const nouvelles = [];
const alerte = (cle, actif, retour, a) => { if (actif && !actives[cle]) { actives[cle] = jour; nouvelles.push(a); } else if (!actif && actives[cle] && retour) delete actives[cle]; };
for (const c of ['Gazole', 'E10']) {
  const r = national[c] ? national[c].rupt : 0;
  alerte(`nat5-${c}`, r >= 5, r < 4, { sev: 5, titre: `${NOMS[c]} : ${String(r).replace('.', ',')} % des stations en rupture en France`, texte: 'Seuil national de 5 % franchi.' });
  if (r >= 5 && !actives[`nat2-${c}`]) actives[`nat2-${c}`] = jour;   // pas de double alerte 2 % + 5 %
  alerte(`nat2-${c}`, r >= 2, r < 1.5, { sev: 4, titre: `${NOMS[c]} : ruptures nationales à ${String(r).replace('.', ',')} %`, texte: 'Seuil national de 2 % franchi.' });
  const v = var7[c]; alerte(`prix-${c}`, v != null && v >= 0.08, v != null && v < 0.04, { sev: 4, titre: `${NOMS[c]} : +${String(Math.round((v || 0) * 100)).replace('.', ',')} centimes en 7 jours`, texte: `Prix moyen ${String(national[c] ? national[c].prix : '').replace('.', ',')} €/L.` });
  const avant = nouvelles.length;
  for (const d in deps) { const x = deps[d][c]; if (!x || x[2] < 15) { continue; }
    alerte(`dep-${d}-${c}`, x[1] >= 10, x[1] < 7, { dep: d, v: x[1], sev: x[1] >= 20 ? 5 : 4, titre: `${NOMS[c]} : ${String(x[1]).replace('.', ',')} % de stations à sec — ${NOMDEP[d]} (${d})`, texte: `${x[2]} stations suivies dans le département.` }); }
  const lot = nouvelles.splice(avant);
  if (lot.length > 2) { lot.sort((a, b) => b.v - a.v);
    nouvelles.push({ sev: Math.max(...lot.map(a => a.sev)), titre: `${NOMS[c]} : ${lot.length} départements passent au-delà de 10 % de stations à sec`, texte: lot.map(a => `${NOMDEP[a.dep]} (${a.dep}) ${String(a.v).replace('.', ',')} %`).join(' · ') });
  } else nouvelles.push(...lot);
}
for (const a of nouvelles) { delete a.dep; delete a.v; }
const lvlAvant = OLD.indice && OLD.indice.niveau;
if (lvlAvant && lvlAvant !== niveau) nouvelles.push({ sev: niveau < lvlAvant ? (niveau <= 2 ? 5 : 4) : 2, titre: `Tension carburant : niveau ${lvlAvant} → ${niveau} (${LIB[niveau]})`, texte: `Valeur continue ${String(continu).replace('.', ',')}.` });
const journal = [...nouvelles.map(a => ({ date: now.toISOString(), ...a })), ...(OLD.journal || [])].slice(0, 80);

// ---------- écriture ----------
const OUTD = {
  version: VERSION, controle_ruptures: { seuil_jours: RUPT_MAX_J, age: DIAG },
  maj: now.toISOString(), donnees_maj: derniereMaj ? new Date(derniereMaj).toISOString() : null,
  source: 'prix-carburants.gouv.fr — flux instantané (ministère de l’Économie)', n_stations: st.length,
  indice: { niveau, libelle: LIB[niveau], continu, severite: sev, composantes: comp.map(({ k, t, sev, w, val }) => ({ k, t, sev, w, val })) },
  national, var7, var30, regions, deps, serie, journal, alertes_actives: actives,
};
fs.writeFileSync(OUT, JSON.stringify(OUTD));
console.log(`Carburant : ${st.length} stations · gazole ${national.Gazole && national.Gazole.prix} €/L, ruptures ${national.Gazole && national.Gazole.rupt} % · indice ${niveau} (${LIB[niveau]}) · ${nouvelles.length} alerte(s)`);

// ---------- Discord ----------
const hook = process.env.DISCORD_WEBHOOK_ALERTES, role = process.env.DISCORD_ROLE_ID;
if (!nouvelles.length) process.exit(0);
const crit = nouvelles.some(a => a.sev >= 5);
const payload = {
  username: 'Veille stratégique · carburant',
  content: `⛽ **Carburant : ${nouvelles.length} alerte${nouvelles.length > 1 ? 's' : ''}**${crit && role ? ` <@&${role}>` : ''}`,
  embeds: nouvelles.slice(0, 10).map(a => ({ title: `${a.sev >= 5 ? '🔴' : a.sev >= 4 ? '🟠' : '🔵'} ${a.titre}`.slice(0, 250), url: SITE + '#france-carburant', description: a.texte, color: a.sev >= 5 ? 0xbd2f29 : a.sev >= 4 ? 0xcf6420 : 0x2c4a80, footer: { text: 'prix-carburants.gouv.fr · relevé automatique' }, timestamp: now.toISOString() })),
  allowed_mentions: { parse: [], roles: crit && role ? [role] : [] },
};
if (!hook) { console.log(JSON.stringify(payload, null, 1)); process.exit(0); }
fetch(hook + '?wait=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  .then(async r => { if (!r.ok) { console.error('Discord a refusé :', r.status, await r.text()); process.exit(1); } console.log('Alertes carburant publiées sur Discord'); })
  .catch(e => { console.error('Envoi impossible :', e.message); process.exit(1); });
