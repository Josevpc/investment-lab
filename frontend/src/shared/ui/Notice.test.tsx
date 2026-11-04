import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Notice } from "./index";

describe("Notice", () => {
  it("anuncia o aviso de sucesso a leitores de tela quando recebe role=status", () => {
    render(
      <Notice tone="success" role="status">
        Grupo Renda variável criado.
      </Notice>,
    );
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Grupo Renda variável criado.");
    expect(notice.className).toContain("jade");
  });

  it("sem role, é só um parágrafo", () => {
    render(<Notice>Texto de apoio</Notice>);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("Texto de apoio")).toBeInTheDocument();
  });
});
