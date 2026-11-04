import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "@/shared/lib/preferences";
import { Layout } from "./Layout";

function renderAt(path: string, aside?: ReactNode, status: unknown = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(status), { status: 200 })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <PreferencesProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Layout aside={aside} />}>
              <Route path="*" element={<p>conteúdo</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </PreferencesProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

const sidebar = () => screen.getByRole("navigation", { name: "Principal" });

describe("Menu lateral", () => {
  it("abre Resumo, Ativos, Movimentações, Retiradas e Contas e caixa debaixo de Carteira quando a pessoa está nela", () => {
    renderAt("/carteira/ativos");

    const nav = sidebar();
    expect(within(nav).getByRole("link", { name: "Carteira" })).toHaveAttribute("aria-expanded", "true");
    const children = ["Resumo", "Ativos", "Movimentações", "Retiradas", "Contas e caixa"].map((name) => within(nav).getByRole("link", { name }));
    expect(children.map((l) => l.getAttribute("href"))).toEqual(["/carteira", "/carteira/ativos", "/carteira/movimentacoes", "/carteira/retiradas", "/carteira/contas"]);
    expect(within(nav).getByRole("link", { name: "Ativos" })).toHaveAttribute("aria-current", "page");
  });

  it("mantém as seções abertas também no fechamento do mês", () => {
    renderAt("/carteira/fechamento");
    expect(within(sidebar()).getByRole("link", { name: "Movimentações" })).toBeInTheDocument();
  });

  it("não cria itens novos no menu: o primeiro nível continua com os mesmos destinos", () => {
    renderAt("/aporte");

    const topLevel = within(sidebar())
      .getAllByRole("link")
      .map((l) => l.textContent);
    expect(topLevel).toEqual(["Visão geral", "Aporte do mês", "Carteira", "Histórico", "Trajetória", "Metas"]);
  });

  it("fora da Carteira, o submenu fica recolhido", () => {
    renderAt("/historico");
    expect(within(sidebar()).queryByRole("link", { name: "Ativos" })).not.toBeInTheDocument();
    expect(within(sidebar()).getByRole("link", { name: "Carteira" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Item ativo da navegação", () => {
  it("no menu lateral, só o ativo leva o marcador de tinta (além do tom e do aria-current)", () => {
    renderAt("/aporte");
    const nav = sidebar();
    const active = within(nav).getByRole("link", { name: "Aporte do mês" });
    expect(active.querySelector("[data-active-marker]")).not.toBeNull();
    expect(within(nav).getByRole("link", { name: "Histórico" }).querySelector("[data-active-marker]")).toBeNull();
    expect(nav.querySelectorAll("[data-active-marker]")).toHaveLength(1);
  });

  it("na barra do celular também, e o marcador não entra no nome acessível", () => {
    renderAt("/historico");
    const bottom = screen.getByRole("navigation", { name: "Principal (celular)" });
    const active = within(bottom).getByRole("link", { name: "Histórico" });
    expect(active.querySelector("[data-active-marker]")).not.toBeNull();
    expect(bottom.querySelectorAll("[data-active-marker]")).toHaveLength(1);
  });
});

describe("Estrutura do app", () => {
  it("a barra inferior do celular tem os mesmos 6 destinos, com o nome completo acessível", () => {
    renderAt("/aporte");
    const bottom = screen.getByRole("navigation", { name: "Principal (celular)" });
    expect(within(bottom).getAllByRole("link").map((l) => l.getAttribute("aria-label"))).toEqual([
      "Visão geral",
      "Aporte do mês",
      "Carteira",
      "Histórico",
      "Trajetória",
      "Metas",
    ]);
    expect(within(bottom).getByRole("link", { name: "Aporte do mês" })).toHaveAttribute("aria-current", "page");
  });

  it("o rodapé do menu tem Configurações e a promessa dos dados locais; a barra superior não repete a pílula", () => {
    renderAt("/");
    expect(within(sidebar().parentElement as HTMLElement).getByRole("link", { name: "Configurações" })).toHaveAttribute("href", "/configuracoes");
    expect(screen.getByText("Seus dados ficam só neste dispositivo.")).toBeInTheDocument();
    expect(screen.queryByText("Dados neste dispositivo")).not.toBeInTheDocument();
  });

  it("no modo demonstração, o selo aparece por escrito na barra superior", async () => {
    renderAt("/", undefined, { demo: true, database_file: "demo.db", last_backup_at: null });
    expect(await screen.findByRole("status")).toHaveTextContent("Modo demonstração");
  });

  it("o pular para o conteúdo leva ao main", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: "Pular para o conteúdo" })).toHaveAttribute("href", "#conteudo");
    expect(screen.getByRole("main")).toHaveAttribute("id", "conteudo");
  });

  it("reserva uma região opcional à direita: sem ela nada é desenhado; com ela, aparece depois do conteúdo", () => {
    renderAt("/");
    expect(screen.queryByTestId("regiao-direita")).not.toBeInTheDocument();
    cleanup();

    renderAt("/", <aside data-testid="regiao-direita" aria-label="Painel lateral" />);
    const slot = screen.getByTestId("regiao-direita");
    expect(slot.compareDocumentPosition(screen.getByRole("main")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
});
