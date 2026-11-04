import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog, Drawer, splitQuestion, useConfirm } from "./index";

function Opener({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const { confirm, dialog } = useConfirm();
  return (
    <>
      <button
        type="button"
        onClick={async () =>
          onAnswer(await confirm({ title: "Excluir o plano?", message: "As metas dele são apagadas.", confirmLabel: "Excluir plano" }))
        }
      >
        Excluir
      </button>
      {dialog}
    </>
  );
}

describe("ConfirmDialog", () => {
  it("é um diálogo com nome e descrição, e o foco começa em Cancelar (o caminho seguro)", () => {
    render(
      <ConfirmDialog
        title="Excluir o plano?"
        message="As metas dele são apagadas."
        confirmLabel="Excluir plano"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("alertdialog", { name: "Excluir o plano?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("As metas dele são apagadas.");
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
  });

  it("Esc cancela e os botões chamam a ação certa", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Excluir?" confirmLabel="Excluir" onConfirm={onConfirm} onCancel={onCancel} />);

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("prende o foco: Tab e Shift+Tab giram entre os dois botões, sem sair do diálogo", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Fora</button>
        <ConfirmDialog title="Excluir?" confirmLabel="Excluir" onConfirm={vi.fn()} onCancel={vi.fn()} />
      </>,
    );
    const cancel = screen.getByRole("button", { name: "Cancelar" });
    const confirm = screen.getByRole("button", { name: "Excluir" });

    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
  });
});

describe("useConfirm", () => {
  it("devolve true ao confirmar e false ao cancelar, e o foco volta para o botão que abriu", async () => {
    const user = userEvent.setup();
    const answers: boolean[] = [];
    render(<Opener onAnswer={(ok) => answers.push(ok)} />);
    const opener = screen.getByRole("button", { name: "Excluir" });

    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Excluir plano" }));
    expect(answers).toEqual([false, true]);
  });

  it("o diálogo vai para o body, fora de qualquer cartão com transformação (senão ele sairia do lugar)", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="card" className="rise">
        <Opener onAnswer={() => {}} />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(screen.getByTestId("card")).not.toContainElement(screen.getByRole("alertdialog"));
  });
});

describe("pilha de janelas", () => {
  it("Esc fecha só a de cima: a confirmação sobre um painel não fecha o painel junto", async () => {
    const user = userEvent.setup();
    const closeDrawer = vi.fn();
    function Screen() {
      const [open, setOpen] = useState(false);
      return (
        <Drawer title="Detalhes" onClose={closeDrawer}>
          <button type="button" onClick={() => setOpen(true)}>
            Excluir
          </button>
          {open && <ConfirmDialog title="Excluir?" confirmLabel="Sim" onConfirm={() => {}} onCancel={() => setOpen(false)} />}
        </Drawer>
      );
    }
    render(<Screen />);
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(closeDrawer).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(closeDrawer).toHaveBeenCalledTimes(1);
  });
});

describe("splitQuestion", () => {
  it("separa a pergunta do efeito", () => {
    expect(splitQuestion("Excluir o valor de 17/10/2026? O registro sai do histórico.")).toEqual({
      title: "Excluir o valor de 17/10/2026?",
      message: "O registro sai do histórico.",
    });
  });

  it("sem pergunta, tudo vira título", () => {
    expect(splitQuestion("Excluir este lançamento.")).toEqual({ title: "Excluir este lançamento." });
  });
});
