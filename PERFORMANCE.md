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

### Mesuré sur le téléphone — À REMPLIR

Ces valeurs ne peuvent être prises que sur l'appareil ; elles n'ont pas encore été relevées.

| Mesure | Avant | Après |
|---|---|---|
| Démarrage à froid (`am start -W`, TotalTime) | à relever | |
| Démarrage à chaud (`am start -W`) | à relever | |
| Démarrage : premier écran affiché (Réglages → Performances) | à relever | |
| Carte utilisable | à relever | |
| Routes ~5 km en ville : téléchargement Overpass | à relever | |
| Routes ~5 km en ville : construction du graphe | à relever | |
| IA : premier mot affiché | à relever | |

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
