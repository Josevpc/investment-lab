import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../../index.css"), "utf-8");

/** Lê as variáveis `--nome: #hex` de um bloco (`:root` ou `.dark`) do index.css. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = ["ink", "ink-2", "ink-3", "jade", "gold", "clay"];
const SURFACES = ["ground", "soil", "card", "raise", "jade-t", "gold-t", "clay-t"];

describe("contraste AA dos tokens de texto (4,5:1)", () => {
  for (const [theme, selector] of [
    ["claro", ":root"],
    ["escuro", ".dark"],
  ] as const) {
    it(`tema ${theme}: texto em tinta, jade, mel e argila sobre toda superfície`, () => {
      const t = tokens(selector);
      const failures: string[] = [];
      for (const text of TEXT) {
        for (const surface of SURFACES) {
          const ratio = contrast(t[text], t[surface]);
          if (ratio < 4.5) failures.push(`${text} sobre ${surface}: ${ratio.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});
