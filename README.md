# Kairo — habitudes, notes et IA locale

App Android (et Mac) : habit tracker + notes + assistant IA qui tourne chez toi.
L'IA lit tes notes et tes stats, regarde ce que tu lui montres à la caméra,
remet tes notes en forme et peut chercher sur le web.

## Ce qu'il te faut (une seule fois)

| Outil | Pour quoi | Où |
|---|---|---|
| **Node.js** (version LTS) | construire l'app | nodejs.org |
| **Ollama** | faire tourner l'IA sur ton Mac | ollama.com/download |
| **Android Studio** | installer l'app sur ton téléphone | developer.android.com/studio |

## 1. Lancer l'IA sur ton Mac

Installe Ollama, puis dans le Terminal :

```bash
ollama pull gemma4:e4b      # ~10 Go : texte + images (conseillé)
# ou, plus léger :  ollama pull gemma4:e2b
```

Pour que **le téléphone** puisse parler à l'IA du Mac (même Wi-Fi) :

```bash
launchctl setenv OLLAMA_HOST "0.0.0.0"
launchctl setenv OLLAMA_ORIGINS "*"
```

Puis **quitte et relance l'app Ollama** (icône lama dans la barre de menu).
Adresse IP du Mac : `ipconfig getifaddr en0` (ex. `192.168.1.20`).
Si macOS demande d'autoriser les connexions entrantes pour Ollama : accepte.

## 2. Lancer l'app sur le Mac (version ordinateur v1)

Dans le dossier du projet :

```bash
npm install
npm run dev
```

Ouvre **http://localhost:5173** dans Chrome. Dans les Réglages de l'app, l'adresse
`http://localhost:11434` est déjà la bonne. Touche « Tester la connexion ».

## 3. Installer l'app sur ton téléphone Android

### Le plus simple : télécharger l'APK

À chaque mise à jour du code, GitHub fabrique l'app automatiquement (onglet *Actions*).

1. Sur ton téléphone, ouvre **https://github.com/SAD3S/Kairo/releases/latest**
2. Touche **Kairo.apk** pour le télécharger, puis ouvre-le.
3. Android demande d'autoriser l'installation depuis ton navigateur : accepte.

Pour mettre à jour : même chose, la nouvelle version s'installe par-dessus (tes données sont gardées).

### Avec Android Studio (pour développer)

1. Sur le téléphone : Paramètres → À propos → touche 7 fois « Numéro de build »,
   puis Options pour les développeurs → active **Débogage USB**.
2. Branche le téléphone au Mac en USB et accepte l'autorisation.
3. Dans le dossier du projet :

   ```bash
   npm run android
   ```

   Android Studio s'ouvre (la 1ʳᵉ fois, il télécharge des composants : patiente).
4. Choisis ton téléphone en haut, puis clique sur ▶ **Run**. L'app Kairo s'installe.

Ensuite, dans l'app → Réglages → Adresse d'Ollama : `http://IP-DU-MAC:11434`
(ex. `http://192.168.1.20:11434`) → « Tester la connexion ».

> Pour un fichier APK à partager : Android Studio → Build → Build App Bundle(s)/APK(s) → Build APK(s).

Après chaque modification du code : relance `npm run android`.

## 4. Accès Internet de l'IA

Rien à configurer : l'IA cherche avec **DuckDuckGo** (gratuit, sans compte ni clé)
et lit les pages directement. Seule la requête de recherche sort de ton appareil.
Le bouton **WEB ON/OFF** en haut du chat coupe l'accès à tout moment.

(Avancé : si ton offre Ollama inclut la recherche web, tu peux mettre ta clé dans
Réglages → Internet → Avancé ; DuckDuckGo reste le repli.)

## 5. IA directement sur le téléphone (Android)

Sans Mac, hors ligne : Réglages → « Sur le téléphone » → **Télécharger le modèle**
(Gemma 4 E2B, ~2,6 Go, une seule fois). En 4G/5G, garde l'app ouverte : si ça coupe,
le téléchargement reprend où il s'était arrêté. En Wi-Fi, il continue même app fermée.
Puis « Charger maintenant » (10–20 s la première fois).

## Itinéraire (onglet carte)

Calcul d'itinéraire en voiture avec **visualisation de Dijkstra ou A\*** puis guidage GPS vocal.
100 % gratuit, sans clé : carte OpenFreeMap (MapLibre), adresses Photon, routes Overpass (OpenStreetMap).

- Tape le départ et l'arrivée (suggestions pendant la frappe), ou « Ma position », ou appui long sur la carte.
- Choisis l'algorithme et la durée de l'animation, puis « Calculer l'itinéraire » (« Passer l'animation » pour aller au résultat).
- « Démarrer » : la carte suit ta position, annonces vocales à 500 / 200 / 50 m, recalcul automatique si tu sors de la route.
- Jusqu'à 50 km à vol d'oiseau : toutes les rues autour du départ et de l'arrivée, grands axes entre les deux.
- Nécessite Internet (carte, adresses, routes). Garde l'écran allumé pendant le guidage (l'app le fait pour toi).

## Les états de l’IA (loaders)

| État | Quand |
|---|---|
| En attente | rien en cours |
| J'écoute… | dictée vocale |
| Lit tes données | lecture des notes et habitudes |
| Réfléchit… | avant la réponse |
| Cherche sur le web | recherche / lecture de pages |
| Regarde l'image | photo caméra ou image jointe |
| Remet en forme | remise en forme d'une note |
| Écrit… | la réponse arrive |

## Données

Tout est stocké **sur l'appareil** (le Mac et le téléphone ont chacun leurs données).
Réglages → Données → Exporter / Restaurer pour sauvegarder ou transférer.

## Problèmes fréquents

- **« Impossible de joindre Ollama »** : Ollama est-il lancé ? Même Wi-Fi ? Bonne IP ?
  As-tu fait l'étape `launchctl` puis relancé Ollama ?
- **« Le modèle n'est pas installé »** : `ollama pull gemma4:e4b`, ou choisis un modèle
  dans la liste après « Tester la connexion ».
- **Caméra noire** : autorise la caméra pour Kairo dans les paramètres Android.
- **Dictée indisponible** : installe/active « Services vocaux de Google » sur le téléphone.

## Pour les curieux (code)

- `src/lib/ai/` : moteur IA (Ollama, sur l'appareil, recherche web, contexte, statuts)
- `src/screens/` : écrans · `src/components/Loader.tsx` : les 8 loaders
- `npm test` : tests · `npm run build` : build web
- Stack : React + TypeScript + Vite, Capacitor 8 pour Android.
