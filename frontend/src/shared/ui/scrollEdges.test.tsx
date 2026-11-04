import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tabs } from "./index";

const tabs = [
  { value: "a", label: "Patrimônio" },
  { value: "b", label: "Composição" },
  { value: "c", label: "Desempenho" },
] as const;

function measure(scrollWidth: number, clientWidth: number) {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(scrollWidth);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(clientWidth);
}

afterEach(() => vi.restoreAllMocks());

describe("pista de rolagem das abas", () => {
  it("quando as abas não cabem, a borda com mais abas esmaece", () => {
    measure(420, 328);
    render(<Tabs label="Visões" value="a" tabs={tabs} onChange={() => {}} />);
    const list = screen.getByRole("tablist", { name: "Visões" });
    expect(list.style.maskImage || list.style.webkitMaskImage).toContain("transparent 100%");
  });

  it("quando cabem, nada esmaece", () => {
    measure(300, 328);
    render(<Tabs label="Visões" value="a" tabs={tabs} onChange={() => {}} />);
    const list = screen.getByRole("tablist", { name: "Visões" });
    expect(list.getAttribute("style") ?? "").not.toContain("mask");
  });
});

function rect(left: number, right: number) {
  return { left, right, top: 0, bottom: 40, width: right - left, height: 40, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
}

describe("aba ativa à vista", () => {
  it("rola a faixa para mostrar a aba escolhida quando ela está cortada", () => {
    // Faixa de 0 a 300 px; "Desempenho" começa em 280 e termina em 460: está cortada à direita.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("role") === "tablist") return rect(0, 300);
      if (this.id === "tab-c") return rect(280, 460);
      return rect(0, 100);
    });
    const { rerender } = render(<Tabs label="Visões" value="a" tabs={tabs} onChange={() => {}} />);
    const list = screen.getByRole("tablist", { name: "Visões" });
    expect(list.scrollLeft).toBe(0);

    rerender(<Tabs label="Visões" value="c" tabs={tabs} onChange={() => {}} />);
    // 460 (fim da aba) - 300 (fim da faixa) + margem do esmaecimento
    expect(list.scrollLeft).toBeGreaterThanOrEqual(160);
  });

  it("não rola quando a aba já está inteira à vista", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "tablist" ? rect(0, 300) : rect(100, 200);
    });
    render(<Tabs label="Visões" value="b" tabs={tabs} onChange={() => {}} />);
    expect(screen.getByRole("tablist", { name: "Visões" }).scrollLeft).toBe(0);
  });
});
