import { describe, expect, it } from "vitest";
import { CONSENT_KEY, analyticsCookies, readConsent, saveConsent, shouldLoadAnalytics } from "./consent";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("consent", () => {
  it("is unknown until the visitor chooses", () => {
    expect(readConsent(memoryStorage())).toBeNull();
  });

  it("remembers accept and decline", () => {
    const storage = memoryStorage();
    saveConsent(storage, "granted");
    expect(readConsent(storage)).toBe("granted");
    saveConsent(storage, "denied");
    expect(readConsent(storage)).toBe("denied");
  });

  it("ignores anything else stored under the key", () => {
    expect(readConsent(memoryStorage({ [CONSENT_KEY]: "maybe" }))).toBeNull();
  });

  it("treats blocked storage as no choice yet, and saving as a no-op", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readConsent(blocked)).toBeNull();
    expect(() => saveConsent(blocked, "granted")).not.toThrow();
  });
});

describe("shouldLoadAnalytics", () => {
  it("loads only on the live site, after the visitor accepts", () => {
    expect(shouldLoadAnalytics("anytools.fyi", "granted")).toBe(true);
    expect(shouldLoadAnalytics("anytools.fyi", "denied")).toBe(false);
    expect(shouldLoadAnalytics("anytools.fyi", null)).toBe(false);
    expect(shouldLoadAnalytics("127.0.0.1", "granted")).toBe(false);
    expect(shouldLoadAnalytics("anytools-fyi.safayetdib.workers.dev", "granted")).toBe(false);
  });
});

describe("analyticsCookies", () => {
  it("finds the Google Analytics cookies to delete when consent is withdrawn", () => {
    expect(analyticsCookies("theme=dark; _ga=GA1.1.1; _ga_5KMBSHH44P=GS1; _gat=1; other=1")).toEqual([
      "_ga",
      "_ga_5KMBSHH44P",
      "_gat",
    ]);
    expect(analyticsCookies("")).toEqual([]);
  });
});
