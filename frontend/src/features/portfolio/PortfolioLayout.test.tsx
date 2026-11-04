import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortfolioLayout } from "./PortfolioLayout";
import { AssetsTab } from "./tabs/AssetsTab";
import { MovementsTab } from "./tabs/MovementsTab";
import { SummaryTab } from "./tabs/SummaryTab";

const asset = {
  id: 2,
  name: "Cofrinho",
  institution_name: "Mercado Pago",
  purpose: null,
  archived: false,
  invested_cents: 71_391,
  current_cents: 71_391,
  valuation_date: "2026-10-15",
};

function mockApi(assets: unknown[] = [asset]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes("/assets")) return json(assets);
      if (url.endsWith("/portfolio/summary")) return json({ assets_count: assets.length, by_class: [] });
      if (url.includes("/movements")) return json([]);
      if (url.includes("/accounts?")) return json([]);
      if (url.endsWith("/asset-classes") || url.includes("/asset-classes?") || url.endsWith("/institutions")) return json([]);
      if (url.endsWith("/contributions") || url.endsWith("/snapshots")) return json([]);
      return json({});
    }),
  );
}

function Probe() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/carteira" element={<PortfolioLayout />}>
            <Route index element={<SummaryTab />} />
            <Route path="ativos" element={<AssetsTab />} />
            <Route path="movimentacoes" element={<MovementsTab />} />
            <Route path="fechamento" element={<p>tela de fechamento</p>} />
            <Route path="atualizar" element={<p>tela de atualizar</p>} />
          </Route>
        </Routes>
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Carteira: ações no topo", () => {
  it("Atualizar saldos é a única ação principal (tinta), sem brilho pulsante", async () => {
    mockApi();
    renderAt("/carteira/movimentacoes");

    const actions = await screen.findByRole("group", { name: "Ações da carteira" });
    const update = within(actions).getByRole("link", { name: "Atualizar saldos" });
    expect(update).toHaveAttribute("href", "/carteira/atualizar");
    expect(update).toHaveClass("bg-ink");
    expect(update.className).not.toMatch(/glow|neon|animate/);
    // Os quatro botões de antes não ficam mais à vista: só o menu.
    expect(within(actions).queryByRole("link", { name: "Novo aporte" })).not.toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "Mais ações" })).toHaveClass("bg-raise");
  });

  it("na própria tela de Atualizar saldos, o botão principal que levaria a ela mesma não aparece", async () => {
    mockApi();
    renderAt("/carteira/atualizar");

    expect(await screen.findByText("tela de atualizar")).toBeInTheDocument();
    const actions = screen.getByRole("group", { name: "Ações da carteira" });
    expect(within(actions).queryByRole("link", { name: "Atualizar saldos" })).not.toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "Mais ações" })).toBeInTheDocument();
  });

  it("Mais ações guarda novo aporte, novo ativo e registrar provento, levando à seção certa", async () => {
    const user = userEvent.setup();
    mockApi();
    renderAt("/carteira/movimentacoes");

    const trigger = await screen.findByRole("button", { name: "Mais ações" });
    await vi.waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);

    const menu = screen.getByRole("menu", { name: "Mais ações" });
    // Os itens dependem de haver ativos: esperam a lista carregar.
    await vi.waitFor(() => expect(within(menu).getByRole("menuitem", { name: "Novo aporte" })).toHaveAttribute("href", "/carteira/movimentacoes?novo=aporte"));
    expect(within(menu).getByRole("menuitem", { name: "Novo ativo" })).toHaveAttribute("href", "/carteira/ativos?novo=1");
    expect(within(menu).getByRole("menuitem", { name: "Registrar provento" })).toHaveAttribute("href", "/carteira/movimentacoes?novo=provento");
  });

  it("sem ativos, aporte e provento ficam desabilitados e explicam o motivo; Novo ativo segue disponível", async () => {
    const user = userEvent.setup();
    mockApi([]);
    renderAt("/carteira/movimentacoes");

    await user.click(await screen.findByRole("button", { name: "Mais ações" }));
    const menu = screen.getByRole("menu", { name: "Mais ações" });

    expect(within(menu).getByRole("menuitem", { name: "Novo ativo" })).toHaveAttribute("href", "/carteira/ativos?novo=1");
    await vi.waitFor(() => expect(within(menu).getByRole("menuitem", { name: /Novo aporte/ })).toHaveAttribute("aria-disabled", "true"));
    expect(within(menu).getByRole("menuitem", { name: /Novo aporte/ })).toHaveTextContent("Cadastre um ativo primeiro");
    expect(within(menu).getByRole("menuitem", { name: /Registrar provento/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("organiza a carteira em Resumo, Ativos, Movimentações, Retiradas e Contas e caixa", async () => {
    mockApi();
    renderAt("/carteira/ativos");

    const tabs = await screen.findByRole("navigation", { name: "Seções da carteira" });
    expect(within(tabs).getAllByRole("link").map((l) => l.textContent)).toEqual(["Resumo", "Ativos", "Movimentações", "Retiradas", "Contas e caixa"]);
    expect(within(tabs).getByRole("link", { name: "Ativos" })).toHaveAttribute("aria-current", "page");
  });
});

describe("Carteira: Movimentações a partir do extrato do caixa", () => {
  it("abre no mês pedido pelo endereço (?mes=)", async () => {
    mockApi();
    renderAt("/carteira/movimentacoes?mes=2026-08");
    expect(await screen.findByText(/Nenhuma movimentação em ago\/2026/)).toBeInTheDocument();
  });
});

describe("Carteira: formulários já abertos", () => {
  it("Novo aporte abre o formulário de aporte e limpa o endereço", async () => {
    mockApi();
    renderAt("/carteira/movimentacoes?novo=aporte");

    expect(await screen.findByLabelText("Valor do aporte (R$)")).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/carteira/movimentacoes"));
    expect(screen.getByTestId("where")).not.toHaveTextContent("novo=");
  });

  it("Registrar provento abre o formulário de provento", async () => {
    mockApi();
    renderAt("/carteira/movimentacoes?novo=provento");
    expect(await screen.findByLabelText("Valor recebido (R$)")).toBeInTheDocument();
  });

  it("Novo ativo abre o cadastro na seção Ativos", async () => {
    mockApi();
    renderAt("/carteira/ativos?novo=1");
    expect(await screen.findByRole("heading", { name: "Novo ativo" })).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByTestId("where")).not.toHaveTextContent("novo="));
  });

  it("sem pedido, as seções abrem normalmente, só com a lista", async () => {
    mockApi();
    renderAt("/carteira/movimentacoes");
    expect(await screen.findByRole("heading", { name: "Movimentações" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Valor do aporte (R$)")).not.toBeInTheDocument();
  });
});

describe("Carteira: endereços antigos", () => {
  it("/carteira?fechar=1 leva ao fechamento", async () => {
    mockApi();
    renderAt("/carteira?fechar=1");
    expect(await screen.findByText("tela de fechamento")).toBeInTheDocument();
  });

  it("?categoria= leva à lista de ativos filtrada", async () => {
    mockApi();
    renderAt("/carteira?categoria=cripto");
    await vi.waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/carteira/ativos?categoria=cripto"));
  });
});

describe("Carteira: resgate pelo link da reserva", () => {
  it("?novo=resgate&ativo=ID abre o formulário de resgate com o ativo e limpa o endereço", async () => {
    mockApi();
    renderAt("/carteira/movimentacoes?novo=resgate&ativo=2");

    const form = await screen.findByRole("form", { name: "Registrar resgate" });
    await vi.waitFor(() => expect(within(form).getByLabelText("Ativo")).toHaveValue("2"));
    await vi.waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/carteira/movimentacoes"));
    expect(screen.getByTestId("where")).not.toHaveTextContent("novo=");
    expect(screen.getByTestId("where")).not.toHaveTextContent("ativo=");
  });
});
