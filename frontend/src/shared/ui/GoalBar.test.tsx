import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GoalBar } from "./GoalBar";

describe("Barra de meta", () => {
  it("expõe o progresso por escrito e a barra preenche até o valor", () => {
    render(<GoalBar bps={500} label="Meta" />);
    const bar = screen.getByRole("progressbar", { name: "Meta" });
    expect(bar).toHaveAttribute("aria-valuenow", "5");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("5%");
  });

  it("escreve os marcos e marca com ✓ os já alcançados, sem depender de cor", () => {
    render(<GoalBar bps={6_000} label="Meta" />);
    const marks = within(screen.getByRole("list", { name: "Marcos da meta" })).getAllByRole("listitem");
    expect(marks.map((m) => m.textContent)).toEqual(["✓ 25%", "✓ 50%", "75%", "100%"]);
  });

  it("com marcadores, desenha 25, 50 e 75% como círculos: mel os alcançados, cinza os que faltam", () => {
    const { container } = render(<GoalBar bps={6_000} label="Meta" markers />);
    const circles = [...container.querySelectorAll("[data-mark]")].map((c) => c.getAttribute("data-mark"));
    expect(circles).toEqual(["reached", "reached", "pending"]);
    // Os rótulos escritos continuam: a cor não é o único sinal.
    expect(within(screen.getByRole("list", { name: "Marcos da meta" })).getAllByRole("listitem")).toHaveLength(4);
  });

  it("sem marcadores, não desenha círculos", () => {
    const { container } = render(<GoalBar bps={6_000} label="Meta" />);
    expect(container.querySelector("[data-mark]")).toBeNull();
  });
});
