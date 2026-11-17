"""Coefficients de Montana calculés sur les pluies au pas de 6 minutes de Météo-France.

Données : jeu "Données climatologiques de base - 6 minutes" (Météo-France, data.gouv.fr, licence
ouverte 2.0), un fichier MN_<département>_<période>.csv.gz par département et par période, à
télécharger à part. Les séries commencent au plus tôt en juillet 2005.

Usage, une station :
  python -I donnees/montana_6min.py POSTE DEBUT FIN FICHIER [FICHIER ...] [options]
    POSTE    numéro Météo-France sur 8 chiffres (NUM_POSTE)
    DEBUT    premier mois retenu, AAAA-MM ; FIN dernier mois retenu, AAAA-MM
  options :
    --loi exp|gpd       loi des dépassements de seuil (exp par défaut)
    --par-an 1          nombre moyen d'événements retenus par année d'observation
    --separation 24     durée sèche minimale, en heures, entre deux événements retenus
    --durees 6,12,18,24,30,60,120,180,360,720,1440,2880
                        pas de temps en minutes ; ceux qui ne sont pas multiples de 6 sont interpolés
                        (log-log) entre les quantiles des multiples de 6 voisins
    --plages 6-30,30-360,360-2880
    --periodes 5,10,20,30,50,100
    --json sortie.json  enregistre le détail (quantiles, coefficients, diagnostic)

Usage, lot des stations de l'outil (liste LOT ci-dessous), de 2005 à FIN :
  python -I donnees/montana_6min.py --lot DOSSIER_DES_FICHIERS FIN [index.html]
    écrit donnees/montana_6min.json et, si index.html est donné, remplace le tableau
    STATIONS_MONTANA_B27 situé entre les repères /* MONTANA_B27:debut */ et /* MONTANA_B27:fin */.
    Une station qui a moins de 15 années valides est écartée (3 fois la période de 5 ans).

Méthode (guide CERTU 2003 "La ville et son assainissement", § 7.2.3, § 7.2.4 et § 8.3.5.3.1) :
1. Série régulière au pas de 6 min ; les pas absents ou vides sont des lacunes.
2. Pour chaque durée D, cumul glissant sur D (dépouillement à origine variable, étape 3) ;
   une fenêtre qui contient une lacune est écartée.
3. Événements indépendants : on retient le plus fort cumul, on écarte les fenêtres à moins de
   D + séparation de lui, et ainsi de suite (étape 1 : événements dépassant un seuil).
4. Méthode du renouvellement : on garde les N = par-an x P plus forts (P en années d'observation
   valides ; par défaut N = P, que le guide dit courant) ; le seuil s est le N+1-ième. Les
   dépassements suivent une loi exponentielle (loi supposée par la formule de Bos-Levenbach,
   éq. 45) ou de Pareto généralisée.
   Quantile de période de retour T : exp : h = s + m ln(N T / P), m moyenne des dépassements ;
   gpd : h = s + (sigma / xi) ((N T / P)^xi - 1).
5. Montana sur les hauteurs (§ 7.2.4) : ln h = ln a + (1 - b) ln t, moindres carrés sur les pas
   de chaque plage ; a en mm/min, t en min. L'outil emploie i = a' t^b' en mm/h : a' = 60 a, b' = -b.

Le guide (§ 8.3.5.3.2) demande une durée d'observation d'au moins 3 fois la période de retour
(5 à 7 fois souhaitables) : au-delà, la valeur est extrapolée, et l'outil le signale.

Réglage (JOURNAL, 2026-11-17) : N = P, séparation de 24 h et loi exponentielle retrouvent la fiche
Météo-France de Chouilly 2005-2021 à -7 % à +5 % sur les hauteurs, de 6 min à 24 h et de 5 à 100 ans.
"""
import argparse
import datetime
import glob
import gzip
import json
import math
import os
import re
import sys

import numpy as np

PAS = 6  # minutes
DUREES = [6, 12, 18, 24, 30, 60, 120, 180, 360, 720, 1440, 2880]
PLAGES = [(6, 30), (30, 360), (360, 2880)]
PERIODES = [5, 10, 20, 30, 50, 100]
ANNEES_MIN = 15

# Stations de l'outil : celles de la calculette Excel qui ont un poste 6 minutes du même nom,
# et les trois stations de contrôle dont une fiche Météo-France est publique (JOURNAL, 2026-11-17).
# Saint-Paul-Trois-Châteaux (26) n'a pas de poste 6 minutes. Auxerre (89) est écartée par la règle des 15 ans : son
# poste a changé en avril 2013 (89346001 puis 89295001 AUXERRE-PERRIGNY), et les deux séries ne se raccordent pas, le
# guide CERTU (§ 8.3.5.3.2) demandant des conditions d'observation stables.
LOT = [
    ("01089001", "Ambérieu", "01"), ("06088001", "Nice", "06"), ("10030001", "Troyes-Barberey", "10"),
    ("13001009", "Aix-en-Provence", "13"), ("21473001", "Dijon-Longvic", "21"), ("24452001", "Saint-Martial-Viveyrols", "24"),
    ("25056001", "Besançon", "25"), ("28070001", "Chartres", "28"), ("30189001", "Nîmes-Courbessac", "30"),
    ("31069001", "Toulouse-Blagnac", "31"), ("51153001", "Chouilly", "51"), ("54526001", "Nancy-Essey", "54"),
    ("58160001", "Nevers-Marzy", "58"), ("59343001", "Lille-Lesquin", "59"), ("63178001", "Issoire", "63"),
    ("71105001", "Mâcon", "71"), ("71320001", "Mont-Saint-Vincent", "71"), ("75114001", "Paris-Montsouris", "75"),
    ("76116001", "Rouen-Boos", "76"), ("77306001", "Melun", "77"), ("78640001", "Villacoublay", "78"),
    ("89346001", "Auxerre", "89"), ("89387002", "Sens", "89"), ("95527001", "Roissy", "95"),
]


def lire(fichiers, poste, debut, fin):
    """Série de cumuls 6 min (mm) sur une grille régulière, NaN pour les lacunes."""
    t0 = np.datetime64(debut + "-01T00:00")
    a, m = map(int, fin.split("-"))
    a, m = (a + 1, 1) if m == 12 else (a, m + 1)
    t1 = np.datetime64(f"{a:04d}-{m:02d}-01T00:00")
    n = int((t1 - t0) / np.timedelta64(PAS, "m"))
    rr = np.full(n, np.nan)
    meta = None
    cle = poste + ";"
    dates, valeurs = [], []
    for f in fichiers:
        with gzip.open(f, "rt", encoding="latin-1") as fh:
            next(fh)
            for ligne in fh:
                if not ligne.startswith(cle):
                    continue
                c = ligne.rstrip("\n").split(";")
                if meta is None:
                    meta = {"poste": c[0], "nom": c[1], "lat": float(c[2]), "lon": float(c[3]), "alti": float(c[4])}
                if c[6] != "":
                    d = c[5]
                    dates.append(f"{d[0:4]}-{d[4:6]}-{d[6:8]}T{d[8:10]}:{d[10:12]}")
                    valeurs.append(float(c[6]))
    if meta is None:
        sys.exit(f"Poste {poste} absent des fichiers donnés.")
    k = ((np.array(dates, dtype="datetime64[m]") - t0) // np.timedelta64(PAS, "m")).astype(np.int64)
    v = np.array(valeurs)
    garde = (k >= 0) & (k < n)
    rr[k[garde]] = v[garde]
    return meta, rr, t0


def cumul_glissant(rr, k):
    """Cumul sur k pas consécutifs ; NaN si la fenêtre contient une lacune."""
    lac = np.isnan(rr)
    v = np.where(lac, 0.0, rr)
    cs = np.concatenate([[0.0], np.cumsum(v)])
    cl = np.concatenate([[0], np.cumsum(lac)])
    s = cs[k:] - cs[:-k]
    s[(cl[k:] - cl[:-k]) > 0] = np.nan
    return s


def pics_independants(s, rayon, nmax):
    """Plus forts cumuls, deux à deux distants de plus de `rayon` pas, par ordre décroissant."""
    val = np.where(np.isnan(s), -1.0, s)
    ordre = np.argsort(-val, kind="stable")
    bloque = np.zeros(len(s), bool)
    retenus = []
    for i in ordre:
        if val[i] <= 0:
            break
        if bloque[i]:
            continue
        retenus.append(val[i])
        bloque[max(0, i - rayon):i + rayon + 1] = True
        if len(retenus) >= nmax:
            break
    return np.array(retenus)


def maxima_annuels(s, t0):
    """Maximum annuel du cumul (année civile de début de fenêtre), années complètes à 90 % au moins."""
    annees = (t0 + np.arange(len(s)) * np.timedelta64(PAS, "m")).astype("datetime64[Y]").astype(int) + 1970
    res = {}
    for an in np.unique(annees):
        x = s[annees == an]
        if np.mean(~np.isnan(x)) >= 0.9:
            res[int(an)] = float(np.nanmax(x))
    return res


def quantiles(pics, n, P, periodes, loi):
    s = pics[n]
    dep = pics[:n] - s
    lam = n / P
    if loi == "exp":
        m = float(np.mean(dep))
        return {T: s + m * math.log(lam * T) for T in periodes}, {"seuil": float(s), "m": m}
    from scipy.stats import genpareto
    xi, _, sig = genpareto.fit(dep, floc=0)
    q = {T: s + (sig / xi) * ((lam * T) ** xi - 1) if abs(xi) > 1e-9 else s + sig * math.log(lam * T) for T in periodes}
    return q, {"seuil": float(s), "sigma": float(sig), "xi": float(xi)}


def montana(durees, hauteurs):
    x = np.log(durees)
    y = np.log(hauteurs)
    pente, ordo = np.polyfit(x, y, 1)
    yc = ordo + pente * x
    r2 = 1 - np.sum((y - yc) ** 2) / np.sum((y - np.mean(y)) ** 2) if len(x) > 2 else 1.0
    return math.exp(ordo), 1 - pente, float(r2)


def mois(t0, k):
    return str((t0 + int(k) * np.timedelta64(PAS, "m")).astype("datetime64[M]"))


def calculer_station(fichiers, poste, debut, fin, durees=DUREES, plages=PLAGES, periodes=PERIODES,
                     loi="exp", par_an=1.0, separation=24.0):
    meta, rr, t0 = lire(fichiers, poste, debut, fin)
    ok = np.flatnonzero(~np.isnan(rr))
    P = float(len(ok)) * PAS / (60 * 24 * 365.25)
    n = int(round(par_an * P))
    sep = int(round(separation * 60 / PAS))
    calcules = sorted({d for d in durees if d % PAS == 0}
                      | {PAS * (d // PAS) for d in durees if d % PAS} | {PAS * (d // PAS + 1) for d in durees if d % PAS})
    Q, loi_par, annuels = {}, {}, {}
    for d in calcules:
        k = d // PAS
        s = cumul_glissant(rr, k)
        pk = pics_independants(s, k + sep, n + 1)
        Q[d], loi_par[d] = quantiles(pk, n, P, periodes, loi)
        annuels[d] = maxima_annuels(s, t0)
    for d in durees:
        if d % PAS:
            d0, d1 = PAS * (d // PAS), PAS * (d // PAS + 1)
            w = (math.log(d) - math.log(d0)) / (math.log(d1) - math.log(d0))
            Q[d] = {T: math.exp((1 - w) * math.log(Q[d0][T]) + w * math.log(Q[d1][T])) for T in periodes}
    coef = {}
    for T in periodes:
        coef[T] = {}
        for t0p, t1p in plages:
            ds = [d for d in durees if t0p <= d <= t1p]
            if len(ds) < 2:
                continue
            a, b, r2 = montana(np.array(ds, float), np.array([Q[d][T] for d in ds]))
            coef[T][f"{t0p}-{t1p}"] = {"a": a, "b": b, "r2": r2, "a_mmh": 60 * a, "b_outil": -b, "durees": ds}
    return {"station": meta, "debut": mois(t0, ok[0]) if len(ok) else debut, "fin": mois(t0, ok[-1]) if len(ok) else fin,
            "annees_valides": P, "evenements": n, "par_an": par_an, "separation_h": separation, "loi": loi,
            "quantiles": {str(d): {str(T): Q[d][T] for T in periodes} for d in durees},
            "loi_par_duree": {str(d): v for d, v in loi_par.items()},
            "maxima_annuels": {str(d): v for d, v in annuels.items()},
            "coefficients": {str(T): v for T, v in coef.items()}}


def afficher(res, periodes):
    print(f"{res['station']['nom']} ({res['station']['poste']}), {res['debut']} à {res['fin']} : "
          f"{res['annees_valides']:.2f} années valides, {res['evenements']} événements ({res['par_an']:g} par an), "
          f"séparation {res['separation_h']:g} h, loi {res['loi']}")
    print("Hauteurs (mm) par durée et période de retour :")
    print("  D(min) " + "".join(f"{T:>8}" for T in periodes))
    for d, q in res["quantiles"].items():
        print(f"  {int(d):6d} " + "".join(f"{q[str(T)]:8.1f}" for T in periodes))
    print("Coefficients de Montana (a en mm/min, h = a t^(1-b)) :")
    for T in periodes:
        c = res["coefficients"][str(T)]
        print(f"  T = {T:3d} ans " + " | ".join(f"{pl} : a {v['a']:.3f} b {v['b']:.3f}" for pl, v in c.items())
              + ("" if res["annees_valides"] >= 3 * T else "   (observation < 3 T)"))


def lot(dossier, fin, index):
    ici = os.path.dirname(os.path.abspath(__file__))
    stations, details = [], []
    for poste, nom, dep in LOT:
        fichiers = sorted(f for f in glob.glob(os.path.join(dossier, f"MN_{dep}_*.csv.gz")) if "latest" not in f)
        if not fichiers:
            print(f"{nom} ({dep}) : aucun fichier du département {dep}, station sautée")
            continue
        res = calculer_station(fichiers, poste, "2005-01", fin)
        P = res["annees_valides"]
        print(f"{nom} ({dep}, {poste}) : {res['debut']} à {res['fin']}, {P:.1f} années valides"
              + ("" if P >= ANNEES_MIN else f", moins de {ANNEES_MIN} ans : écartée"))
        if P < ANNEES_MIN:
            continue
        res["nom"], res["dep"] = nom, dep
        details.append(res)
        stations.append({"nom": nom, "dep": dep, "poste": poste, "debut": res["debut"], "fin": res["fin"],
                         "annees": round(P, 1),
                         "coef": {str(T): {pl: [round(v["a_mmh"], 1), round(v["b_outil"], 3)]
                                           for pl, v in res["coefficients"][str(T)].items()} for T in PERIODES}})
    entete = {"source": "Météo-France, Données climatologiques de base - 6 minutes, data.gouv.fr, licence ouverte 2.0",
              "fichiers_lus_le": datetime.date.today().isoformat(), "methode": "renouvellement, N = P, séparation 24 h, loi exponentielle (donnees/montana_6min.py)"}
    with open(os.path.join(ici, "montana_6min.json"), "w", encoding="utf-8") as fh:
        json.dump({**entete, "stations": details}, fh, ensure_ascii=False, indent=1)
    if index:
        with open(index, encoding="utf-8") as fh:
            html = fh.read()
        corps = "const STATIONS_MONTANA_B27 = [\n" + "".join(
            "  " + json.dumps(s, ensure_ascii=False, separators=(",", ":")) + ",\n" for s in stations) + "];\n"
        corps += f'const MONTANA_B27_LU_LE = "{entete["fichiers_lus_le"]}";\n'
        motif = re.compile(r"(/\* MONTANA_B27:debut \*/\n)[\s\S]*?(/\* MONTANA_B27:fin \*/)")
        if not motif.search(html):
            sys.exit("Repères MONTANA_B27 absents de " + index)
        html = motif.sub(lambda m: m.group(1) + corps + m.group(2), html)
        with open(index, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(html)
    print(f"{len(stations)} stations écrites")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--lot":
        if len(sys.argv) < 4:
            sys.exit(__doc__)
        return lot(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else None)
    p = argparse.ArgumentParser()
    p.add_argument("poste")
    p.add_argument("debut")
    p.add_argument("fin")
    p.add_argument("fichiers", nargs="+")
    p.add_argument("--loi", default="exp", choices=["exp", "gpd"])
    p.add_argument("--par-an", type=float, default=1.0)
    p.add_argument("--separation", type=float, default=24.0)
    p.add_argument("--durees", default=",".join(map(str, DUREES)))
    p.add_argument("--plages", default=",".join(f"{a}-{b}" for a, b in PLAGES))
    p.add_argument("--periodes", default=",".join(map(str, PERIODES)))
    p.add_argument("--json")
    o = p.parse_args()
    periodes = [int(x) for x in o.periodes.split(",")]
    res = calculer_station(o.fichiers, o.poste, o.debut, o.fin, [int(x) for x in o.durees.split(",")],
                           [tuple(int(v) for v in x.split("-")) for x in o.plages.split(",")], periodes,
                           o.loi, o.par_an, o.separation)
    afficher(res, periodes)
    if o.json:
        with open(o.json, "w", encoding="utf-8") as fh:
            json.dump(res, fh, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
