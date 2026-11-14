import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PebbleBar } from "./PebbleBar";
import { ShareBar } from "./index";

describe("Barra de participação", () => {
  it("descreve a participação e a meta no nome acessível", () => {
    render(<ShareBar valueBps={4_000} targetBps={5_000} color="var(--chart-cat-1)" label="Renda fixa: 40% da carteira, meta 50%" />);
    expect(screen.getByRole("img", { name: "Renda fixa: 40% da carteira, meta 50%" })).toBeInTheDocument();
  });

  it("desenha o marcador de meta só quando há meta, na posição dela", () => {
    const { container, rerender } = render(<ShareBar valueBps={4_000} color="red" label="Sem meta" />);
    expect(container.querySelector("[data-target]")).toBeNull();

    rerender(<ShareBar valueBps={4_000} targetBps={5_000} color="red" label="Com meta" />);
    expect((container.querySelector("[data-target]") as HTMLElement).style.left).toBe("50%");
  });

  it("limita o preenchimento a 0 a 100%", () => {
    const { container } = render(<ShareBar valueBps={30_000} color="red" label="Cheia" />);
    expect((container.querySelector("[data-fill]") as HTMLElement).style.width).toBe("100%");
  });
});

describe("Barra seixo com trecho separado", () => {
  it("põe o trecho cheio e o hachurado lado a lado e lê a soma dos dois", () => {
    const { container } = render(
      <PebbleBar role="progressbar" valueBps={3_000} separatedBps={4_000} valueText="R$ 3 comprado e R$ 4 separado" label="Cat" />,
    );
    const bar = screen.getByRole("progressbar", { name: "Cat" });
    expect(bar).toHaveAttribute("aria-valuenow", "70");
    expect(bar).toHaveAttribute("aria-valuetext", "R$ 3 comprado e R$ 4 separado");
    expect((container.querySelector("[data-fill]") as HTMLElement).style.width).toBe("30%");
    const separated = container.querySelector("[data-separated]") as SVGElement;
    expect(separated.style.width).toBe("40%");
    expect(separated.getAttribute("aria-hidden")).toBe("true");
    expect(separated.querySelector("pattern")).not.toBeNull();
    expect(separated.querySelector("rect[stroke-dasharray]")).not.toBeNull();
  });

  it("o separado nunca passa de 100% junto com o cheio", () => {
    const { container } = render(<PebbleBar role="progressbar" valueBps={8_000} separatedBps={5_000} label="Cat" />);
    expect((container.querySelector("[data-separated]") as SVGElement).style.width).toBe("20%");
  });

  it("sem separado, não desenha o trecho nem o valuetext", () => {
    const { container } = render(<PebbleBar role="progressbar" valueBps={3_000} label="Cat" />);
    expect(container.querySelector("[data-separated]")).toBeNull();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuetext");
  });
});
