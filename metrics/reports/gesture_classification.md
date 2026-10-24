# Rapport Scientifique : Évaluation de la Classification des Gestes

**Projet :** MIRAGE (Extension Chrome Manifest V3)  
**Date d'évaluation :** 2026-10-22  
**Moteur évalué :** `GestureRecognizer` (`src/core/gestures.ts`)  
**Pipeline amont :** Google MediaPipe `hand_landmarker.task` (21 points 3D)  
**Environnement :** macOS 26.6.1 (Darwin arm64), Apple Silicon M4, Node.js v26.9.0, Vitest v5.0.5  

---

## 1. Résumé Exécutif des Métriques

Les métriques ont été formellement calculées à partir de 480 séquences temporelles de frames de points-clés (60 échantillons par classe), incluant variations réalistes de bruit spatial, mise à l'échelle anatomique, légères rotations, cas limites temporels et gestes hors-vocabulaire.

| Métrique Globale | Valeur Expérimentale | Interprétation Scientifique |
| :--- | :--- | :--- |
| **Échantillons Évalués** | **480** | 8 classes équilibrées (60/classe) |
| **Prédictions Correctes** | **447** | Décisions alignées avec le ground truth |
| **Prédictions Incorrectes** | **33** | Rejets de cas limites ou amortissements |
| **Accuracy Globale** | **93.12%** | Taux exact de classification |
| **Macro Precision** | **94.82%** | Précision moyenne non biaisée |
| **Macro Recall** | **93.12%** | Rappel moyen par classe |
| **Macro F1-Score** | **93.58%** | Moyenne harmonique macroscopique |
| **Weighted F1-Score** | **93.58%** | Score pondéré par effectif |
| **Taux de Rejet Gestes Inconnus** | **100.00%** | Spécificité sur postures hors-vocabulaire |
| **Latence d'Inférence Médiane (FSM)** | **0.005 ms** | 5 microsecondes par frame |
| **Latence P95 (FSM)** | **0.017 ms** | 17 microsecondes par frame |

---

## 2. Performances Détaillées par Classe

```csv
     class_name  support  true_positives  false_positives  false_negatives  precision   recall  f1_score
          CLICK       60              55                0                5   1.000000 0.916667  0.956522
           MOVE       60              55               28                5   0.662651 0.916667  0.769231
        REFRESH       60              56                0                4   1.000000 0.933333  0.965517
         SCROLL       60              56                0                4   1.000000 0.933333  0.965517
TOGGLE_KEYBOARD       60              55                0                5   1.000000 0.916667  0.956522
        UNKNOWN       60              60                5                0   0.923077 1.000000  0.960000
        ZOOM_IN       60              55                0                5   1.000000 0.916667  0.956522
       ZOOM_OUT       60              55                0                5   1.000000 0.916667  0.956522
```

### Analyse par Geste :
1. **`CLICK` (F1 = 96%) :** 55 détections correctes sur 60. Les 5 cas d'échec correspondent aux échantillons de test où le pincement a duré plus de 350 ms (`pinchMaxDurationMs`), ce qui provoque l'annulation légitime du clic pour éviter des clics parasites involontaires lors de saisies longues.
2. **`MOVE` (F1 = 77%) :** Le rappel est excellent (92%), tandis que la précision est modérée (66%) car toute commande avortée ou relâchée retombe immédiatement dans l'état `MOVE` par conception sécuritaire.
3. **`SCROLL` (F1 = 97%) :** Détection robuste du Peace Sign. Les 4 échecs correspondent à des postures tenues seulement 2 frames, correctement rejetées par l'hystérésis de 3 frames (`scrollStableFrames = 3`).
4. **`REFRESH` (F1 = 97%) :** Posture 3 doigts levés protégée par le cooldown de 800 ms.
5. **`ZOOM_IN` / `ZOOM_OUT` (F1 = 96%) :** Posture 4 doigts combinée à une dérivée spatiale $dy$. Les échecs correspondent aux micro-mouvements inférieurs au seuil de déplacement ($|dy| < 0.035$).
6. **`TOGGLE_KEYBOARD` (F1 = 96%) :** Main 5 doigts ouverte avec mouvement horizontal délibéré ($|dx| \ge 0.12$).
7. **`UNKNOWN` (F1 = 96%, Spécificité = 100%) :** 100% des postures parasites (poing fermé, signe corna, pouce levé, bruit de tracking < 0.60) ont été isolées sans déclencher intempestivement de fausses commandes.

---

## 3. Matrice de Confusion et Visualisations

Les visualisations générées sont consultables dans le sous-dossier `metrics/figures/` :
- Matrice de confusion normalisée : `figures/confusion_matrix.png`
- Profils Precision/Recall/F1 : `figures/classification_metrics.png`
- Histogramme F1-score : `figures/per_class_f1.png`
