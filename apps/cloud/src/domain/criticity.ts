/**
 * CR-01, CR-02 : score de criticité d'une demande non satisfaite (document 03, §26.2).
 * Poids proposés : gravité 35 %, substituabilité 20 %, rareté 20 %, volume 15 %, vulnérabilité 10 %.
 * Substituabilité et vulnérabilité ne sont pas encore connues en phase B : elles valent 0, et le seuil
 * des niveaux est donc appliqué sur les 70 points disponibles (choix prudent, QUESTIONS Q-23).
 */

export interface CriticityInput {
  /** Criticité de la fiche du référentiel : 1 vital, 2 important, 3 courant. */
  productCriticity: 1 | 2 | 3;
  /** Officines de la région ayant le produit en stock disponible (fraîcheur « disponible »). */
  pharmaciesWithStock: number;
  /** Demandes distinctes dans le district sur 24 h. */
  distinctRequests24h: number;
}

export interface Criticity {
  score: number;
  level: 1 | 2 | 3;
}

export function criticity(i: CriticityInput): Criticity {
  const gravity = i.productCriticity === 1 ? 1 : i.productCriticity === 2 ? 0.5 : 0;
  const rarity = i.pharmaciesWithStock === 0 ? 1 : i.pharmaciesWithStock <= 2 ? 0.5 : 0;
  const volume = Math.min(1, i.distinctRequests24h / 5);
  const score = Math.round(35 * gravity + 20 * rarity + 15 * volume);
  // Gravité vitale : toujours niveau 1 (sans attendre le volume).
  const level: 1 | 2 | 3 = i.productCriticity === 1 || score >= 50 ? 1 : score >= 25 ? 2 : 3;
  return { score, level };
}

/** CR-02 : délai d'envoi de l'alerte selon le niveau. */
export function dispatchDelayMs(level: 1 | 2 | 3): number {
  return level === 1 ? 0 : level === 2 ? 3_600_000 : 86_400_000;
}
