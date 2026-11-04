import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetVsCdiResult } from "@/features/analytics";
import { AssetsVsCdiCard } from "./AssetsVsCdiCard";

function asset(overrides: Partial<AssetVsCdiResult>): AssetVsCdiResult {
  return {
    asset_id: 1,
    asset_name: "BOVA11",
    class_key: "renda_variavel",
    asset_type: "etf",
    indexer: null,
    contracted_pct_bps: null,
    balance_is_net: false,
    dates: ["2026-03-31", "2026-09-30"],
    start_date: "2026-03-31",
    end_date: "2026-09-30",
    start_cents: 1_000_000,
    end_cents: 1_080_000,
    flows: [],
    flows_cents: 0,
    proventos_cents: 0,
    yield_cents: 80_000,
    return_bps: 800,
    cdi_bps: 520,
    pct_of_cdi_bps: null,
    vs_contracted_bps: null,
    steps: [],
    warnings: [],
    method: "",
    cdi_covered_through: "2026-09-30",
    ibovespa_bps: 600,
    vs_ibovespa_bps: 200,
    ibovespa_covered_through: "2026-10-16",
    ...overrides,
  };
}

function renderCard(assets: AssetVsCdiResult[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(assets), { status: 200 })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AssetsVsCdiCard range="all" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const variableTable = async () =>
  screen.findByRole("table", { name: /renda variável e cripto contra o CDI e contra o Ibovespa/ });

const fixed = (overrides: Partial<AssetVsCdiResult>) =>
  asset({ class_key: "renda_fixa", asset_type: null, indexer: "CDI", pct_of_cdi_bps: 11_800, ibovespa_bps: null, vs_ibovespa_bps: null, ...overrides });

const fixedTable = async () => screen.findByRole("table", { name: /Rendimento de cada ativo de renda fixa/ });

describe("Renda fixa frente ao CDI: saldo bruto ou líquido", () => {
  it("diz em cada linha se o saldo é bruto ou líquido de IR", async () => {
    renderCard([
      fixed({ asset_id: 1, asset_name: "Tesouro Reserva", balance_is_net: false }),
      fixed({ asset_id: 2, asset_name: "Caixinha", balance_is_net: true }),
    ]);

    const table = await fixedTable();
    expect(within(within(table).getByRole("row", { name: /Tesouro Reserva/ })).getByText("saldo bruto")).toBeInTheDocument();
    expect(within(within(table).getByRole("row", { name: /Caixinha/ })).getByText("saldo líquido de IR")).toBeInTheDocument();
  });

  it("avisa que não dá para comparar quando a tabela mistura os dois", async () => {
    renderCard([
      fixed({ asset_id: 1, asset_name: "Tesouro Reserva", balance_is_net: false }),
      fixed({ asset_id: 2, asset_name: "Caixinha", balance_is_net: true }),
    ]);

    await fixedTable();
    expect(screen.getByText(/mistura saldos brutos e líquidos de IR/)).toBeInTheDocument();
  });

  it("sem mistura, não avisa", async () => {
    renderCard([
      fixed({ asset_id: 1, asset_name: "Tesouro Reserva", balance_is_net: false }),
      fixed({ asset_id: 2, asset_name: "CDB", balance_is_net: false }),
    ]);

    await fixedTable();
    expect(screen.queryByText(/mistura saldos brutos e líquidos/)).not.toBeInTheDocument();
  });

  it("um ativo de fora da medição não conta para o aviso de mistura", async () => {
    renderCard([
      fixed({ asset_id: 1, asset_name: "Tesouro Reserva", balance_is_net: false }),
      fixed({ asset_id: 2, asset_name: "Caixinha", balance_is_net: true, pct_of_cdi_bps: null }),
    ]);

    await fixedTable();
    expect(screen.queryByText(/mistura saldos brutos e líquidos/)).not.toBeInTheDocument();
  });
});

describe("Renda variável e cripto frente ao CDI e ao Ibovespa", () => {
  it("com Ibovespa completo: mostra o índice e a diferença com sinal e p.p., sem aviso", async () => {
    renderCard([asset({})]);

    const table = await variableTable();
    expect(within(table).getByRole("columnheader", { name: "Diferença vs. CDI" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Ibovespa no período" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Diferença vs. Ibovespa" })).toBeInTheDocument();

    const row = within(table).getByRole("row", { name: /BOVA11/ });
    expect(within(row).getByText("+6%")).toBeInTheDocument();
    expect(within(row).getByText("+2 p.p.")).toBeInTheDocument();
    expect(within(row).getByText("+2,8 p.p.")).toBeInTheDocument(); // 8% − 5,2% do CDI
    expect(screen.queryByText(/Ibovespa só vai até|Ainda não há dados do Ibovespa/)).not.toBeInTheDocument();
    expect(screen.getByText(/referência da bolsa brasileira; para cripto e ativos no exterior/)).toBeInTheDocument();
  });

  it("sem Ibovespa baixado: traço nas colunas e um aviso só, que diz onde atualizar", async () => {
    renderCard([
      asset({ ibovespa_bps: null, vs_ibovespa_bps: null, ibovespa_covered_through: null }),
      asset({ asset_id: 2, asset_name: "Bitcoin", class_key: "cripto", ibovespa_bps: null, vs_ibovespa_bps: null, ibovespa_covered_through: null }),
    ]);

    const table = await variableTable();
    const row = within(table).getByRole("row", { name: /Bitcoin/ });
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getAllByText("Ainda não há dados do Ibovespa. Atualize os índices em Configurações → Dados e proteção."),
    ).toHaveLength(1);
  });

  it("com Ibovespa desatualizado: traço só onde falta e aviso com a última data", async () => {
    renderCard([
      asset({ end_date: "2026-08-28", ibovespa_covered_through: "2026-08-29" }),
      asset({ asset_id: 2, asset_name: "Bitcoin", class_key: "cripto", ibovespa_bps: null, vs_ibovespa_bps: null, ibovespa_covered_through: "2026-08-29" }),
    ]);

    const table = await variableTable();
    expect(within(within(table).getByRole("row", { name: /BOVA11/ })).getByText("+2 p.p.")).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /Bitcoin/ })).toHaveTextContent("—");
    expect(screen.getByText("O Ibovespa só vai até 29/08/2026; atualize os índices.")).toBeInTheDocument();
    expect(screen.queryByText(/Ainda não há dados do Ibovespa/)).not.toBeInTheDocument();
  });
});
