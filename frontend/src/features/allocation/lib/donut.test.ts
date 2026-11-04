import { describe, expect, it } from "vitest";
import { angleFromPoint, angleToBps, arcPath, bpsToAngle, buildSlices, polar } from "./donut";

describe("geometria da rosca", () => {
  it("posiciona ângulos a partir das 12h no sentido horário", () => {
    const top = polar(100, 100, 50, 0);
    expect(top.x).toBeCloseTo(100);
    expect(top.y).toBeCloseTo(50);
    const right = polar(100, 100, 50, Math.PI / 2);
    expect(right.x).toBeCloseTo(150);
    expect(right.y).toBeCloseTo(100);
  });

  it("converte ponto em ângulo e em pontos-base", () => {
    expect(angleFromPoint(100, 100, 100, 50)).toBeCloseTo(0); // 12h
    expect(angleFromPoint(100, 100, 150, 100)).toBeCloseTo(Math.PI / 2); // 3h
    expect(angleFromPoint(100, 100, 50, 100)).toBeCloseTo((3 * Math.PI) / 2); // 9h
    expect(angleToBps(Math.PI)).toBeCloseTo(5000);
    expect(angleToBps(bpsToAngle(2500))).toBeCloseTo(2500);
  });

  it("acumula as fatias na ordem", () => {
    const slices = buildSlices(["a", "b", "c"], { a: 5000, b: 3000, c: 2000 });
    expect(slices.map((s) => [s.startBps, s.endBps])).toEqual([
      [0, 5000],
      [5000, 8000],
      [8000, 10000],
    ]);
  });

  it("gera caminho vazio para fatia vazia e fecha o anel completo", () => {
    expect(arcPath(100, 100, 80, 50, 1, 1)).toBe("");
    const ring = arcPath(100, 100, 80, 50, 0, Math.PI * 2);
    expect(ring.startsWith("M")).toBe(true);
    expect(ring.match(/A /g)?.length).toBe(4);
    expect(arcPath(100, 100, 80, 50, 0, 1)).toMatch(/^M .* Z$/);
  });
});
