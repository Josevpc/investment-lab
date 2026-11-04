import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Comparison, ComparisonItem } from "@/features/allocation";
import { todayISO } from "@/shared/lib/format";
import type { Asset } from "../types";
import { SummaryTab } from "./SummaryTab";

const item = (patch: Partial<ComparisonItem>): ComparisonItem => ({
  class_id: 1,
  class_key: "rf",
  class_name: "Renda fixa",
  color: "#5aa88a",
  current_cents: 40_000,
  current_bps: 4000,
  target_bps: 5000,
  effective_target_bps: 5000,
  hold_status: "none",
  diff_cents: 0,
  held_assets: [],
  ...patch,
});

// Carteira de R$ 1.000: Renda variável (R$ 300) está toda mantida e sai da base (R$ 700).
const comparison: Comparison = {
  plan_id: 1,
  plan_name: "Plano padrão",
  total_cents: 100_000,
  base_cents: 70_000,
  items: [
    item({ effective_target_bps: 7143, diff_cents: -10_000 }),
    item({
      class_id: 2,
      class_key: "rv",
      class_name: "Renda variável",
      current_cents: 30_000,
      current_bps: 3000,
      target_bps: 3000,
      effective_target_bps: 0,
      hold_status: "all",
      diff_cents: null,
      held_assets: [{ asset_id: 9, name: "PETR4", current_cents: 30_000 }],
    }),
    item({
      class_id: 3,
      class_key: "cripto",
      class_name: "Cripto",
      current_cents: 30_000,
      current_bps: 3000,
      target_bps: 2000,
      effective_target_bps: 2857,
      hold_status: "partial",
      diff_cents: 10_000,
      held_assets: [{ asset_id: 5, name: "ETH", current_cents: 1_000 }],
    }),
  ],
};

/** AAAA-MM-DD de `days` dias atrás, em calendário local (como a tela decide "hoje"). */
function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return todayISO(d);
}

const asset = (patch: Partial<Asset>): Asset =>
  ({
    id: 1,
    name: "CDB Banco X",
    class_key: "rf",
    class_name: "Renda fixa",
    institution_name: "Banco X",
    archived: false,
    purpose: null,
    invested_cents: 35_000,
    current_cents: 40_000,
    valuation_date: daysAgo(1),
    ...patch,
  }) as Asset;

const assets: Asset[] = [
  asset({}),
  asset({ id: 9, name: "PETR4", class_key: "rv", class_name: "Renda variável", institution_name: "Corretora Y", invested_cents: 25_000, current_cents: 30_000 }),
  asset({ id: 5, name: "ETH", class_key: "cripto", class_name: "Cripto", institution_name: "Exchange Z", invested_cents: 900, current_cents: 1_000 }),
];

const summary = {
  assets_count: 3,
  total_current_cents: 101_000,
  total_invested_cents: 80_000,
  return_bps: 2625,
  investments_current_cents: 100_000,
  reserve_current_cents: 1_000,
  reserve_invested_cents: 900,
  proventos_cents: 4_200,
  cash_cents: 0,
  by_class: [],
  by_type: [],
  fii_segments: [],
  by_institution: [],
};

function renderTab(options: { data?: Comparison; assets?: Asset[]; summary?: Record<string, unknown> } = {}) {
  const data = options.data ?? comparison;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.endsWith("/allocation/comparison")) return json(data);
      if (url.endsWith("/portfolio/summary")) return json(options.summary ?? summary);
      if (url.includes("/assets")) return json(options.assets ?? assets);
      if (url.endsWith("/reserve")) return json({ goal_cents: 0 });
      return new Response(JSON.stringify({ detail: "não usado" }), { status: 404 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SummaryTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const detailsOf = (name: string) => screen.getByText(name, { selector: "span" }).closest("details")!;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Carteira > Resumo: totais", () => {
  it("mostra patrimônio atual, investido, rendimento e proventos recebidos, cada um com seu rótulo", async () => {
    renderTab();
    const totals = await screen.findByRole("region", { name: "Totais da carteira" });
    await within(totals).findByText("R$ 1.010,00");

    expect(within(totals).getByText("Patrimônio atual").parentElement).toHaveTextContent("R$ 1.010,00");
    expect(within(totals).getByText("Patrimônio atual").parentElement).toHaveTextContent("3 ativos, com R$ 10,00 de reserva");
    expect(within(totals).getByText("Investido").parentElement).toHaveTextContent("R$ 800,00");
    const yield_ = within(totals).getByText("Rendimento").parentElement!;
    expect(yield_).toHaveTextContent("+26,25%");
    expect(yield_).toHaveTextContent("R$ 210,00 a mais que o investido");
    expect(within(totals).getByText("Proventos recebidos").parentElement).toHaveTextContent("R$ 42,00");
  });
});

describe("Carteira > Resumo: carteira por categoria", () => {
  it("cada categoria é recolhível e mostra, fechada, nome, quantidade de ativos, valor e '% · meta %'", async () => {
    renderTab();
    await screen.findByText("Renda fixa", { selector: "span" });

    const rf = detailsOf("Renda fixa");
    expect(rf).not.toHaveAttribute("open");
    const summaryLine = within(rf).getByText("Renda fixa").closest("summary")!;
    expect(summaryLine).toHaveTextContent("1 ativo");
    expect(summaryLine).toHaveTextContent("R$ 400,00");
    expect(summaryLine).toHaveTextContent("40% · meta 71,43%*");
  });

  it("ao abrir, cada ativo aparece num cartão com as colunas 'Valor atual' e 'Investido'", async () => {
    renderTab();
    await screen.findByText("Renda fixa", { selector: "span" });
    const rf = detailsOf("Renda fixa");

    await userEvent.click(within(rf).getByText("Renda fixa").closest("summary")!);
    expect(rf).toHaveAttribute("open");

    const list = within(rf).getByRole("list", { name: "Ativos de Renda fixa" });
    const card = within(list).getByText("CDB Banco X").closest("li")!;
    expect(card).toHaveTextContent("Banco X");
    expect(within(card).getByText("Valor atual").parentElement).toHaveTextContent("R$ 400,00");
    expect(within(card).getByText("Investido").parentElement).toHaveTextContent("R$ 350,00");
    expect(within(rf).getByRole("link", { name: "Ver e editar os ativos de Renda fixa" })).toHaveAttribute(
      "href",
      "/carteira/ativos?categoria=rf",
    );
  });

  it("o ativo da reserva leva o selo 'Reserva' e a categoria avisa que o valor dela não o conta", async () => {
    renderTab({ assets: [...assets, asset({ id: 20, name: "Cofrinho", purpose: "reserva", current_cents: 5_000, invested_cents: 5_000 })] });
    await screen.findByText("Renda fixa", { selector: "span" });
    const rf = detailsOf("Renda fixa");
    await userEvent.click(within(rf).getByText("Renda fixa").closest("summary")!);

    const card = within(rf).getByText("Cofrinho").closest("li")!;
    expect(within(card).getByText("Reserva")).toBeInTheDocument();
    expect(within(rf).getByText(/não contam o ativo da reserva de emergência/)).toBeInTheDocument();
  });

  it("meta ajustada leva asterisco e a nota explica o motivo", async () => {
    renderTab();
    await screen.findByText("Renda fixa", { selector: "span" });
    expect(
      screen.getByText("Renda fixa: meta 50%, ajustada para 71,43% porque Renda variável está toda mantida (equivale a 50% da carteira toda)."),
    ).toBeInTheDocument();
  });

  it("diz quanto falta ou sobra em reais, por extenso", async () => {
    renderTab();
    await screen.findByText("Renda fixa", { selector: "span" });
    expect(within(detailsOf("Renda fixa")).getByText("Renda fixa").closest("summary")).toHaveTextContent(/falta R\$\s100,00/);
    expect(within(detailsOf("Cripto")).getByText("Cripto").closest("summary")).toHaveTextContent(/sobra R\$\s100,00/);
  });

  it("categoria toda mantida: selo, meta suspensa e nada de falta/sobra; parcialmente mantida nomeia o ativo", async () => {
    renderTab();
    await screen.findByText("Renda variável", { selector: "span" });

    const rv = within(detailsOf("Renda variável")).getByText("Renda variável").closest("summary")!;
    expect(within(rv).getByText("Mantida: meta suspensa")).toBeInTheDocument();
    expect(rv).toHaveTextContent("30%");
    expect(rv).not.toHaveTextContent(/meta \d|falta|sobra/);

    expect(within(detailsOf("Cripto")).getByText("Cripto").closest("summary")).toHaveTextContent("ETH mantido");
  });

  it("aviso somente leitura lista as categorias com ativos mantidos", async () => {
    renderTab();
    const notice = (await screen.findByRole("heading", { name: /Ativos mantidos/ })).closest("section")!;
    expect(within(notice).getByText(/todos os ativos mantidos \(PETR4\)/)).toBeInTheDocument();
    expect(within(notice).getByRole("link", { name: "Ver ativos de Renda variável na Carteira" })).toBeInTheDocument();
  });

  it("sem investimentos, convida a cadastrar o primeiro ativo", async () => {
    renderTab({ data: { ...comparison, total_cents: 0, items: [] }, assets: [] });
    expect(await screen.findByText(/Cadastre ativos para ver a carteira por categoria/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cadastrar ativo" })).toHaveAttribute("href", "/carteira/ativos?novo=1");
  });
});

describe("Carteira > Resumo: saldos em dia?", () => {
  it("com tudo atualizado, diz a última atualização e que está em dia", async () => {
    renderTab();
    const card = (await screen.findByRole("heading", { name: "Saldos em dia?" })).closest("section")!;
    expect(await within(card).findByText("Em dia")).toBeInTheDocument();
    expect(card).toHaveTextContent("Última atualização:");
    expect(within(card).queryByRole("link", { name: "Atualizar agora" })).not.toBeInTheDocument();
  });

  it("avisa, nomeando os ativos, quando há saldo com mais de 10 dias, e leva a atualizar", async () => {
    renderTab({
      assets: [
        asset({ id: 1, name: "CDB Banco X", valuation_date: daysAgo(12) }),
        asset({ id: 2, name: "Tesouro Selic", institution_name: "Tesouro", valuation_date: daysAgo(30) }),
        asset({ id: 3, name: "Em dia", valuation_date: daysAgo(2) }),
      ],
    });
    const card = (await screen.findByRole("heading", { name: "Saldos em dia?" })).closest("section")!;
    const alert = (await within(card).findByText(/sem saldo novo há mais de 10 dias/)).closest("[role=status]")!;
    expect(alert).toHaveTextContent("2 ativos estão sem saldo novo há mais de 10 dias");
    expect(alert).toHaveTextContent("Tesouro Selic · Tesouro, há 30 dias");
    expect(alert).toHaveTextContent("CDB Banco X · Banco X, há 12 dias");
    expect(alert).not.toHaveTextContent("Em dia");
    expect(within(card).getByRole("link", { name: "Atualizar agora" })).toHaveAttribute("href", "/carteira/atualizar");
  });
});
