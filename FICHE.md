---
id: 2026-11-17-gestion-eaux-pluviales   # AAAA-MM-JJ-slug, écrit une fois, jamais modifié (même si le dossier bouge)
nom: Gestion des eaux pluviales          # nom affiché
type: outil                              # application | outil | documentation | travail | affaire
statut: actif                            # idee | actif | pause | termine | abandonne
pitch: Rétention, infiltration et débit de pointe : méthode des pluies, Montana, Caquot avec sous-bassins assemblés.  # une phrase sur une seule ligne, 120 caractères maximum
cree: 2026-11-17                         # AAAA-MM-JJ
maj: 2026-11-17                          # AAAA-MM-JJ, mis à jour par Claude Code en fin de session
tags: [vrd, assainissement, eaux-pluviales, calcul]
entree: index.html
usage: ouvrir index.html dans un navigateur, ou le site en ligne une fois publié
site:
depot:
perime_si: nouveaux coefficients de Montana de Météo-France, années 6 minutes publiées après 2024, remplacement du guide CERTU 2003, révision du fascicule 70-II ou de la rubrique 2.1.5.0
---

# Gestion des eaux pluviales

## Objectif
Remplacer la calculette Excel d'Antonin Sommant (`Dimensionnement Pluviales Type.xlsm`), jugée lourde, par un outil web du hub B27, rubrique VRD et assainissement. L'outil calcule le volume de rétention ou d'infiltration par la méthode des pluies (guide CERTU 2003, § 8.2.3.1 ; IT 77, § 7.2) et le débit de pointe par la formule superficielle de Caquot (IT 77, § 2.1), avec les coefficients de Montana par station. Il signale le régime de la rubrique 2.1.5.0 de la loi sur l'eau (R.214-1) et renvoie aux prescriptions locales (L.2224-10, L.1331-1), au fascicule 70-II et à la NF EN 752. Le plan complet est dans `C:\Users\mamalric\.claude\plans\bon-aujourdhui-cette-calculette-serene-storm.md`.

## État actuel
Version 1, phases 0 à 6 du plan : une seule page `index.html` sur le modèle du Dimensionnement des chaussées. Onglets Projet et pluie, Bassin versant, Stockage, Ouvrage (bassin à ciel ouvert, structure alvéolaire ou tubes, fascicule 70-II), Débit de pointe, avec un résumé toujours visible ; en parcours Réseau, plusieurs sous-bassins, un onglet Assemblage (série ou parallèle, IT 77, § 2.1.7, et guide CERTU, tableau 42), débit à l'exutoire, stockage sur l'ensemble, et un onglet Collecteurs (Manning-Strickler, NF EN 16933-2, K = 70 par défaut, validé par Marius, DN minimal 300). Coefficients de Montana : 23 stations calculées par B27 sur les pluies 6 minutes publiques de Météo-France (2005 à 2024, 18 à 19,5 années d'observation), signalées "Calcul B27" avec les périodes de retour de 10 ans et plus marquées extrapolées ; les 22 stations de la calculette, signalées "origine non vérifiée" ; ou saisie depuis une fiche. Méthode des pluies en durée continue (forme fermée), trois modes de restitution comparés (rejet, infiltration, les deux), débit de pointe de Caquot à 10 et 100 ans avec la correction d'allongement du guide CERTU (éq. 20) ou celle de la calculette. Note de calcul imprimable, synthèse à copier, projet enregistré en .json et gardé dans le navigateur. `verifier-moteur.js` : 182 contrôles, dont la calculette Excel corrigée retrouvée à 1e-9 près, 13 assemblages de son onglet Caquot, sa table de débitance, la géométrie des ouvrages, les coefficients de l'IT 77, § 2.1.2, et les stations calculées. Note de calcul avec sommaire, hypothèses, points à vérifier et indice ; synthèse copiable organisée de même. `donnees/montana_6min.py` (méthode du renouvellement du guide CERTU) retrouve la fiche Météo-France de Chouilly 2005-2021 à -9 % à +2 % sur les volumes et -8 % sur Caquot ; il s'écarte jusqu'à 18 % des fiches plus anciennes de Rouen-Boos et Melun, et jusqu'à 35 % de l'Excel en 100 ans. Manquent : dépôt, publication et carte du hub (phases 7 et 8). Coefficients d'apport par revêtement et correction d'allongement de la calculette : sans source.

## Prochaine étape
Phase 7 (dépôt, publication et carte du hub, avec l'accord de Marius), puis recette par Antonin sur une affaire déjà calculée à l'Excel. En option : étendre les stations calculées à d'autres départements, et choisir si la station par défaut devient Paris-Montsouris calculée.

## Utilisation
Hors ligne : ouvrir `index.html` dans un navigateur, rien d'autre n'est nécessaire. Saisir la station et la période de retour, les surfaces par revêtement, le débit de fuite ou la perméabilité ; le volume, la vidange et le débit de pointe se mettent à jour à chaque saisie. Contrôle du moteur : `node verifier-moteur.js`. Stations de Montana : `python -I donnees/extraire_montana_xlsm.py "Dimensionnement Pluviales Type (corrigé).xlsm" index.html` réécrit le tableau de la page depuis la calculette. Montana sur données publiques : `python -I donnees/montana_6min.py <poste> <AAAA-MM début> <AAAA-MM fin> MN_<dép>_*.csv.gz [--json sortie.json]` pour une station, `python -I donnees/montana_6min.py --lot <dossier des fichiers> 2024-12 index.html` pour recalculer les stations de l'outil (une dizaine de minutes), avec les fichiers du jeu 6 minutes de data.gouv.fr téléchargés à part (1,6 Go pour les 23 départements, hors du projet). Les `.xlsm` restent hors du dépôt git (`.gitignore`).
