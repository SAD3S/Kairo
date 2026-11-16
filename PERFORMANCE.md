# Performances de Kairo

## Comment mesurer

**Sur le téléphone (valeurs de référence)** : Réglages → **Performances**. L'app note la dernière valeur de
chaque mesure pendant l'utilisation ; « Copier les mesures » les met dans le presse-papiers.

**Démarrage à froid / à chaud (depuis un ordinateur, téléphone branché en USB)** :

```bash
adb shell am force-stop app.kairo.mobile
adb shell am start -W -n app.kairo.mobile/.MainActivity   # à froid : lire TotalTime
adb shell input keyevent KEYCODE_HOME
adb shell am start -W -n app.kairo.mobile/.MainActivity   # à chaud
```

## Partie 0 — état de départ (v1.0.13)

### Mesuré sur le téléphone (relevé du 16/11/2026, v1.0.13)

| Mesure | Avant | Après |
|---|---|---|
| Démarrage à froid / à chaud (`am start -W`) | non relevé (nécessite adb) | |
| Démarrage : premier écran affiché | 1 041 ms | |
| Carte utilisable (carte hors ligne) | 1 318 ms | |
| Routes : chargement du pack hors ligne (461 571 nœuds) | **17 246 ms** | |
| Routes ~5 km en ville via Overpass (téléchargement + graphe) | non relevé (pack utilisé) | |
| IA : premier mot affiché (IA sur le téléphone) | 2 943 ms | |
| IA : réponse complète (437 caractères) | 12 804 ms | |

Point noir : le chargement du pack (17 s). Sur ordinateur le décodage prend 0,3 s : le temps part dans
la lecture du fichier par blocs de 4 Mo convertis en base64 à travers le pont natif. À traiter en priorité en partie 7.

### Mesuré hors téléphone (ordinateur de build, Chrome sans interface)

Ces chiffres ne valent pas pour un téléphone ; ils servent seulement de point de comparaison relatif.

| Mesure | Avant | Après |
|---|---|---|
| Premier écran affiché, page servie en local (5 essais) | 122–132 ms | |
| JavaScript total livré | 2,69 Mo | |
| Dont chargé au démarrage (`index-*.js`) | 916 Ko (287 Ko compressé) | |
| Écran Itinéraire + MapLibre (chargé à la demande) | ~1,1 Mo | |
| Pack Île-de-France : décodage du graphe (461 571 nœuds) | 298 ms | |
| Itinéraire A* Montparnasse → Gare du Nord (6,1 km), pack | 51 ms | |
| Itinéraire A* Roissy → Fontainebleau (86 km), pack | 144 ms | |
| Recherche d'adresse hors ligne (137 000 entrées) | 7–19 ms | |

## Optimisations abandonnées

(à compléter en partie 7)
