import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { celebrate } from "@/shared/lib/celebrate";
import { CelebrationHost } from "./Celebration";

function renderHost() {
  render(
    <MemoryRouter>
      <CelebrationHost />
    </MemoryRouter>,
  );
}

describe("Comemoração", () => {
  it("não mostra nada até alguma conquista acontecer", () => {
    renderHost();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("diz o que foi feito, o destaque e o que vem a seguir, e anuncia para leitores de tela", () => {
    renderHost();
    act(() =>
      celebrate({
        title: "Mês fechado!",
        text: "Mês cumprido: aporte feito e fechamento registrado.",
        highlight: "Sequência de 4 meses",
        next: { label: "Ver desempenho", to: "/historico" },
      }),
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Mês fechado!");
    expect(status).toHaveTextContent("Sequência de 4 meses");
    expect(screen.getByRole("link", { name: "Ver desempenho" })).toHaveAttribute("href", "/historico");
  });

  it("mostra o próximo passo como texto quando não há para onde ir", () => {
    renderHost();
    act(() => celebrate({ title: "Provento registrado!", text: "R$ 3,00 recebidos.", next: { label: "Reinvista com Transferir." } }));
    expect(screen.getByRole("status")).toHaveTextContent("A seguir: Reinvista com Transferir.");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("a conquista nova substitui a anterior e dá para fechar o aviso", async () => {
    const user = userEvent.setup();
    renderHost();
    act(() => celebrate({ title: "Primeira", text: "um" }));
    act(() => celebrate({ title: "Segunda", text: "dois" }));
    expect(screen.queryByText("Primeira")).not.toBeInTheDocument();
    expect(screen.getByText("Segunda")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Fechar aviso" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("o confete é decorativo e fica escondido dos leitores de tela", () => {
    const { container } = render(
      <MemoryRouter>
        <CelebrationHost />
      </MemoryRouter>,
    );
    act(() => celebrate({ title: "Oba", text: "feito" }));
    const confetti = container.ownerDocument.querySelector(".confetti");
    expect(confetti).toHaveAttribute("aria-hidden", "true");
  });
});
