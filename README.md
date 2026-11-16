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

1. Crée un compte gratuit sur **ollama.com**, puis Settings → **Keys** → crée une clé.
2. Dans l'app : Réglages → Internet → colle la clé → « Tester la recherche ».

L'IA décide seule quand chercher (ou quand tu lui demandes). Seule la requête de
recherche passe par Ollama ; tes notes et habitudes restent sur ton appareil.
Le bouton **WEB ON/OFF** en haut du chat coupe l'accès à tout moment.

## 5. (Expérimental) IA directement sur le téléphone

Sans Mac, hors ligne : Réglages → « Sur le téléphone ».
Il faut un téléphone récent (WebGPU, 8 Go de RAM conseillés) et un modèle
**Gemma 3n E2B « -Web »** au format `.litertlm` (~3 Go), à télécharger depuis
Hugging Face (repo `google/gemma-3n-E2B-it-litert-lm`, accepte la licence Gemma),
à copier sur le téléphone puis à importer dans l'app. Plus lent et moins fort
qu'Ollama sur le Mac.

## Les états de l'IA (loaders)

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
