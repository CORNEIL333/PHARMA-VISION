/** Concatène des classes (sans dépendance supplémentaire). */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
