import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Menu } from "./Menu";

const items = [
  { label: "Novo aporte", to: "/a" },
  { label: "Novo ativo", to: "/b" },
  { label: "Registrar provento", disabled: true, hint: "Cadastre um ativo primeiro" },
];

function setup(extra: Partial<Parameters<typeof Menu>[0]> = {}) {
  render(
    <MemoryRouter>
      <Menu label="Mais ações" items={items} {...extra} />
      <button type="button">Fora</button>
    </MemoryRouter>,
  );
}

describe("Menu de ações", () => {
  it("começa fechado e anuncia que abre um menu", () => {
    setup();
    const trigger = screen.getByRole("button", { name: "Mais ações" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("abre com clique, lista os itens como links e põe o foco no primeiro", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Mais ações" }));

    expect(screen.getByRole("button", { name: "Mais ações" })).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Mais ações" });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Novo aporte" })).toHaveAttribute("href", "/a");
    expect(screen.getByRole("menuitem", { name: "Novo ativo" })).toHaveAttribute("href", "/b");
    expect(screen.getByRole("menuitem", { name: "Novo aporte" })).toHaveFocus();
  });

  it("as setas, Home e End percorrem os itens e voltam ao começo", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Mais ações" }));
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Novo ativo" })).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: /Registrar provento/ })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Novo aporte" })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: /Registrar provento/ })).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Novo aporte" })).toHaveFocus();
  });

  it("Esc fecha e devolve o foco ao botão", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Mais ações" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mais ações" })).toHaveFocus();
  });

  it("clicar fora fecha", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Mais ações" }));
    await userEvent.click(screen.getByRole("button", { name: "Fora" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("escolher um item fecha o menu", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Mais ações" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Novo ativo" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("item desabilitado diz o motivo por escrito e não faz nada", async () => {
    const onSelect = vi.fn();
    setup({ items: [{ label: "Registrar provento", disabled: true, hint: "Cadastre um ativo primeiro", onSelect }] });
    await userEvent.click(screen.getByRole("button", { name: "Mais ações" }));

    const item = screen.getByRole("menuitem", { name: /Registrar provento/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveTextContent("Cadastre um ativo primeiro");
    await userEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});
