// Vérification du moteur de calcul, sans navigateur : node verifier-moteur.js
// Les scripts de calcul ("donnees", "pluie", "retention", "caquot", "collecteurs", "ouvrages", "calcul") sont extraits de index.html et exécutés
// tels quels : c'est bien le code publié qui est contrôlé.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script(?: id="([^"]*)")?>([\s\S]*?)<\/script>/g)];
const bloc = id => { const s = scripts.find(x => x[1] === id); if (!s) throw new Error("bloc absent : " + id); return s[2]; };
const ctx = { console, Math, JSON, Object, Array, Number, String, Set, Map, Infinity, NaN, isFinite, parseFloat, Error };
vm.createContext(ctx);
vm.runInContext(["donnees", "pluie", "retention", "caquot", "collecteurs", "ouvrages", "calcul"].map(bloc).join("\n").replace(/"use strict";/g, "")
  + "\nthis.api = { STATIONS_MONTANA_AS, STATIONS_MONTANA_B27, MONTANA_B27_LU_LE, cleStation, stationDe, origineStation, extrapolee, coefsValides, GRILLE_EXCEL, PLAGES, coefsStation, hauteur, methodeDesPluies, stockages, exposantsCaquot, debitCaquot, correctionAllongement, tcRelatif, assembler, SERIE_DN, H_QMAX, sectionCirculaire, debitManning, pleineSection, hauteurNormale, vitesseEcoulement, dimensionnerTroncon, SERIE_TUBES, volumeTalus, bassinCielOuvert, structureAlveolaire, tubesStockage, ouvrageStockage, regimeLoiSurLEau, bassinVersant, calculer };", ctx);
const A = ctx.api;

let echecs = 0, controles = 0;
function verifier(nom, obtenu, attendu, tolRel, tolAbs = 0) {
  controles++;
  const ecart = Math.abs(obtenu - attendu), ok = isFinite(obtenu) && ecart <= Math.max(tolRel * Math.abs(attendu), tolAbs);
  if (!ok) echecs++;
  console.log(`${ok ? "ok    " : "ÉCHEC "} ${nom} : ${+(+obtenu).toPrecision(7)} (attendu ${+(+attendu).toPrecision(7)})`);
}
function vrai(nom, cond) { controles++; if (!cond) echecs++; console.log(`${cond ? "ok    " : "ÉCHEC "} ${nom}`); }

const PARIS = "Paris Montsouris|75";
const c30 = A.coefsStation(PARIS, 30), c10 = A.coefsStation(PARIS, 10), c100 = A.coefsStation(PARIS, 100);

// 1. Données : les stations de la calculette sont toutes reprises et complètes
{
  console.log("\n1. Stations de Montana reprises de la calculette Excel");
  verifier("nombre de stations", A.STATIONS_MONTANA_AS.length, 22, 0);
  vrai("chaque station a 6 périodes et 3 plages valides", A.STATIONS_MONTANA_AS.every(s => [5, 10, 20, 30, 50, 100].every(T =>
    A.PLAGES.every(p => { const v = s.coef[String(T)][p.id]; return v[0] > 0 && v[1] < 0 && v[1] > -1; }))));
  verifier("Paris Montsouris 30 ans, a 6 à 30 min (onglet Coef Montana)", c30["6-30"][0], 339, 0);
  verifier("Paris Montsouris 30 ans, b 30 min à 6 h", c30["30-360"][1], -0.776, 0, 1e-12);
}

// 2. Méthode des pluies : la calculette Excel corrigée, onglet rétention, sur ses 18 durées
{
  console.log("\n2. Rétention, calculette Excel corrigée (Paris Montsouris 30 ans, Sa 786,4 m², 3 L/s)");
  const bv = A.bassinVersant({ lignes: [{ type: "ev", S: 265 }, { type: "bande_sterile", S: 26 }, { type: "beton", S: 103 }, { type: "enrobe", S: 95 }, { type: "toiture", S: 465 }, { type: "bassin", S: 105 }] });
  verifier("surface totale (D30)", bv.S, 1059, 0, 1e-9);
  verifier("surface active (E32)", bv.Sa, 786.4, 0, 1e-9);
  const r = A.methodeDesPluies(c30, bv.Sa, 3, { grille: A.GRILLE_EXCEL });
  verifier("volume à stocker (E59)", r.V, 22.482867193199436, 1e-12);
  verifier("temps de vidange en min (E61)", r.vidange, 124.90481773999686, 1e-12);
  const rc = A.methodeDesPluies(c30, bv.Sa, 3);
  vrai(`durée continue : volume ${rc.V.toFixed(3)} m³ au moins égal au volume sur la grille`, rc.V >= r.V - 1e-12);
  // Recherche brute au pas de 0,01 min : la forme fermée doit retrouver le même maximum
  const brute = (c, qs) => {
    let best = 0;
    for (const p of A.PLAGES) { const n = Math.round((p.t1 - p.t0) / 0.01); for (let i = 0; i <= n; i++) { const t = p.t0 + i * (p.t1 - p.t0) / n; best = Math.max(best, A.hauteur(c[p.id], t) - qs * t); } }
    return best;
  };
  verifier("forme fermée contre recherche au pas de 0,01 min (Δh max, mm)", rc.dhMax, brute(c30, rc.qs), 1e-7);
  verifier("équation 25 du guide CERTU : V = 10 Δh Sa(ha)", rc.V, 10 * rc.dhMax * bv.Sa / 1e4, 1e-12);
  // Cas où le maximum tombe à l'intérieur d'une plage (débit plus fort) : t* annule la dérivée
  const r2 = A.methodeDesPluies(c30, 2000, 40);
  const p2 = A.PLAGES.find(p => p.id === r2.plage);
  vrai(`40 L/s sur 2000 m² : durée critique ${r2.tCrit.toFixed(2)} min intérieure à la plage ${p2.nom}`, r2.tCrit > p2.t0 && r2.tCrit < p2.t1);
  const h = t => A.hauteur(c30[r2.plage], t) - r2.qs * t;
  vrai("  et c'est un maximum local", h(r2.tCrit) >= h(r2.tCrit * 0.999) && h(r2.tCrit) >= h(r2.tCrit * 1.001));
  verifier("  même maximum que la recherche au pas de 0,01 min", r2.dhMax, brute(c30, r2.qs), 1e-7);
}

// 3. Infiltration : la calculette Excel corrigée, onglet infiltration
{
  console.log("\n3. Infiltration, calculette Excel corrigée (K 1,9e-6 m/s sur 45 m², majoration 1,2)");
  const bv = A.bassinVersant({ lignes: [{ type: "ev", S: 265 }, { type: "bande_sterile", S: 26 }, { type: "beton", S: 103 }, { type: "enrobe", S: 95 }, { type: "toiture", S: 465 }, { type: "bassin", S: 105 }] });
  const st = { fuite: { val: 3, unite: "ls" }, K: 1.9e-6, Sinf: 45, majoration: 1.2 };
  const s = A.stockages(c30, bv, st, { grille: A.GRILLE_EXCEL });
  verifier("débit d'infiltration en L/s (E37 × 1000)", s.inf, 1.9e-6 * 45 * 1000, 1e-12);
  verifier("volume majoré (E85)", s.infiltration.V, 61.88201110847879, 1e-12);
  verifier("temps de vidange en min (E87)", s.infiltration.vidange, 12062.77019658456, 1e-12);
  verifier("rejet au réseau inchangé par la majoration", s.rejet.V, 22.482867193199436, 1e-12);
  vrai("mixte : volume compris entre rejet seul et infiltration seule bruts", s.mixte.Vbrut <= s.rejet.Vbrut && s.mixte.Vbrut <= s.infiltration.Vbrut);
  const lsha = A.stockages(c30, bv, { ...st, fuite: { val: 10, unite: "lsha" } });
  verifier("débit de fuite 10 L/s/ha sur 1059 m²", lsha.fuite, 10 * 0.1059, 1e-12);
}

// 4. Débit de pointe : onglet Débit pluie décennale de la calculette corrigée (correction d'allongement de la calculette)
{
  console.log("\n4. Caquot, onglet Débit pluie décennale (A 0,1059 ha, C 0,7426, I 0,005, L 80 m)");
  const Aha = 0.1059, C = 786.4 / 1059, I = 0.005, L = 80;
  const cas = [["10 ans, 6 à 30 min (K126)", c10, "6-30", 0.029831764253490163], ["10 ans, 30 min à 6 h (N126)", c10, "30-360", 0.06235381632441041],
    ["10 ans, 6 h à 48 h (Q126)", c10, "360-2880", 0.08178595519767282], ["100 ans, 6 à 30 min (B126)", c100, "6-30", 0.04950353847716973],
    ["100 ans, 30 min à 6 h (E126)", c100, "30-360", 0.11100207793284618], ["100 ans, 6 h à 48 h (H126)", c100, "360-2880", 0.25761781815492557]];
  for (const [nom, c, p, att] of cas) verifier(nom, A.debitCaquot(c[p], Aha, C, I, L, "it77").Q, att, 1e-9);
  verifier("débit brut 10 ans, 6 à 30 min (K110)", A.debitCaquot(c10["6-30"], Aha, C, I, L, "it77").Qbrut, 0.032784964780215156, 1e-9);
  verifier("allongement M (B123)", A.debitCaquot(c10["6-30"], Aha, C, I, L, "it77").M, 2.458340335452008, 1e-12);
}

// 5. Débit de pointe : onglet Caquot de la calculette corrigée, sous-bassins BV1 à BV6 (Paris Montsouris 10 ans, 6 à 30 min)
{
  console.log("\n5. Caquot, onglet Caquot, sous-bassins BV1 à BV6");
  const bvs = [[0.038, 0.6789473684210526, 0.01, 60, 0.012195490601630946], [0.0865, 0.5947976878612716, 0.01, 60, 0.024845070694380137],
    [0.189, 1, 0.01, 120, 0.07502694396552656], [0.1589, 0.826431718061674, 0.01, 131, 0.04818028764959759],
    [0.0865, 0.5947976878612716, 0.01, 250, 0.012932983426111185], [0.0585, 1, 0.01, 220, 0.01657499534264261]];
  bvs.forEach(([Aha, C, I, L, att], i) => verifier(`BV${i + 1} (AC${13 + i})`, A.debitCaquot(c10["6-30"], Aha, C, I, L, "it77").Q, att, 1e-9));
  const petit = A.debitCaquot(c10["6-30"], 1, 0.9, 0.01, 50, "it77");
  verifier("allongement ramené à 0,8 (IT 77, § 2.1.6)", petit.M, 0.8, 0, 1e-12);
}

// 6. Formules superficielles de l'IT 77 (§ 2.1.2) : les coefficients publiés pour les trois régions et T de 1 à 10 ans
{
  console.log("\n6. IT 77, § 2.1.2 : coefficients des formules superficielles");
  // [région, T, a (mm/min), b, coefficient, exposant de I, de C, de A] ; l'exposant de I de la région 3 à 2 ans est
  // imprimé 0,20 dans le texte numérisé (0,26 par la formule, comme à 1 an) : il n'est pas contrôlé
  const tab = [[1, 10, 5.9, -0.59, 1.430, 0.29, 1.20, 0.78], [1, 5, 5.0, -0.61, 1.192, 0.30, 1.21, 0.78], [1, 2, 3.7, -0.62, 0.834, 0.31, 1.22, 0.77], [1, 1, 3.1, -0.64, 0.682, 0.32, 1.23, 0.77],
    [2, 10, 6.7, -0.55, 1.601, 0.27, 1.19, 0.80], [2, 5, 5.5, -0.57, 1.290, 0.28, 1.20, 0.79], [2, 2, 4.6, -0.62, 1.087, 0.31, 1.22, 0.77], [2, 1, 3.5, -0.62, 0.780, 0.31, 1.22, 0.77],
    [3, 10, 6.1, -0.44, 1.296, 0.21, 1.14, 0.83], [3, 5, 5.9, -0.51, 1.327, 0.24, 1.17, 0.81], [3, 2, 5.0, -0.54, 1.121, null, 1.18, 0.80], [3, 1, 3.8, -0.53, 0.804, 0.26, 1.18, 0.80]];
  for (const [reg, T, a, b, K, eI, eC, eA] of tab) {
    const ex = A.exposantsCaquot([a * 60, b]);
    verifier(`région ${reg}, ${T} an(s) : coefficient`, ex.K, K, 0, 0.0015);
    if (eI != null) verifier(`région ${reg}, ${T} an(s) : exposant de I`, ex.eI, eI, 0, 0.0051);
    verifier(`région ${reg}, ${T} an(s) : exposant de C`, ex.eC, eC, 0, 0.0051);
    verifier(`région ${reg}, ${T} an(s) : exposant de A`, ex.eA, eA, 0, 0.0051);
  }
}

// 7. Correction d'allongement : les deux formules valent 1 pour M = 2 et diminuent le débit d'un bassin allongé
{
  console.log("\n7. Correction d'allongement");
  verifier("guide CERTU, M = 2", A.correctionAllongement(2, -0.5, "certu"), 1, 0, 1e-12);
  verifier("calculette, M = 2", A.correctionAllongement(2, -0.5, "it77"), 1, 0, 1e-12);
  verifier("guide CERTU, M = 4, b = -0,5 : (2)^(-0,35)", A.correctionAllongement(4, -0.5, "certu"), Math.pow(2, -0.35), 1e-12);
  vrai("M = 4 : correction inférieure à 1 avec les deux formules", A.correctionAllongement(4, -0.5, "certu") < 1 && A.correctionAllongement(4, -0.5, "it77") < 1);
}

// 8. Rubrique 2.1.5.0 (R.214-1) : seuils de 1 ha (strictement supérieur) et 20 ha (supérieur ou égal)
{
  console.log("\n8. Loi sur l'eau, rubrique 2.1.5.0");
  vrai("1 ha exactement : sous le seuil", A.regimeLoiSurLEau(10000, 0).regime === "aucun");
  vrai("1,0001 ha : déclaration", A.regimeLoiSurLEau(10001, 0).regime === "declaration");
  vrai("bassin naturel intercepté ajouté : 0,6 + 0,6 ha = déclaration", A.regimeLoiSurLEau(6000, 6000).regime === "declaration");
  vrai("19,99 ha : déclaration", A.regimeLoiSurLEau(199900, 0).regime === "declaration");
  vrai("20 ha : autorisation", A.regimeLoiSurLEau(200000, 0).regime === "autorisation");
}

// 9. Chaîne complète : projet par défaut de l'outil (exemple de la calculette)
{
  console.log("\n9. Projet complet");
  const E = { pluie: { source: "base", station: PARIS, T: 30, libre: {} },
    bv: { sousBassins: [{ I: 0.005, L: 80, lignes: [{ type: "ev", S: 265 }, { type: "bande_sterile", S: 26 }, { type: "beton", S: 103 }, { type: "enrobe", S: 95 }, { type: "toiture", S: 465 }, { type: "bassin", S: 105 }] }], surfaceProjet: null, bassinNaturel: 0 },
    stockage: { mode: "rejet", fuite: { val: 3, unite: "ls" }, K: 1.9e-6, Sinf: 45, majoration: 1.2 }, debit: { T: 10, plage: "6-30", variante: "it77" } };
  const R = A.calculer(E, { grille: A.GRILLE_EXCEL });
  verifier("volume de rétention", R.stock.rejet.V, 22.482867193199436, 1e-12);
  verifier("débit de pointe 10 ans", R.debit[0].Q, 0.029831764253490163, 1e-9);
  verifier("débit de pointe 100 ans", R.debit[1].Q, 0.04950353847716973, 1e-9);
  vrai("loi sur l'eau : sous le seuil", R.loiEau.regime === "aucun");
  const E2 = JSON.parse(JSON.stringify(E)); E2.stockage.fuite.val = 0;
  vrai("débit de fuite nul : erreur claire au lieu d'un volume infini", !!A.calculer(E2).stock.rejet.erreur);
}

// 10. Assemblage de sous-bassins : onglet Caquot de la calculette (avant nettoyage), lignes 67 à 107, Paris Montsouris
// 10 ans, 6 à 30 min, correction d'allongement de la calculette et règle de l'IT 77 en parallèle (L du plus fort débit)
{
  console.log("\n10. Assemblages de l'onglet Caquot (variante IT 77 et calculette)");
  const sbs = [["BV1", 0.038, 0.6789473684210526, 0.01, 60], ["BV2", 0.0865, 0.5947976878612716, 0.01, 60], ["BV3", 0.189, 1, 0.01, 120],
    ["BV4", 0.1589, 0.826431718061674, 0.01, 131], ["TBV11", 0.1704, 1, 0.02, 88], ["BV22", 0.091, 0.75, 0.02, 43], ["BV23", 0.103, 0.65, 0.02, 44],
    ["TBV2", 0.26, 1, 0.02, 127], ["TBV7", 0.06, 1, 0.02, 55], ["BV19", 0.131, 0.9, 0.02, 67], ["TBV3", 0.2325, 1, 0.02, 75], ["BV18", 0.107, 0.9, 0.02, 100],
    ["TBV8", 0.0165, 1, 0.02, 28], ["BV26", 0.136, 0.4, 0.02, 77], ["TBV9", 0.103, 1, 0.02, 57], ["BV16", 0.2285, 0.9, 0.02, 47]]
    .map(([nom, Aha, C, I, L]) => ({ nom, A: Aha, C, I, L }));
  const S = "serie", P = "parallele";
  // [nom, ligne, mode, éléments, J (A), K (C), X (I), Y (L), Z (M), AA (m), AB (Q brut), AC (Q)]
  const cas = [["A", 67, S, ["sb:0", "sb:1"], 0.1245, 0.6204819277108433, 0.01, 120, 3.4009212075908146, 0.7843685954820079, 0.03551979445742701, 0.027860611290381636],
    ["B", 68, S, ["sb:1", "sb:2"], 0.2755, 0.8727767695099817, 0.01, 180, 3.429349146950167, 0.7813872899640466, 0.10127045516659983, 0.07913144651605492],
    ["C", 69, S, ["sb:3", "sb:2"], 0.3479, 0.9207243460764589, 0.01, 251, 4.255459945809388, 0.7079204544355361, 0.1305186414285676, 0.09239681595242036],
    ["E", 71, P, ["sb:2", "sb:4"], 0.3594, 1, 0.015468056929343757, 88, 1.4678904187916795, 1.1520101834571628, 0.16257899084546365, 0.1655513822565789],
    ["R", 85, P, ["sb:6", "sb:5"], 0.194, 0.6969072164948453, 0.02, 43, 0.9762647097509746, 1.3883152678730974, 0.0683021344795672, 0.09108177092349679],
    ["II", 100, P, ["sb:8", "sb:9"], 0.191, 0.931413612565445, 0.02, 67, 1.5330563525535232, 1.129343814242809, 0.0943029545236111, 0.10633170709162268],
    ["JJ", 101, S, ["sb:7", "as:5"], 0.451, 0.9709534368070953, 0.02, 194, 2.888773284021178, 0.8451773820322225, 0.20056930251462682, 0.16951663801534114],
    ["KK1", 102, S, ["as:6", "sb:10"], 0.6835, 0.9808339429407461, 0.02, 269, 3.2537413050030506, 0.800405435110583, 0.28565200707416505, 0.22863741901240842],
    ["KK2", 103, S, ["as:7", "sb:11"], 0.7905, 0.9698924731182795, 0.02, 369, 4.150261188369812, 0.7160737794515403, 0.31779525987619855, 0.22756485283133393],
    ["LL", 104, P, ["sb:12", "sb:13"], 0.1525, 0.4649180327868852, 0.02, 77, 1.971767950966598, 1.0065250201592462, 0.035090829305240843, 0.03531979767386221],
    ["MM", 105, P, ["as:9", "sb:14"], 0.2555, 0.6806262230919765, 0.02, 57, 1.1276631882547263, 1.2997038087748551, 0.08335077715864929, 0.1003692919321647],
    ["NN", 106, P, ["as:8", "as:10"], 1.046, 0.8992351816443593, 0.02, 369, 3.6079501126396365, 0.7634479418467021, 0.3665953192491342, 0.27987644197138617],
    ["OO", 107, P, ["as:11", "sb:15"], 1.2745, 0.899372302863868, 0.02, 369, 3.2685598845830452, 0.7987432930606281, 0.4313495901224274, 0.34453759207473983]];
  const R = A.assembler(c10["6-30"], sbs, cas.map(([nom, , mode, elements]) => ({ nom, mode, elements })), "it77");
  for (const [nom, ligne, , , Aeq, Ceq, Ieq, Leq, M, m, Qb, Q] of cas) {
    const g = R.as.find(x => x.nom === nom);
    if (g.erreur) { vrai(`${nom} (ligne ${ligne}) : ${g.erreur}`, false); continue; }
    const tous = [["A", g.A, Aeq], ["C", g.C, Ceq], ["I", g.I, Ieq], ["L", g.L, Leq], ["M", g.M, M], ["m", g.m, m], ["Q brut", g.Qbrut, Qb], ["Q", g.Q, Q]];
    const pire = tous.reduce((x, [n, o, a]) => { const e = Math.abs(o - a) / Math.abs(a); return e > x[1] ? [n, e] : x; }, ["", 0]);
    vrai(`${nom} = ${g.elements.join(" " + (g.mode === "serie" ? "S" : "P") + " ")} (ligne ${ligne}) : A, C, I, L, M, m, Q brut et Q retrouvés (écart max ${pire[1].toExponential(1)} sur ${pire[0] || "aucun"})${g.plafonne ? ", plafonné à la somme amont" : ""}`, pire[1] < 1e-9);
  }
  vrai("E, R, II et MM plafonnés à la somme des débits amont, comme dans la calculette", ["E", "R", "II", "MM"].every(n => R.as.find(x => x.nom === n).plafonne)
    && ["A", "B", "C", "JJ", "KK1", "KK2", "LL", "NN", "OO"].every(n => !R.as.find(x => x.nom === n).plafonne));
  verifier("sous-bassin TBV11 isolé (AC54)", R.sb[4].Q, 0.09052443829105233, 1e-9);
  vrai("BV2 et BV3 repris dans plusieurs assemblages : signalé", R.alertes.some(a => a.startsWith("BV2 ")) && R.alertes.some(a => a.startsWith("BV3 ")));
  vrai("plusieurs exutoires (A, B, C, E, R, OO) : signalé, pas d'exutoire unique", !R.exutoire && R.racines.map(r => r.nom).join() === "A,B,C,E,R,OO");

  console.log("\n   Règles du guide CERTU, contrôles de groupement");
  // Série : I équivalente de l'IT 77 et du tableau 42 du guide CERTU
  const s2 = A.assembler(c10["6-30"], [{ nom: "a", A: 1, C: 0.5, I: 0.01, L: 100 }, { nom: "b", A: 3, C: 0.9, I: 0.04, L: 300 }], [{ nom: "s", mode: S, elements: ["sb:0", "sb:1"] }], "certu");
  const gs = s2.as[0];
  verifier("série : I = [ΣL / Σ(L/√I)]²", gs.I, Math.pow(400 / (100 / 0.1 + 300 / 0.2), 2), 1e-12);
  verifier("série : C = ΣCA / ΣA", gs.C, (0.5 + 2.7) / 4, 1e-12);
  verifier("série : M = ΣL / √ΣA", gs.Mbrut, 4 / 2, 1e-12);
  vrai("série seule : exutoire unique, aucune alerte", s2.exutoire === gs && !s2.alertes.length);
  // Parallèle : un bassin raide et compact (plus fort débit) et un bassin plat et allongé (plus long temps de concentration)
  const par = [{ nom: "raide", A: 2, C: 0.9, I: 0.04, L: 150 }, { nom: "plat", A: 0.8, C: 0.6, I: 0.005, L: 400 }];
  const pc = A.assembler(c10["6-30"], par, [{ nom: "p", mode: P, elements: ["sb:0", "sb:1"] }], "certu").as[0];
  const pi = A.assembler(c10["6-30"], par, [{ nom: "p", mode: P, elements: ["sb:0", "sb:1"] }], "it77").as[0];
  const [q0, q1] = [0, 1].map(i => A.debitCaquot(c10["6-30"], par[i].A, par[i].C, par[i].I, par[i].L, "certu").Q);
  vrai(`cas d'essai : le bassin raide a le plus fort débit (${q0.toFixed(3)} > ${q1.toFixed(3)} m³/s) et le plat le plus long tc`, q0 > q1 && A.tcRelatif(0.8, 0.005, q1) > A.tcRelatif(2, 0.04, q0));
  vrai("parallèle, guide CERTU : L du bassin au plus long temps de concentration (400 m)", pc.L === 400 && pc.Lde === "plat");
  vrai("parallèle, IT 77 : L du bassin au plus fort débit (150 m)", pi.L === 150 && pi.Lde === "raide");
  verifier("parallèle : I = ΣI.Q / ΣQ", pc.I, (0.04 * q0 + 0.005 * q1) / (q0 + q1), 1e-12);
  // Contrôles
  const ctl = A.assembler(c10["6-30"], [{ nom: "x", A: 1, C: 0.9, I: 0.001, L: 100 }, { nom: "y", A: 1, C: 0.9, I: 0.03, L: 100 }, { nom: "z", A: 1, C: 0.9, I: 0.01, L: 100 }],
    [{ nom: "g", mode: P, elements: ["sb:0", "sb:1"] }, { nom: "vide", mode: S, elements: ["sb:2"] }], "certu");
  vrai("rapport des pentes extrêmes de 30 (au moins 20) : signalé (IT 77, § 2.1.8)", ctl.as[0].controles.some(c => c.includes("§ 2.1.8")));
  vrai("assemblage d'un seul élément : erreur claire", !!ctl.as[1].erreur);
  vrai("sous-bassin z hors assemblage : signalé", ctl.alertes.some(a => a.includes("hors assemblage : z")) && !ctl.exutoire);
  const boucle = A.assembler(c10["6-30"], par, [{ nom: "g", mode: S, elements: ["sb:0", "as:0"] }], "certu");
  vrai("un assemblage ne peut se reprendre lui-même", !!boucle.as[0].erreur);

  console.log("\n   Projet en parcours Réseau");
  // BV1 et BV2 de la calculette, saisis en surfaces : 380 m² à C 0,6789... et 865 m² à C 0,5948...
  const sbE = (nom, S, C, I, L) => ({ nom, I, L, lignes: [{ type: "autre", S, C }] });
  const E = { pluie: { source: "base", station: PARIS, T: 30, libre: {} },
    bv: { sousBassins: [sbE("BV1", 380, 0.6789473684210526, 0.01, 60), sbE("BV2", 865, 0.5947976878612716, 0.01, 60)], surfaceProjet: null, bassinNaturel: 0 },
    reseau: { actif: true, assemblages: [{ nom: "A", mode: S, elements: ["sb:0", "sb:1"] }] },
    stockage: { mode: "rejet", fuite: { val: 3, unite: "ls" }, K: 1.9e-6, Sinf: 45, majoration: 1.2 }, debit: { T: 10, plage: "6-30", variante: "it77" } };
  const Rr = A.calculer(E);
  verifier("exutoire A = BV1 S BV2 : débit 10 ans (ligne 67, AC)", Rr.debit[0].Q, 0.027860611290381636, 1e-9);
  verifier("stockage sur l'ensemble des sous-bassins : surface", Rr.bv.S, 1245, 0, 1e-9);
  verifier("  et surface active", Rr.bv.Sa, 380 * 0.6789473684210526 + 865 * 0.5947976878612716, 1e-12);
  const Ep = JSON.parse(JSON.stringify(E)); Ep.reseau.actif = false;
  verifier("parcours Parcelle : seul le premier sous-bassin compte (BV1, AC13)", A.calculer(Ep).debit[0].Q, 0.012195490601630946, 1e-9);
  const Es = JSON.parse(JSON.stringify(E)); Es.reseau.assemblages = [];
  vrai("deux sous-bassins sans assemblage : débit à l'exutoire refusé, message clair", !!A.calculer(Es).debit[0].erreur);
  const E1 = JSON.parse(JSON.stringify(Es)); E1.bv.sousBassins.pop();
  verifier("un seul sous-bassin sans assemblage : c'est l'exutoire", A.calculer(E1).debit[0].Q, 0.012195490601630946, 1e-9);
}

// 11. Collecteurs : formule de Manning-Strickler (NF EN 16933-2, § 7.2.3) sur un tuyau circulaire
{
  console.log("\n11. Collecteurs, Manning-Strickler");
  // Calcul à la main, DN 300, K 75, pente 1 % : v = 75 × (0,3/4)^(2/3) × 0,1 ; Q = v × π × 0,3² / 4
  const ps = A.pleineSection(75, 0.3, 0.01);
  verifier("DN 300, K 75, I 1 % : vitesse à pleine section (m/s)", ps.v, 1.3338349891837737, 1e-12);
  verifier("  débit à pleine section (m³/s)", ps.Q, 0.09428323957021721, 1e-12);
  verifier("demi-section : même rayon hydraulique, moitié du débit plein", A.debitManning(75, 0.3, 0.01, 0.15), ps.Q / 2, 1e-12);
  vrai(`débit maximal à ${(A.H_QMAX * 100).toFixed(1)} % de la hauteur, au-dessus du débit plein`, A.H_QMAX > 0.93 && A.H_QMAX < 0.95 && A.debitManning(75, 1, 0.01, A.H_QMAX) > A.pleineSection(75, 1, 0.01).Q);
  const y = A.hauteurNormale(75, 0.3, 0.01, 0.3 * ps.Q);
  verifier("hauteur normale pour 30 % du débit plein : le débit est retrouvé", A.debitManning(75, 0.3, 0.01, y), 0.3 * ps.Q, 1e-9);
  // IT 77, § 5.1.0 : les repères de 0,60 m/s pour 1/10 du débit plein et 0,30 m/s pour 1/100 sont tenus avec environ 1 m/s à pleine section
  const D = 0.6, I1 = Math.pow(1 / (75 * Math.pow(D / 4, 2 / 3)), 2);
  vrai("1 m/s à pleine section : au moins 0,60 m/s pour 1/10 du débit et 0,30 m/s pour 1/100, comme l'indique l'IT 77", A.vitesseEcoulement(75, D, I1, A.pleineSection(75, D, I1).Q / 10) >= 0.6 && A.vitesseEcoulement(75, D, I1, A.pleineSection(75, D, I1).Q / 100) >= 0.3);
  // Table de débitance de la calculette (Q/√I à pleine section, onglet Caquot, AP15:AQ27) : Manning à K 75 à 1 % près dès le DN 300
  const table = { 300: 0.95, 400: 2.04, 500: 3.69, 600: 6, 800: 12.93, 1000: 23.44, 1200: 38.12, 1500: 69.12, 1600: 82.1, 1800: 112.4, 2200: 191.93, 2500: 269.9 };
  vrai("table de débitance de la calculette : Manning à K 75 à 1 % près du DN 300 au DN 2500", Object.entries(table).every(([dn, k]) => Math.abs(A.pleineSection(75, dn / 1000, 1).Q / k - 1) < 0.01));
  // Choix du DN
  vrai("ligne TOTAL de l'onglet Caquot (74,1 L/s, pente 1 %) : DN 300, comme la calculette (AL12)", A.dimensionnerTroncon(75, 0.01, 0.07405288526175259, { DNmin: 200 }).DN === 300);
  vrai("assemblage A (27,9 L/s, pente 0,5 %) : DN 300, comme la calculette (AL67)", A.dimensionnerTroncon(75, 0.005, 0.027860611290381636, { DNmin: 200 }).DN === 300);
  const petit = A.dimensionnerTroncon(70, 0.01, 0.001, { DNmin: 300 });
  vrai("débit très faible : DN minimal retenu (300)", petit.DN === 300);
  const plat = A.dimensionnerTroncon(70, 0.002, 0.03, {});
  vrai(`pente de 0,2 % : ${plat.vps.toFixed(2)} m/s à pleine section, repères d'autocurage de l'IT 77 non tenus et signalés`, plat.vps < 1 && plat.controles.some(c => c.includes("IT 77")));
  const t = A.dimensionnerTroncon(70, 0.004, 0.2, {});
  vrai(`200 L/s à 0,4 % : DN ${t.DN}, le plus petit dont le débit plein suffit`, t.Qps >= 0.2 && A.pleineSection(70, A.SERIE_DN[A.SERIE_DN.indexOf(t.DN) - 1] / 1000, 0.004).Q < 0.2);
  verifier("  taux de remplissage = Q / Q plein", t.taux, 0.2 / t.Qps, 1e-12);
  const impose = A.dimensionnerTroncon(70, 0.004, 0.2, { DNimpose: 300 });
  vrai("DN imposé trop petit : mise en charge signalée", impose.taux > 1 && impose.controles.some(c => c.includes("mise en charge")));
  vrai("DN 200 posé à 0,4 % : pente inférieure à 1:DN signalée (NF EN 16933-2, § 10.2.1)", A.dimensionnerTroncon(70, 0.004, 0.005, { DNmin: 200 }).controles.some(c => c.includes("1:200")));
  vrai("pente nulle : erreur claire", !!A.dimensionnerTroncon(70, 0, 0.1, {}).erreur);
  vrai("débit au-delà du DN 2500 : erreur claire", !!A.dimensionnerTroncon(70, 0.001, 50, {}).erreur);
  // Chaîne complète : collecteur à l'aval de l'assemblage A = BV1 S BV2 de la calculette
  const sbE = (nom, S, C, I, L) => ({ nom, I, L, lignes: [{ type: "autre", S, C }] });
  const E = { pluie: { source: "base", station: PARIS, T: 30, libre: {} },
    bv: { sousBassins: [sbE("BV1", 380, 0.6789473684210526, 0.01, 60), sbE("BV2", 865, 0.5947976878612716, 0.01, 60)], surfaceProjet: null, bassinNaturel: 0 },
    reseau: { actif: true, assemblages: [{ nom: "A", mode: "serie", elements: ["sb:0", "sb:1"] }] },
    collecteurs: { K: 75, DNmin: 200, troncons: [{ nom: "C1", source: "as:0", I: 0.005, Qajout: 2 }, { nom: "C2", source: "saisi", Qsaisi: 15, I: 0.01 }] },
    stockage: { mode: "rejet", fuite: { val: 3, unite: "ls" }, K: 1.9e-6, Sinf: 45, majoration: 1.2 }, debit: { T: 10, plage: "6-30", variante: "it77" } };
  const Rc = A.calculer(E).collecteurs;
  verifier("collecteur C1 : débit de l'assemblage A plus 2 L/s d'apport", Rc[0].Q, 0.027860611290381636 + 0.002, 1e-9);
  vrai("  DN 300 et taux de remplissage à 100 ans calculé", Rc[0].DN === 300 && Rc[0].taux100 > Rc[0].taux);
  verifier("collecteur C2 : débit saisi de 15 L/s", Rc[1].Q, 0.015, 1e-12);
}

// 12. Ouvrages de stockage : géométrie du volume utile
{
  console.log("\n12. Ouvrages de stockage");
  // Bassin à talus : formule du prismatoïde, V = h/6.(A1 + 4.Am + A2), contrôlée sur un cas à la main (20 x 10 m, talus 1/2, h = 1 m)
  const prisme = (L, l, n, h) => h / 6 * (L * l + 4 * (L - n * h) * (l - n * h) + (L - 2 * n * h) * (l - 2 * n * h));
  verifier("tronc de pyramide 20 x 10 m, talus 1/2, h 1 m (m³)", A.volumeTalus(20, 10, 2, 1), 872 / 6, 1e-12);
  verifier("  égal à la formule du prismatoïde sur un autre cas", A.volumeTalus(31.5, 27.3, 3, 1.4), prisme(31.5, 27.3, 3, 1.4), 1e-12);
  const b = A.bassinCielOuvert(145.33333333333334, { L: 20, l: 10, n: 2 });
  verifier("hauteur utile retrouvée pour 145,33 m³ sur 20 x 10 m, talus 1/2", b.h, 1, 1e-9);
  verifier("  fond de 16 x 6 m", b.Sfond, 96, 1e-9);
  verifier("  talus mouillés : h.√(1+n²).(L + Lfond + l + lfond)", b.Slat, Math.sqrt(5) * (20 + 16 + 10 + 6), 1e-9);
  vrai("talus 1/2 pour un bassin accessible au public : signalé (IT 77, § 7.1.2, 1/6 au plus)", A.bassinCielOuvert(100, { L: 20, l: 10, n: 2, public: true }).controles.length === 1);
  vrai("talus 1/2 pour un bassin non accessible : conforme", A.bassinCielOuvert(100, { L: 20, l: 10, n: 2, public: false }).controles.length === 0);
  vrai("emprise trop petite pour les talus : erreur claire", !!A.bassinCielOuvert(500, { L: 11, l: 10, n: 2 }).erreur);
  verifier("parois verticales : h = V / (L.l)", A.bassinCielOuvert(110, { L: 11, l: 10, n: 0 }).h, 1, 1e-12);
  // Structure alvéolaire : volume brut = utile / taux de vide (la calculette arrondit 61,88 / 0,9 à 69 m³, E34)
  const s = A.structureAlveolaire(61.88201110847879, { L: 11, l: 10, vide: 0.9 });
  verifier("SAUL, taux de vide 0,9 : volume brut (calculette E34 = 69 arrondi)", s.Vbrut, 61.88201110847879 / 0.9, 1e-12);
  verifier("  hauteur sur 110 m² (calculette E36 = 0,627 avec le volume arrondi)", s.h, 61.88201110847879 / 0.9 / 110, 1e-12);
  const s2 = A.structureAlveolaire(61.88201110847879, { L: 11, l: 10, vide: 0.95, hModule: 0.4 });
  vrai(`  modules de 0,40 m : ${s2.couches} couches, volume utile ${s2.Vutile.toFixed(1)} m³ au moins égal au volume à stocker`, s2.couches === 2 && s2.Vutile >= 61.88201110847879);
  vrai("SAUL sans taux de vide : erreur claire (valeur du fabricant)", !!A.structureAlveolaire(50, { L: 10, l: 5 }).erreur);
  // Tubes : volume d'une file = L.π.D²/4 (calculette A69 : 11 m de DN 400 = 1,3823 m³)
  verifier("tube DN 400 sur 11 m imposé (calculette A69, m³)", A.tubesStockage(1, { L: 11, D: 400 }).Vutile, 1.3823007675795091, 1e-12);
  const t = A.tubesStockage(22.482867193199436, { L: 20, files: 2 });
  vrai(`22,5 m³ sur 2 files de 20 m : DN ${t.D}, le plus petit qui suffit`, t.Vutile >= 22.482867193199436 && 2 * 20 * Math.PI * Math.pow(A.SERIE_TUBES[A.SERIE_TUBES.indexOf(t.D) - 1] / 1000, 2) / 4 < 22.482867193199436);
  vrai("550 m³ sur 11 m : insuffisant même en DN 2900, comme la calculette (B41 et B42)", !!A.tubesStockage(550, { L: 11, files: 1 }).erreur && !!A.tubesStockage(550, { L: 11, files: 2 }).erreur);
  verifier("DN 1000 imposé : longueur nécessaire pour 22,48 m³", A.tubesStockage(22.482867193199436, { D: 1000, files: 1 }).Lnec, 22.482867193199436 / (Math.PI / 4), 1e-12);
  // Profondeur du fond et nappe
  const o = A.ouvrageStockage(145.33333333333334, { type: "ciel", arrivee: 0.8, nappe: 1.5, ciel: { L: 20, l: 10, n: 2 } });
  verifier("fond = arrivée du réseau 0,80 m + hauteur utile 1 m", o.fond, 1.8, 1e-9);
  vrai("fond sous les plus hautes eaux de la nappe : signalé", o.controles.some(c => c.includes("nappe")));
  // Chaîne complète : projet par défaut, rétention de 22,48 m³ (calculette) en structure alvéolaire
  const E = { pluie: { source: "base", station: PARIS, T: 30, libre: {} },
    bv: { sousBassins: [{ I: 0.005, L: 80, lignes: [{ type: "ev", S: 265 }, { type: "bande_sterile", S: 26 }, { type: "beton", S: 103 }, { type: "enrobe", S: 95 }, { type: "toiture", S: 465 }, { type: "bassin", S: 105 }] }], surfaceProjet: null, bassinNaturel: 0 },
    stockage: { mode: "rejet", fuite: { val: 3, unite: "ls" }, K: 1.9e-6, Sinf: 45, majoration: 1.2 }, debit: { T: 10, plage: "6-30", variante: "it77" },
    ouvrage: { type: "saul", arrivee: 1, nappe: null, saul: { L: 10, l: 5, vide: 95 } } };
  verifier("projet complet : SAUL de 10 x 5 m à 95 % de vide pour la rétention, hauteur (m)", A.calculer(E, { grille: A.GRILLE_EXCEL }).ouvrage.h, 22.482867193199436 / 0.95 / 50, 1e-12);
}

// 13. Stations calculées par B27 sur les pluies 6 minutes publiques de Météo-France (donnees/montana_6min.py --lot)
{
  console.log("\n13. Stations de Montana calculées par B27 (données publiques Météo-France)");
  const B = A.STATIONS_MONTANA_B27;
  const detail = JSON.parse(fs.readFileSync(path.join(__dirname, "donnees", "montana_6min.json"), "utf8"));
  verifier("stations de la page = stations du calcul (donnees/montana_6min.json)", B.length, detail.stations.length, 0);
  vrai(`${B.length} stations, au moins 20`, B.length >= 20);
  vrai("chaque station a 6 périodes et 3 plages valides (a > 0, b entre -1 et 0)", B.every(s => [5, 10, 20, 30, 50, 100].every(T => A.coefsValides(s.coef[String(T)]))));
  vrai("chaque station a au moins 15 années valides, de fin juin 2005 au plus tôt à décembre 2024", B.every(s => s.annees >= 15 && s.debut >= "2005-06" && s.fin <= "2024-12"));
  vrai("clés uniques, distinctes de celles de la calculette", new Set([...B, ...A.STATIONS_MONTANA_AS].map(A.cleStation)).size === B.length + A.STATIONS_MONTANA_AS.length);
  let ecartMax = 0;
  for (const s of B) {
    const d = detail.stations.find(x => x.station.poste === s.poste);
    for (const T of [5, 10, 20, 30, 50, 100]) for (const p of A.PLAGES) {
      const c = d.coefficients[String(T)][p.id];
      ecartMax = Math.max(ecartMax, Math.abs(s.coef[String(T)][p.id][0] - c.a_mmh) / 0.05, Math.abs(s.coef[String(T)][p.id][1] - c.b_outil) / 0.0005);
    }
  }
  vrai(`coefficients de la page = calcul arrondi (a au dixième, b au millième) : écart rapporté au demi-arrondi ${ecartMax.toFixed(3)}`, ecartMax <= 1 + 1e-9);
  vrai("hauteurs croissantes avec la période de retour, à chaque station, plage et borne", B.every(s => A.PLAGES.every(p => [p.t0, p.t1].every(t => {
    const h = [5, 10, 20, 30, 50, 100].map(T => A.hauteur(s.coef[String(T)][p.id], t)); return h.every((x, i) => i === 0 || x > h[i - 1]); }))));
  const paris = A.stationDe("mf:75114001");
  vrai("Paris-Montsouris calculée : origine b27 ; Paris Montsouris de la calculette : origine as", !!paris && A.origineStation(paris) === "b27" && A.origineStation(A.stationDe(PARIS)) === "as");
  vrai(`extrapolation (guide CERTU, § 8.3.5.3.2, ${paris.annees} années) : 5 ans non, 10 et 100 ans oui ; calculette jamais signalée`,
    !A.extrapolee(paris, 5) && A.extrapolee(paris, 10) && A.extrapolee(paris, 100) && !A.extrapolee(A.stationDe(PARIS), 100));
  vrai("date de lecture des fichiers renseignée", /^\d{4}-\d{2}-\d{2}$/.test(A.MONTANA_B27_LU_LE));
  const E = { pluie: { source: "base", station: "mf:75114001", T: 10, libre: {} },
    bv: { sousBassins: [{ I: 0.01, L: 150, lignes: [{ type: "toiture", S: 10000 }] }], surfaceProjet: null, bassinNaturel: 0 },
    stockage: { mode: "rejet", fuite: { val: 2, unite: "ls" }, K: 1e-5, Sinf: 100, majoration: 1 }, debit: { T: 10, plage: "6-30", variante: "certu" },
    ouvrage: { type: "ciel", arrivee: null, nappe: null, ciel: { L: 30, l: 20, n: 2 } } };
  const R = A.calculer(E, {});
  vrai(`projet sur Paris-Montsouris calculée : origine b27, volume ${R.stock ? R.stock.rejet.V.toFixed(1) : "-"} m³, débits ${R.debit.map(d => d.Q ? (d.Q * 1000).toFixed(0) : "-").join(" et ")} L/s`,
    R.pluie.origine === "b27" && !!R.stock && R.stock.rejet.V > 0 && R.debit.every(d => d.Q > 0));
}

console.log(`\n${controles - echecs}/${controles} contrôles conformes${echecs ? `, ${echecs} en échec` : ""}.`);
process.exitCode = echecs ? 1 : 0;
