import { describe, expect, it } from "vitest";
import { destinationText } from "./destination";

const refs = (...names: string[]) => names.map((name, i) => ({ asset_id: i + 1, name }));

describe("destinationText", () => {
  it("lista quem recebe e quem está mantido, sem sugerir valor por ativo", () => {
    expect(destinationText(refs("B", "C"), refs("A"))).toBe("Vai para: B ou C · A mantido");
    expect(destinationText(refs("B"), refs("A", "D"))).toBe("Vai para: B · A e D mantidos");
  });

  it("resume listas longas", () => {
    expect(destinationText(refs("B", "C", "D", "E", "F"), refs("A"))).toBe("Vai para: B, C, D ou mais 2 · A mantido");
  });

  it("sem mantidos não repete a lista", () => {
    expect(destinationText(refs("A", "B"), [])).toBeNull();
  });

  it("toda mantida: só diz quem está mantido", () => {
    expect(destinationText([], refs("A"))).toBe("A mantido");
  });
});
