import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AllocationClass } from "../types";
import { Donut } from "./Donut";

const classes = [
  { key: "rf", name: "Renda fixa", color: "#111" },
  { key: "rv", name: "Renda variável", color: "#222" },
] as AllocationClass[];
const values = { rf: 6000, rv: 4000 };

describe("Donut", () => {
  it("só de leitura é uma imagem descrita", () => {
    render(<Donut classes={classes} values={values} />);
    expect(screen.getByRole("img", { name: "Alocação: Renda fixa 60%, Renda variável 40%" })).toBeInTheDocument();
  });

  it("editável é um grupo nomeado: role=img esconderia as alças do leitor de tela", () => {
    render(<Donut classes={classes} values={values} onChange={() => {}} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Alocação: Renda fixa 60%, Renda variável 40%" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Divisão entre Renda fixa e Renda variável" })).toBeInTheDocument();
  });
});
