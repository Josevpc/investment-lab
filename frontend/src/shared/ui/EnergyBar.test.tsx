import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EnergyBar } from "./EnergyBar";

const fill = () => screen.getByRole("progressbar").firstElementChild as HTMLElement;

describe("Barra da reserva", () => {
  it("expõe o progresso para leitores de tela", () => {
    render(<EnergyBar bps={4_500} label="Progresso da reserva" />);
    const bar = screen.getByRole("progressbar", { name: "Progresso da reserva" });
    expect(bar).toHaveAttribute("aria-valuenow", "45");
    expect(fill().style.width).toBe("45%");
  });

  it("só enche por inteiro quando a reserva está completa", () => {
    const { rerender } = render(<EnergyBar bps={9_900} label="Reserva" />);
    expect(fill().style.width).toBe("99%");

    rerender(<EnergyBar bps={10_000} label="Reserva" />);
    expect(fill().style.width).toBe("100%");
  });

  it("ignora valores fora de 0 a 100%", () => {
    render(<EnergyBar bps={25_000} label="Reserva" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});
