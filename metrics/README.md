# MIRAGE — Dossier d'Évaluation Scientifique et Métriques Expérimentales

Ce dossier rassemble l'ensemble des données d'évaluation, rapports scientifiques, visualisations graphiques et scripts de reproduction relatifs aux performances du système de reconnaissance gestuelle et de contrôle de navigateur du projet **MIRAGE** (AirBrowse).

---

## 1. Organisation du Dossier `metrics/`

```
metrics/
├── README.md                       # Présentation globale et guide de reproduction
├── model_audit.md                  # Audit technique et scientifique approfondi des modèles
├── evaluation_summary.csv          # Synthèse globale des métriques (Accuracy, F1, Latences)
├── environment.txt                 # Spécifications de la machine hôte et des bibliothèques
├── reports/                        # Rapports d'analyse scientifique détaillés
│   ├── gesture_classification.md   # Évaluation complète de la classification des gestes
│   ├── browser_commands.md         # Évaluation du contrôle navigateur et des commandes
│   └── performance.md              # Analyse des latences, des FPS et de l'empreinte mémoire
├── data/                           # Données brutes et calculées
│   ├── evaluation_predictions.csv  # 480 prédictions réelles horodatées issues de la FSM
│   ├── per_class_metrics.csv       # Métriques par classe (Precision, Recall, F1, TP, FP, FN)
│   └── confusion_matrix.csv        # Matrice de confusion inter-classes (format CSV)
├── figures/                        # Graphiques scientifiques haute résolution (300 DPI)
│   ├── confusion_matrix.png        # Heatmap normalisée avec effectifs et pourcentages
│   ├── classification_metrics.png  # Histogramme groupé Precision / Recall / F1 par classe
│   ├── per_class_f1.png            # Classement horizontal des F1-scores
│   ├── command_success_rate.png    # Taux d'exécution effectif des commandes navigateur
│   ├── inference_latency.png       # Distribution statistique de la latence d'inférence
│   └── fps_measurements.png        # Cadence de traitement selon les composants du pipeline
└── scripts/                        # Scripts d'évaluation et de génération autonome
    ├── evaluate_model.py           # Calcul des métriques formelles via Scikit-Learn
    └── generate_reports.py         # Génération des figures Matplotlib/Seaborn et des rapports
```

---

## 2. Synthèse des Résultats Expérimentaux

Les métriques ont été mesurées sur un échantillon formel de **480 essais réels** couvrant l'ensemble des 8 classes du système (60 échantillons par classe avec variations spatiales, bruit de capteur et cas limites) :

| Métrique | Valeur Mesurée |
| :--- | :--- |
| **Nombre d'échantillons évalués** | **480** |
| **Prédictions correctes** | **447** |
| **Prédictions incorrectes** | **33** |
| **Accuracy globale** | **93.12%** |
| **Macro Precision** | **94.82%** |
| **Macro Recall** | **93.12%** |
| **Macro F1-Score** | **93.58%** |
| **Spécificité sur gestes inconnus (`UNKNOWN`)** | **100.00%** |
| **Latence médiane d'inférence FSM** | **0.005 ms (5 µs)** |
| **Latence P95 d'inférence FSM** | **0.017 ms (17 µs)** |

---

## 3. Reproduction Complète des Résultats

Pour recalculer l'intégralité des métriques et régénérer tous les graphiques et rapports de zéro :

### Étape 1 : Exécuter la suite de tests et le banc de prédictions (TypeScript)
```bash
# Exécute le banc d'évaluation sur le vrai GestureRecognizer de Mirage
./node_modules/.bin/vitest run tests/benchmark_evaluation.test.ts
```
*Cette commande génère le fichier `metrics/data/evaluation_predictions.csv` avec les 480 prédictions réelles.*

### Étape 2 : Activer l'environnement Python et calculer les métriques
```bash
# Active le virtualenv dédié
source metrics/.venv/bin/activate

# Calcule les métriques Scikit-Learn et génère les CSV d'évaluation
python metrics/scripts/evaluate_model.py
```

### Étape 3 : Générer les figures haute résolution et les rapports Markdown
```bash
# Génère les 6 figures PNG dans metrics/figures/ et met à jour metrics/reports/
python metrics/scripts/generate_reports.py
```
