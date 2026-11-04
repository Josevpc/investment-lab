import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppreciationPill } from "./AppreciationPill";

describe("AppreciationPill", () => {
  it("diz o período real da medição, não um prazo fixo", () => {
    render(<AppreciationPill cents={8_000} since="2026-10-31" />);
    const pill = screen.getByText(/de valorização desde 31\/10/);
    expect(pill.textContent?.replace(/\s/g, " ")).toBe("R$ 80,00 de valorização desde 31/10");
    expect(pill.textContent).not.toMatch(/30 dias/);
  });

  it("valorização positiva usa o tom jade", () => {
    const { container } = render(<AppreciationPill cents={8_000} since="2026-10-02" />);
    expect(container.firstElementChild?.className).toContain("bg-jade-t");
    expect(container.textContent).toContain("▲");
  });

  it("recuo vem escrito, com o valor positivo e em tom neutro (argila suave), nunca jade", () => {
    const { container } = render(<AppreciationPill cents={-12_345} since="2026-10-02" />);
    const pill = container.firstElementChild as HTMLElement;
    expect(pill.textContent?.replace(/\s/g, " ")).toContain("Recuo de R$ 123,45 desde 02/10");
    expect(pill.className).toContain("bg-clay-t");
    expect(pill.className).not.toContain("jade");
    expect(pill.textContent).toContain("▼");
  });

  it("o valor passa por <Money>, que respeita ocultar valores", () => {
    const { container } = render(<AppreciationPill cents={5_000} since="2026-10-02" />);
    expect(container.querySelector(".money")).not.toBeNull();
  });
});
