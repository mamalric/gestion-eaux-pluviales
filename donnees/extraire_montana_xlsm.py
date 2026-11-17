"""Extrait les coefficients de Montana de la calculette Excel d'Antonin (onglet Coef Montana).

Usage : python -I donnees/extraire_montana_xlsm.py "<calculette .xlsm>" [index.html]

Écrit donnees/montana_calculette_as.json et, si index.html est donné, remplace le tableau
STATIONS_MONTANA situé entre les repères /* MONTANA_AS:debut */ et /* MONTANA_AS:fin */.

Origine des valeurs : calculette Excel de B27, sans source ni date. Elles sont marquées
"origine non vérifiée" dans l'outil.
Disposition de l'onglet : un bloc de 3 colonnes par station (libellé, a, b), en partant de la
colonne B ; périodes de retour 5, 10, 20, 30, 50 et 100 ans ; plages 6 à 30 min (lignes 4 à 9),
30 min à 6 h (lignes 12 à 17), 6 h à 48 h (lignes 20 à 25). a en mm/h, t en min, b négatif.
"""
import json
import pathlib
import re
import sys

import openpyxl

PERIODES = [5, 10, 20, 30, 50, 100]
PLAGES = [(4, "6-30"), (12, "30-360"), (20, "360-2880")]


def lire(xlsm):
    wb = openpyxl.load_workbook(xlsm, data_only=True)
    ws = wb["Coef Montana"]
    noms = [ws.cell(row=30 + i, column=2).value for i in range(22)]
    stations = []
    for i, nom in enumerate(noms):
        nom = (ws.cell(row=2, column=2 + 3 * i).value if str(nom).startswith("=") or nom is None else nom)
        nom = re.sub(r"\s+", " ", str(nom)).strip()
        m = re.search(r"(\d{2})$", nom)
        dep = m.group(1) if m else ""
        libelle = re.sub(r"\s*\d{2}$", "", nom).strip()
        coef = {}
        for ligne0, plage in PLAGES:
            for k, T in enumerate(PERIODES):
                r = ligne0 + k
                etiquette = str(ws.cell(row=r, column=2 + 3 * i).value or "").strip()
                if not etiquette.startswith(str(T)):
                    raise ValueError(f"{nom} : ligne {r} attendue {T} ans, lue {etiquette!r}")
                a = ws.cell(row=r, column=3 + 3 * i).value
                b = ws.cell(row=r, column=4 + 3 * i).value
                if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
                    raise ValueError(f"{nom} {T} ans {plage} : valeurs manquantes ({a!r}, {b!r})")
                coef.setdefault(str(T), {})[plage] = [round(float(a), 4), round(float(b), 4)]
        stations.append({"nom": libelle.title() if libelle.isupper() else libelle, "dep": dep, "coef": coef})
    return stations


def en_js(stations):
    lignes = ["const STATIONS_MONTANA_AS = ["]
    for s in stations:
        lignes.append("  " + json.dumps(s, ensure_ascii=False, separators=(",", ":")) + ",")
    lignes.append("];")
    return "\n".join(lignes)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    stations = lire(sys.argv[1])
    ici = pathlib.Path(__file__).resolve().parent
    (ici / "montana_calculette_as.json").write_text(json.dumps(stations, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(stations)} stations lues")
    if len(sys.argv) > 2:
        page = pathlib.Path(sys.argv[2])
        texte = page.read_text(encoding="utf-8")
        motif = re.compile(r"(/\* MONTANA_AS:debut \*/\n).*?(\n/\* MONTANA_AS:fin \*/)", re.S)
        if not motif.search(texte):
            sys.exit("repères MONTANA_AS absents de la page")
        texte = motif.sub(lambda m: m.group(1) + en_js(stations) + m.group(2), texte)
        page.write_text(texte, encoding="utf-8")
        print(f"tableau remplacé dans {page}")


if __name__ == "__main__":
    main()
