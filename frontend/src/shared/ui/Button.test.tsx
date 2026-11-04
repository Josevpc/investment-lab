import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Button, ButtonLink, Empty, Tabs } from "./index";

describe("Button e ButtonLink", () => {
  it("o primário é tinta e tem pelo menos 48 px; o pequeno chega a 40 px", () => {
    render(
      <>
        <Button>Salvar</Button>
        <Button size="sm">Editar</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Salvar" })).toHaveClass("bg-ink", "min-h-12", "rounded-full");
    expect(screen.getByRole("button", { name: "Editar" })).toHaveClass("min-h-10");
  });

  it("o link com cara de botão é um link de verdade e tem o mesmo desenho do botão", () => {
    render(
      <MemoryRouter>
        <Button variant="secondary">Cancelar</Button>
        <ButtonLink to="/aporte" variant="secondary">
          Calcular aporte
        </ButtonLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Calcular aporte" });
    expect(link).toHaveAttribute("href", "/aporte");
    expect(link.className).toBe(screen.getByRole("button", { name: "Cancelar" }).className);
  });

  it("desabilitado, não dispara", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Salvar
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Tabs", () => {
  const tabs = [
    { value: "a", label: "Patrimônio" },
    { value: "b", label: "Composição" },
    { value: "c", label: "Desempenho" },
  ] as const;

  it("só a aba ativa entra na ordem de Tab; setas, Home e End trocam de aba", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs label="Seções" value="a" tabs={tabs} onChange={onChange} />);

    expect(screen.getByRole("tab", { name: "Patrimônio" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Composição" })).toHaveAttribute("tabindex", "-1");

    screen.getByRole("tab", { name: "Patrimônio" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("b");
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("c");
    await user.keyboard("{ArrowLeft}"); // o valor continua "a": para a esquerda, volta ao fim da lista
    expect(onChange).toHaveBeenLastCalledWith("c");
  });

  it("a aba ativa é tinta sólida e também marcada com aria-selected (não só cor)", () => {
    render(<Tabs label="Seções" value="b" tabs={tabs} onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "Composição", selected: true })).toHaveClass("bg-ink");
    expect(screen.getByRole("tab", { name: "Patrimônio", selected: false })).not.toHaveClass("bg-ink");
  });
});

describe("Empty", () => {
  it("explica o que fazer e oferece a ação, sem caixa tracejada", () => {
    const { container } = render(<Empty action={<Button>Cadastrar ativo</Button>}>Nenhum ativo ainda.</Empty>);
    expect(screen.getByText("Nenhum ativo ainda.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cadastrar ativo" })).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("dashed");
  });
});
