import { describe, expect, it } from "vitest";
import { ringArcs } from "./ring";

const opts = { size: 200, thickness: 20, gap: 6 };

describe("ringArcs", () => {
  it("devolve um arco por fatia com valor, na ordem", () => {
    const arcs = ringArcs(
      [
        { key: "a", value: 50 },
        { key: "b", value: 0 },
        { key: "c", value: 50 },
      ],
      opts,
    );
    expect(arcs.map((a) => a.key)).toEqual(["a", "c"]);
    expect(arcs[0].d.startsWith("M ")).toBe(true);
  });

  it("não desenha nada sem valores positivos", () => {
    expect(ringArcs([{ key: "a", value: 0 }], opts)).toEqual([]);
    expect(ringArcs([], opts)).toEqual([]);
  });

  it("recua as pontas para a lacuna aparecer: o arco de meia volta não chega às 6h", () => {
    const [first] = ringArcs(
      [
        { key: "a", value: 50 },
        { key: "b", value: 50 },
      ],
      opts,
    );
    // Raio 90, centro 100. Sem recuo o arco iria de (100,10) a (100,190).
    const numbers = first.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const [x0, y0] = numbers;
    const endX = numbers[numbers.length - 2];
    const endY = numbers[numbers.length - 1];
    expect(x0).toBeGreaterThan(100);
    expect(y0).toBeGreaterThan(10);
    expect(endX).toBeGreaterThan(100);
    expect(endY).toBeLessThan(190);
  });

  it("fatia fina demais vira um ponto, que a ponta arredondada desenha como círculo", () => {
    const arcs = ringArcs(
      [
        { key: "grande", value: 9_990 },
        { key: "fina", value: 10 },
      ],
      opts,
    );
    const fina = arcs.find((a) => a.key === "fina")!;
    const [x0, y0, x1, y1] = fina.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect([x0, y0]).toEqual([x1, y1]);
  });

  it("uma fatia só fecha a volta toda", () => {
    const [only] = ringArcs([{ key: "a", value: 10 }], opts);
    expect(only.d.match(/A /g)).toHaveLength(2);
  });
});
