import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NewAssetsNote } from "./NewAssetsNote";

describe("NewAssetsNote", () => {
  it("explica que ativos antigos trazidos para o app entram como aporte", () => {
    render(<NewAssetsNote cents={150_000} />);
    const line = screen.getByText(/ativos antigos trazidos para o app/i);
    expect((line.textContent ?? "").replace(/\s/g, " ")).toContain("Inclui R$ 1.500,00 de ativos antigos trazidos para o app no período");
    expect(line).toHaveTextContent("para não parecerem valorização");
  });

  it("sem ativos novos, não mostra nada", () => {
    const { container } = render(<NewAssetsNote cents={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
