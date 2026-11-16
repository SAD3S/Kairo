// Tous les textes de la carte, en français (équivalent de strings.xml).
export const T = {
  title: 'Carte',
  search: 'Rechercher un lieu',
  searching: 'Recherche…',
  noResult: 'Aucun lieu trouvé.',
  photonError: 'Recherche indisponible. Vérifie ta connexion.',
  myPosition: 'Ma position',
  recenter: 'Recentrer',
  follow: 'Suivre ma position',
  clearPlace: 'Effacer le lieu',
  offlineTag: 'HORS LIGNE',
  packHint: 'Télécharger l’Île-de-France pour la carte sans réseau',
  // GPS
  gpsDenied: 'Kairo n’a pas accès à ta position. Autorise la localisation dans les réglages du téléphone (Applications → Kairo → Autorisations).',
  gpsUnavailable: 'Position introuvable. Active la localisation et réessaie.',
  gpsWaiting: 'Recherche du signal GPS…',
  accuracy: (m: number) => `précision ± ${m} m`,
};
