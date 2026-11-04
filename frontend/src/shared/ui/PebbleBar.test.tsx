import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
