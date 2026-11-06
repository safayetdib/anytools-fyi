// The visitor's choice about analytics cookies, kept in their browser only.

export type Consent = "granted" | "denied";

export const CONSENT_KEY = "anytools-consent";
export const PRODUCTION_HOST = "anytools.fyi";
export const MEASUREMENT_ID = "G-5KMBSHH44P";

type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/** The saved choice, or null when there is none yet. Blocked storage counts as no choice. */
export function readConsent(storage: Pick<Store, "getItem">): Consent | null {
  try {
    const value = storage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

export function saveConsent(storage: Pick<Store, "setItem">, consent: Consent): void {
  try {
    storage.setItem(CONSENT_KEY, consent);
  } catch {
    // Private windows can block storage. The choice then lasts for this page only.
  }
}

/** Analytics runs only on the live site, and only after the visitor accepts. */
export function shouldLoadAnalytics(host: string, consent: Consent | null): boolean {
  return host === PRODUCTION_HOST && consent === "granted";
}

/** The Google Analytics cookie names in a cookie string, so they can be deleted when consent is withdrawn. */
export function analyticsCookies(cookies: string): string[] {
  return cookies
    .split(";")
    .map((part) => part.trim().split("=")[0])
    .filter((name) => /^_ga(_|$)|^_gat/.test(name));
}
