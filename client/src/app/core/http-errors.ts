import { HttpErrorResponse } from '@angular/common/http';

/** Message lisible pour une erreur, en particulier quand l'API Node est arrêtée. */
export function describeError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    // Le proxy de développement renvoie 500 (ou 502/504) quand l'API ne répond plus ; status 0 = réseau coupé.
    if (err.status === 0 || err.status >= 500) {
      return `le serveur ne répond pas (erreur ${err.status || 'réseau'}). Vérifiez que l’API Node tourne (npm run dev ou npm start).`;
    }
    if (typeof err.error?.error === 'string') return err.error.error;
  }
  return err instanceof Error ? err.message : String(err);
}
