import { describe, expect, it } from "vitest";
import { EARTH_PALETTE, nextEarthColor } from "./palette";

describe("nextEarthColor", () => {
  it("começa pelo musgo e pula os tons já usados, sem distinguir maiúsculas", () => {
    expect(nextEarthColor([])).toBe("#5e8a57");
    expect(nextEarthColor(["#5E8A57"])).toBe("#c46f4e");
    expect(nextEarthColor(["#5e8a57", "#d6a84b"])).toBe("#c46f4e");
  });

  it("ignora cores que o usuário escolheu fora da paleta", () => {
    expect(nextEarthColor(["#2563eb", "#7c3aed"])).toBe("#5e8a57");
  });

  it("com todos os tons usados, volta a percorrer a paleta", () => {
    expect(nextEarthColor([...EARTH_PALETTE])).toBe(EARTH_PALETTE[0]);
    expect(nextEarthColor([...EARTH_PALETTE, "#000000"])).toBe(EARTH_PALETTE[1]);
  });
});
