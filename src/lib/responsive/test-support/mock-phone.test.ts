import { describe, expect, it } from "vitest";
import { mockPhone } from "./mock-phone";

describe("mockPhone", () => {
  it("remplace window.matchMedia par un stub renvoyant `matches` demandé", () => {
    const restore = mockPhone(true);
    try {
      expect(window.matchMedia("(max-width: 30rem)").matches).toBe(true);
    } finally {
      restore();
    }
  });

  it("restaure le window.matchMedia d'origine", () => {
    const original = window.matchMedia;
    const restore = mockPhone(false);
    expect(window.matchMedia).not.toBe(original);
    restore();
    expect(window.matchMedia).toBe(original);
  });

  it("le stub expose les méthodes addEventListener/removeEventListener/dispatchEvent (no-op)", () => {
    const restore = mockPhone(false);
    try {
      const mql = window.matchMedia("(max-width: 30rem)");
      expect(mql.matches).toBe(false);
      expect(() => mql.addEventListener("change", () => {})).not.toThrow();
      expect(() => mql.removeEventListener("change", () => {})).not.toThrow();
      expect(mql.dispatchEvent(new Event("change"))).toBe(false);
      expect(mql.onchange).toBeNull();
      expect(() => mql.addListener(() => {})).not.toThrow();
      expect(() => mql.removeListener(() => {})).not.toThrow();
    } finally {
      restore();
    }
  });
});
