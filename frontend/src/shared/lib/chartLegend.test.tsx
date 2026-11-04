import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { legendText } from "./chartLegend";

describe("legendText", () => {
  it("escreve o nome da série em tinta de texto, não na cor da série", () => {
    render(<div style={{ color: "rgb(1, 2, 3)" }}>{legendText("Criptomoedas")}</div>);
    expect(screen.getByText("Criptomoedas")).toHaveStyle({ color: "var(--ink-2)" });
  });
});
