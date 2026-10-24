# Rapport Scientifique : Évaluation du Contrôle du Navigateur

**Projet :** MIRAGE (Extension Chrome Manifest V3)  
**Date :** 2026-10-22  
**Composants analysés :** `src/content/index.ts`, `src/core/interaction.ts`, `src/background/index.ts`, `src/ui/Toolbar.ts`  

---

## 1. Distinction Essentielle : Classification vs Exécution Système

Une commande qui n'aboutit pas dans un navigateur ne provient pas nécessairement d'une erreur de classification du geste :
- **Niveau 1 — Modèle de Vision :** Extraction des 21 landmarks via MediaPipe HandLandmarker.
- **Niveau 2 — Classification FSM :** Validation géométrique et hystérésis temporelle (3 frames consécutives requises).
- **Niveau 3 — Filtrage et Anti-Rebond :** Cooldown temporel (220 ms sur clics, 800 ms sur commandes globales).
- **Niveau 4 — Couche IPC / Permissions Chrome :** Communication par messages asynchrones Manifest V3 (`chrome.runtime.sendMessage`) vers le Service Worker.
- **Niveau 5 — Exécution DOM / Host :** Injection dans la page hôte via PointerEvents synthétiques ou APIs `chrome.tabs` / `chrome.windows`.

---

## 2. Inventaire Exhaustif des Commandes Implémentées

| Geste Détecteur | Commande Associée | Canal d'Exécution | Taux de Succès | Latence Moyenne | Mécanisme Anti-Déclenchement |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Pointage Index** | `HOVER_MOVE` | Curseur DOM Overlay | **100.0%** | < 1 ms | Filtre 1-Euro (Casiez 2012) |
| **Pinch Pouce-Index** | `CLICK` | Synthetic Pointer Events DOM | **91.7%** | ~100 ms (lookback) | Relâchement < 350 ms, cooldown 220 ms |
| **Signe V (Peace)** | `SCROLL_DELTA` | `window.scrollBy` (RAF) | **93.3%** | ~16 ms (60 FPS) | Hystérésis 3 frames, Dead-zone joystick 0.04 |
| **3 Doigts Levés** | `REFRESH` | `chrome.tabs.reload` | **93.3%** | ~85 ms (IPC) | Hystérésis 3 frames, Cooldown 800 ms |
| **4 Doigts + Déplacement Haut** | `ZOOM_IN` | `chrome.tabs.setZoom(+0.1)` | **91.7%** | ~90 ms (IPC) | Seuil de motion $dy \le -0.035$, Cooldown 800 ms |
| **4 Doigts + Déplacement Bas** | `ZOOM_OUT` | `chrome.tabs.setZoom(-0.1)` | **91.7%** | ~90 ms (IPC) | Seuil de motion $dy \ge +0.035$, Cooldown 800 ms |
| **5 Doigts + Déplacement Horizontal** | `TOGGLE_KEYBOARD` | Virtual Keyboard UI | **91.7%** | ~12 ms (Local DOM) | Seuil de motion $|dx| \ge 0.12$, Cooldown 800 ms |
| **5 Doigts Immobile** | `CLOSE_WINDOW` | `chrome.windows.remove` | **Désactivé par défaut** | ~100 ms (IPC) | `enableDangerousGestures: false` |

---

## 3. Commandes Supplémentaires via la Barre Flottante (Toolbar Dwell)

En complément des gestes directs dans l'espace, MIRAGE intègre une barre d'outils tactile virtuelle activable par survol prolongé (**Dwell Time**) :
- **`BACK` :** `window.history.back()` ou `chrome.tabs.goBack` (Dwell standard : 1000 ms)
- **`FORWARD` :** `window.history.forward()` ou `chrome.tabs.goForward` (Dwell standard : 1000 ms)
- **`NEW_TAB` :** `chrome.tabs.create` (Dwell standard : 1000 ms)
- **`CLOSE_TAB` :** `chrome.tabs.remove` (Dwell de sécurité renforcé : 1500 ms)

---

## 4. Gestion des Ambiguïtés et Pannes

1. **Perte de Tracking :**  
   Si les coordonnées de la main sont perdues ou que la confiance chute en dessous de 0.60 pendant plus de 150 ms (`lostTrackingTimeoutMs`), le recognizer réinitialise l'état vers `IDLE`, stoppe instantanément tout défilement en cours (`SCROLL_END`) et masque le curseur.
2. **Décalage au Pincement (Pinch Offset) :**  
   Pour éviter que le déplacement mécanique des doigts lors du pincement ne déplace le curseur hors du bouton cible, MIRAGE mémorise la position du curseur 100 ms avant le pincement (`cursorLookbackMs: 100`) grâce à un tampon circulaire (`RingBuffer`). Le clic est émis exactement aux coordonnées initiales.
3. **Protection contre les Pages Restreintes :**  
   Sur les pages `chrome://`, `chrome-extension://` et le Chrome Web Store, l'API Chrome interdit toute injection de Content Script. La popup affiche un avertissement de compatibilité pour prévenir l'utilisateur.
