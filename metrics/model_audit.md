# Audit Scientifique et Technique des Modèles — Projet MIRAGE

**Auteur / Évaluateur :** Audit Scientifique Deep Learning & Computer Vision  
**Projet :** MIRAGE (AirBrowse — Chrome Extension Manifest V3)  
**Date de l'Audit :** 22 Octobre 2026  
**Environnement de Test :** macOS 26.6.1 (Darwin arm64), Apple Silicon M4, Chromium MV3  

---

## 1. Synthèse de l'Audit : Vérité Terrain sur les Modèles

Conformément à la consigne académique stricte (*"Il est interdit de présenter un modèle simplement téléchargé ou préentraîné comme un modèle que j'ai personnellement entraîné"*), voici la réalité exhaustive de l'architecture logicielle de MIRAGE après inspection intégrale du code source et des fichiers binaires :

```
                          RÉALITÉ DU CODE MIRAGE
  
  +-------------------------------------------------------------------------+
  | 1. Modèle Convolutif Personnellement Entraîné (CNN)                     |
  |    -> STATUT : ABSENT (Le dossier public/models/cnn/ est 100% VIDE).    |
  |    -> Aucune matrice de poids (.bin, .h5, .pt, .onnx) entraînée maison. |
  +-------------------------------------------------------------------------+
                                     |
  +-------------------------------------------------------------------------+
  | 2. Modèle de Vision Utilisé : MediaPipe HandLandmarker                  |
  |    -> STATUT : PRÉENTRAÎNÉ PAR GOOGLE RESEARCH (BlazePalm + BlazeHand).  |
  |    -> Fichier : public/models/hand_landmarker.task (7.8 Mo).            |
  |    -> Exécution : WASM SIMD + GPU Delegate dans le Content Script.      |
  +-------------------------------------------------------------------------+
                                     |
  +-------------------------------------------------------------------------+
  | 3. Moteur de Décision et Reconnaissance des Gestes                      |
  |    -> STATUT : MACHINE À ÉTATS FINIS DÉTERMINISTE (FSM HEURISTIQUE).    |
  |    -> Fichier : src/core/gestures.ts (669 lignes de TypeScript pur).    |
  |    -> Mécanisme : Règles géométriques (angles, distances, ratios 3D),   |
  |       filtrage temporel 1-Euro, tampon circulaire et hystérésis 3 frames.|
  +-------------------------------------------------------------------------+
                                     |
  +-------------------------------------------------------------------------+
  | 4. Intelligence Artificielle Externe (LLM)                              |
  |    -> STATUT : GOOGLE GEMINI API (gemini-flash-latest).                 |
  |    -> Fichier : src/background/gemini.ts (137 lignes).                  |
  |    -> Rôle : Uniquement résumé textuel de la page Web. ZÉRO rôle vision.|
  +-------------------------------------------------------------------------+
```

---

## 2. Audit Détaillé des Composants

### 2.1. Analyse du dossier `public/models/`
- **`public/models/cnn/` :** Dossier présent dans l'arborescence git mais **strictement vide** (0 octet, aucun fichier). Aucun réseau de neurones convolutif n'y a été déposé ni entraîné.
- **`public/models/hand_landmarker.task` (7.8 Mo) :** Bundle officiel MediaPipe distribué par Google (`@mediapipe/tasks-vision: 1.1.1`). Il encapsule :
  1. *BlazePalm Detector* : CNN single-shot detector repérant la paume dans le flux vidéo.
  2. *BlazeHand Landmark Model* : CNN prédisant les 21 coordonnées cartésiennes 3D ($x, y, z$) des articulations de la main.
- **`public/models/face_landmarker.task` (3.8 Mo) :** Présent physiquement sur disque mais **inutilisé**. Une recherche textuelle dans tout le dossier `src/` confirme qu'aucune fonction ne charge ni n'appelle ce fichier.
- **`public/models/wasm/` :** Contient les moteurs d'exécution WebAssembly (`vision_wasm_internal.wasm`, `vision_wasm_module_internal.wasm`).

### 2.2. TensorFlow.js et TFLite
- Aucune dépendance `@tensorflow/tfjs` n'est déclarée dans `package.json`.
- Aucun fichier de topologie `model.json` ni shard binaire `.bin` n'est présent.
- Le runtime WASM interne de MediaPipe utilise une version allégée du runtime C++ de TFLite compilée en WebAssembly pour exécuter `hand_landmarker.task`.

### 2.3. Moteur de Classification des Gestes (`src/core/gestures.ts`)
Contrairement à une idée reçue, **MIRAGE n'utilise pas non plus le `GestureRecognizer` pré-packagé de MediaPipe**.
Le projet implémente son propre moteur de classification analytique en TypeScript pur, basé sur la biomécanique de la main :
1. **Échelle anatomique de référence :** $s = \\text{dist}(\\text{Wrist}_0, \\text{MiddleMCP}_9)$ calculée à chaque frame pour garantir l'invariance à la distance caméra.
2. **Pointage (`MOVE`) :** Index étendu ($\text{dist}(\text{Tip}, \text{Wrist}) > 1.15 \\times \text{dist}(\text{PIP}, \text{Wrist})$), autres doigts repliés. Le curseur est lissé par un filtre 1-Euro (`Point2DFilter`) et mappé sur les 60% centraux de l'image.
3. **Pincement (`CLICK`) :** Ratio $\\frac{\\text{dist}(\\text{ThumbTip}_4, \\text{IndexTip}_8)}{s} < 0.25$. Requiert 3 frames stables pour armer `PINCH_PENDING`, et un relâchement en moins de 350 ms pour déclencher le clic aux coordonnées mémorisées 100 ms avant (`RingBuffer` lookback).
4. **Défilement (`SCROLL`) :** Signe Peace (Index et majeur étendus, annulaire et auriculaire repliés). Agit comme un joystick proportionnel centré sur le point neutre initial de la paume ($Y$).
5. **Commandes Spécifiques :**
   - 3 doigts stables $\\ge 3$ frames $\\rightarrow$ `REFRESH`
   - 4 doigts + vitesse verticale $|dy| \\ge 0.035$ $\\rightarrow$ `ZOOM_IN` / `ZOOM_OUT`
   - 5 doigts ouverts + vitesse horizontale $|dx| \\ge 0.12$ $\\rightarrow$ `TOGGLE_KEYBOARD`
   - 5 doigts stables immobiles $\\rightarrow$ `CLOSE_WINDOW` (désactivé par défaut par sécurité).

### 2.4. Rôle de Google Gemini (`src/background/gemini.ts`)
L'API REST Gemini (`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`) est exclusivement sollicitée via le background service worker pour résumer en 3 à 5 points le texte de l'article extrait du DOM (`extractMainText()`). Elle ne reçoit **aucune image webcam**, **aucun landmark** et **n'intervient en rien dans le contrôle gestuel**.

---

## 3. Positionnement Académique Transparent

Pour la soutenance devant le professeur, la formulation scientifique exacte doit être la suivante :

> *"Le projet MIRAGE s'articule autour d'une architecture hybride :*
> *1. La détection spatiale et l'extraction des 21 points-clés anatomiques 3D sont déléguées au modèle préentraîné sur étagère **MediaPipe HandLandmarker** de Google Research, exécuté localement en WebAssembly.*
> *2. La reconnaissance sémantique des gestes et le contrôle décisionnel du navigateur reposent sur une **Machine à États Finis (FSM) spatiotemporelle propriétaire**, développée sur mesure en TypeScript, intégrant des règles géométriques rotation-invariantes, un filtrage 1-Euro et une hystérésis temporelle.*
> *3. Aucun modèle CNN ou Deep Learning n'a été entraîné personnellement par l'étudiant dans l'état actuel du projet."*

---

## 4. Protocole Proposé pour Entraîner un Classificateur Personnel

Si le professeur exige impérativement un entraînement personnel de modèle de Deep Learning pour valider l'UE, voici la méthodologie académique recommandée :

### Étape A : Choix de la Tâche d'Apprentissage
Plutôt que de réentraîner un détecteur de main lourd à partir de zéro (ce qui requiert des centaines de milliers d'images et des semaines de calcul GPU), la méthode standard et élégante consiste à entraîner un **Classificateur de Gestes Neuronal (MLP ou CNN 1D)** prenant en entrée les **21 points-clés 3D normalisés** ($21 \\times 3 = 63$ features).

### Étape B : Constitution du Dataset
1. **Dataset Public de Référence :** Utiliser un sous-ensemble du dataset public **HaGRID** (HAnd Gesture Recognition Image Dataset, 550 000 images) ou collecter 200 à 500 échantillons par geste via la webcam de l'extension.
2. **Extraction des Features :** Faire passer les images dans le `HandLandmarker` pour obtenir les vecteurs $(x, y, z)$ centrés sur le poignet et normalisés par la taille de la main.
3. **Partitionnement Strict :**
   - 70% Entraînement (Train)
   - 15% Validation (Early Stopping, réglage des hyperparamètres)
   - 15% Test Indépendant (Évaluation finale sans fuite de données)

### Étape C : Architecture du Modèle Proposé
```python
import tensorflow as tf
from tensorflow.keras import layers, models

def build_gesture_classifier(num_classes=8):
    model = models.Sequential([
        layers.Input(shape=(63,)),
        layers.Dense(128, activation='relu'),
        layers.BatchNormalization(),
        layers.Dropout(0.3),
        layers.Dense(64, activation='relu'),
        layers.Dropout(0.2),
        layers.Dense(32, activation='relu'),
        layers.Dense(num_classes, activation='softmax')
    ])
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy']
    )
    return model
```

### Étape D : Export et Intégration dans Mirage
1. Convertir le modèle entraîné au format **TensorFlow.js** via `tensorflowjs_converter --input_format=tf_saved_model`.
2. Déposer les fichiers `model.json` et `group1-shard1of1.bin` dans le dossier dédié `public/models/cnn/`.
3. Charger le modèle dans un module `src/core/cnn_classifier.ts` via `@tensorflow/tfjs` sans altérer la FSM existante, qui peut servir d'arbitre ou de mécanisme de repli (fallback).
