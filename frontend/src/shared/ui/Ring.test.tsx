import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Ring } from "./Ring";

const slices = [
  { key: "rf", value: 60, color: "var(--chart-cat-1)" },
  { key: "fii", value: 40, color: "var(--chart-cat-2)" },
];

describe("Rosca", () => {
  it("é uma imagem com nome acessível que resume a distribuição", () => {
    render(<Ring slices={slices} label="Carteira: Renda fixa 60%, FII 40%" />);
    expect(screen.getByRole("img", { name: "Carteira: Renda fixa 60%, FII 40%" })).toBeInTheDocument();
  });

  it("desenha um arco por fatia, com ponta arredondada e a cor da fatia", () => {
    const { container } = render(<Ring slices={slices} label="x" />);
    const paths = container.querySelectorAll("path");
    expect(paths).toHaveLength(2);
    expect(paths[0]).toHaveAttribute("stroke-linecap", "round");
    expect((paths[1] as SVGPathElement).style.stroke).toBe("var(--chart-cat-2)");
  });

  it("mostra o texto do centro", () => {
    const { container } = render(<Ring slices={slices} label="x">Centro</Ring>);
    expect(container).toHaveTextContent("Centro");
  });
});
