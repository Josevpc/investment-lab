import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetVsCdi as AssetVsCdiData } from "../types";
import { AssetVsCdi } from "./AssetVsCdi";

function data(overrides: Partial<AssetVsCdiData>): AssetVsCdiData {
  return {
    asset_id: 7,
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
    method: "Saldo final menos saldo inicial e aportes.",
    cdi_covered_through: "2026-09-30",
    ibovespa_bps: 600,
    vs_ibovespa_bps: 200,
    ibovespa_covered_through: "2026-10-16",
    ...overrides,
  };
}

function renderMetric(payload: AssetVsCdiData) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AssetVsCdi assetId={payload.asset_id} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const step = (start_date: string, end_date: string, return_bps: number | null, cdi_bps: number | null, pct_of_cdi_bps: number | null) => ({
  start_date,
  end_date,
  start_cents: 1_000_000,
  end_cents: 1_000_000,
  flows_cents: 0,
  yield_cents: 10_000,
  return_bps,
  cdi_bps,
  pct_of_cdi_bps,
});

const steps = [
  step("2026-03-31", "2026-06-30", -300, 100, -30_000),
  step("2026-06-30", "2026-09-30", 500, 200, 25_000),
  step("2026-09-30", "2026-10-15", 50, null, null),
];

describe("Saldo bruto ou líquido de IR (detalhe do ativo)", () => {
  const fixedIncome = (overrides: Partial<AssetVsCdiData>) =>
    data({ class_key: "renda_fixa", asset_type: null, indexer: "CDI", pct_of_cdi_bps: 11_800, contracted_pct_bps: 12_000, vs_contracted_bps: -200, ibovespa_bps: null, vs_ibovespa_bps: null, ...overrides });

  it("saldo líquido: explica que o % do CDI não é comparável ao de um ativo bruto", async () => {
    renderMetric(fixedIncome({ balance_is_net: true }));
    expect(await screen.findByText(/já vem sem o IR/)).toBeInTheDocument();
    expect(screen.getByText(/não é comparável ao de um ativo com saldo bruto/)).toBeInTheDocument();
  });

  it("saldo bruto: sem aviso", async () => {
    renderMetric(fixedIncome({ balance_is_net: false }));
    expect(await screen.findByText("% do CDI realizado")).toBeInTheDocument();
    expect(screen.queryByText(/já vem sem o IR/)).not.toBeInTheDocument();
  });
});

describe("Tabela por intervalo (detalhe do ativo)", () => {
  it("renda variável: variação e diferença em p.p., sem \"% do CDI\"", async () => {
    renderMetric(data({ steps }));
    const table = await screen.findByRole("table", { name: "Por intervalo" });
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Intervalo", "Rendimento", "Variação", "CDI", "Contra o CDI"]);
    expect(within(table).queryByText(/% do CDI/)).not.toBeInTheDocument();
    expect(within(table).queryByText(/-300%|−300%/)).not.toBeInTheDocument();

    const first = within(table).getByRole("row", { name: /31\/03\/2026 → 30\/06\/2026/ });
    expect(first).toHaveTextContent("-4 p.p."); // −3% contra CDI +1%: o sinal negativo aparece
    const second = within(table).getByRole("row", { name: /30\/06\/2026 → 30\/09\/2026/ });
    expect(second).toHaveTextContent("+5%");
    expect(second).toHaveTextContent("+3 p.p.");
    // Sem CDI no intervalo, a diferença fica em branco em vez de inventar número.
    const third = within(table).getByRole("row", { name: /30\/09\/2026 → 15\/10\/2026/ });
    expect(third).not.toHaveTextContent("p.p.");
    expect(third).toHaveTextContent("—");
  });

  it("no celular, \"Contra o CDI\" segue como coluna e o resto desce para sob o intervalo", async () => {
    renderMetric(data({ steps }));
    const table = await screen.findByRole("table", { name: "Por intervalo" });
    // Se ainda assim não couber, a rolagem fica num quadro que se alcança pelo teclado.
    expect(screen.getByRole("region", { name: "Rendimento por intervalo" })).toHaveAttribute("tabindex", "0");

    const header = (name: string) => within(table).getByRole("columnheader", { name });
    expect(header("Contra o CDI")).not.toHaveClass("hidden");
    for (const name of ["Rendimento", "Variação", "CDI"]) expect(header(name)).toHaveClass("hidden", "sm:table-cell");

    const interval = within(table).getByRole("rowheader", { name: /30\/06\/2026 → 30\/09\/2026/ });
    expect(interval).toHaveTextContent("Variação +5% · CDI +2%");
    expect(interval).toHaveTextContent("Rendimento R$ 100,00"); // o matcher já trata o espaço não separável do Intl
  });

  it("renda fixa: mantém \"% do CDI\"", async () => {
    renderMetric(data({ class_key: "renda_fixa", pct_of_cdi_bps: 11_000, ibovespa_bps: null, vs_ibovespa_bps: null, steps }));
    const table = await screen.findByRole("table", { name: "Por intervalo" });
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Intervalo", "Rendimento", "CDI", "% do CDI"]);
    expect(within(table).queryByText(/p\.p\./)).not.toBeInTheDocument();
  });
});

const ibovespaCard = async () => (await screen.findByText("Variação contra o Ibovespa")).parentElement!;

describe("Variação contra o Ibovespa (detalhe do ativo)", () => {
  it("completo: diferença em p.p. e a conta explicada", async () => {
    renderMetric(data({}));
    const card = await ibovespaCard();
    expect(card).toHaveTextContent("+2 p.p.");
    expect(card).toHaveTextContent("variação +8% contra Ibovespa +6%");
  });

  it("sem dados: traço e onde atualizar", async () => {
    renderMetric(data({ ibovespa_bps: null, vs_ibovespa_bps: null, ibovespa_covered_through: null }));
    const card = await ibovespaCard();
    expect(card).toHaveTextContent("—");
    expect(card).toHaveTextContent("Ainda não há dados do Ibovespa. Atualize os índices em Configurações → Dados e proteção.");
  });

  it("parcial: traço e até que dia o índice vai", async () => {
    renderMetric(data({ ibovespa_bps: null, vs_ibovespa_bps: null, ibovespa_covered_through: "2026-08-29" }));
    const card = await ibovespaCard();
    expect(card).toHaveTextContent("O Ibovespa só vai até 29/08/2026; atualize os índices.");
  });

  it("renda fixa não mostra o Ibovespa", async () => {
    renderMetric(data({ class_key: "renda_fixa", pct_of_cdi_bps: 11_000, ibovespa_bps: null, vs_ibovespa_bps: null }));
    await screen.findByText("% do CDI realizado");
    expect(screen.queryByText("Variação contra o Ibovespa")).not.toBeInTheDocument();
  });
});

describe("Entradas e saídas do período (detalhe do ativo)", () => {
  it("rotula o resgate como Resgate, com o valor que saiu", async () => {
    renderMetric(data({ flows: [{ date: "2026-08-10", kind: "resgate", cents: -10_000 }], flows_cents: -10_000 }));
    const item = (await screen.findByText(/^Resgate/)).closest("li")!;
    expect(item).toHaveTextContent("em 10/08/2026");
    expect((item.textContent ?? "").replace(/\s/g, " ")).toContain("-R$ 100,00");
  });
});
