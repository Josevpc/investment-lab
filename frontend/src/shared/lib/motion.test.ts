import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollBehavior } from "./motion";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scrollBehavior", () => {
  it("rola suave por padrão", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(scrollBehavior()).toBe("smooth");
  });

  it("com redução de movimento, pula direto", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion") }));
    expect(scrollBehavior()).toBe("auto");
  });

  it("sem matchMedia (ambiente de teste), não quebra", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(scrollBehavior()).toBe("smooth");
  });
});
