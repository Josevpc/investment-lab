import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    tax_exempt: false,
    ir_rate_bps: null,
    net_cdi_bps: null,
    net_pct_of_cdi_bps: null,
    ir_rates_source: "",
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
    usd_bps: null,
    vs_usd_bps: null,
    usd_covered_through: null,
    ...overrides,
  };
}

function renderCard(assets: AssetVsCdiResult[]) {
  const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify(assets), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AssetsVsCdiCard range="all" />
    </QueryClientProvider>,
  );
  return fetchMock;
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  vi.unstubAllGlobals();
});

const variableTable = async () => screen.findByRole("table", { name: /renda variável contra o CDI e contra o Ibovespa/ });
const cryptoTable = async () => screen.findByRole("table", { name: /cripto contra o CDI e contra o dólar/ });

const bitcoin = (overrides: Partial<AssetVsCdiResult> = {}) =>
  asset({
    asset_id: 2,
    asset_name: "Bitcoin",
    class_key: "cripto",
    return_bps: 1500,
    cdi_bps: 520,
    ibovespa_bps: null,
    vs_ibovespa_bps: null,
    ibovespa_covered_through: "2026-10-16",
    usd_bps: 400,
    vs_usd_bps: 1100,
    usd_covered_through: "2026-10-15",
    ...overrides,
  });

const SOURCE = "Tabela regressiva do IR na renda fixa (Lei 11.033/2004), conferida em 06/11/2026.";

const fixed = (overrides: Partial<AssetVsCdiResult>) =>
  asset({
    class_key: "renda_fixa",
    asset_type: null,
    indexer: "CDI",
    pct_of_cdi_bps: 11_800,
    ir_rate_bps: 1500,
    net_cdi_bps: 442,
    net_pct_of_cdi_bps: 10_300,
    ir_rates_source: SOURCE,
    ibovespa_bps: null,
    vs_ibovespa_bps: null,
    ...overrides,
  });

const exempt = (overrides: Partial<AssetVsCdiResult>) =>
  fixed({ tax_exempt: true, asset_name: "LCI Banco Y", net_pct_of_cdi_bps: 9_200, pct_of_cdi_bps: 9_200, ...overrides });

const fixedTable = async () => screen.findByRole("table", { name: /Rendimento de cada ativo de renda fixa/ });
const rowOf = (table: HTMLElement, name: RegExp) => within(table).getByRole("row", { name });

describe("Renda fixa frente ao CDI: isentos e tributados", () => {
  it("separa em dois grupos, Isentos de IR e Tributados, cada ativo no seu", async () => {
    renderCard([
      fixed({ asset_id: 1, asset_name: "Tesouro Reserva" }),
      exempt({ asset_id: 2 }),
      fixed({ asset_id: 3, asset_name: "CDB Banco X" }),
    ]);

    const table = await fixedTable();
    const groups = Array.from(table.querySelectorAll('th[scope="rowgroup"]'));
    expect(groups.map((g) => g.textContent)).toEqual(["Isentos de IR", "Tributados"]);

    const bodies = table.querySelectorAll("tbody");
    expect(bodies).toHaveLength(2);
    expect(within(bodies[0] as HTMLElement).getByText("LCI Banco Y")).toBeInTheDocument();
    expect(within(bodies[1] as HTMLElement).getByText("Tesouro Reserva")).toBeInTheDocument();
    expect(within(bodies[1] as HTMLElement).getByText("CDB Banco X")).toBeInTheDocument();
  });

  it("a coluna % do CDI líquido está em destaque, logo depois do ativo (aparece no celular sem rolar)", async () => {
    renderCard([fixed({ asset_id: 1, asset_name: "Tesouro Reserva" }), exempt({ asset_id: 2 })]);

    const table = await fixedTable();
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Ativo", "% do CDI líquido", "Período", "Rendimento", "CDI no período", "% do CDI", "Contratado"]);
  });

  it("isento: selo, 'sem IR' e o % do CDI líquido", async () => {
    renderCard([fixed({ asset_id: 1, asset_name: "Tesouro Reserva" }), exempt({ asset_id: 2 })]);

    const row = rowOf(await fixedTable(), /LCI Banco Y/);
    expect(within(row).getByText("Isento de IR")).toBeInTheDocument();
    expect(within(row).getAllByText("92%")).toHaveLength(2); // sem IR, o % do CDI e o líquido coincidem
    expect(within(row).getByText("sem IR")).toBeInTheDocument();
  });

  it("tributado com saldo bruto: diz a alíquota usada e mostra o CDI líquido do período", async () => {
    renderCard([fixed({ asset_id: 1, asset_name: "Tesouro Reserva" }), exempt({ asset_id: 2 })]);

    const row = rowOf(await fixedTable(), /Tesouro Reserva/);
    expect(within(row).getByText("saldo bruto")).toBeInTheDocument();
    expect(within(row).getByText("118%")).toBeInTheDocument(); // % do CDI como está no saldo
    expect(within(row).getByText("103%")).toBeInTheDocument(); // % do CDI líquido
    expect(within(row).getByText("IR de 15%")).toBeInTheDocument();
    expect(within(row).getByText("CDI líquido +4,42%")).toBeInTheDocument();
  });

  it("tributado com saldo já líquido: não desconta de novo e diz isso", async () => {
    renderCard([fixed({ asset_id: 1, asset_name: "Caixinha", balance_is_net: true }), exempt({ asset_id: 2 })]);

    const row = rowOf(await fixedTable(), /Caixinha/);
    expect(within(row).getByText("saldo líquido de IR")).toBeInTheDocument();
    expect(within(row).getByText("saldo já líquido")).toBeInTheDocument();
    expect(within(row).queryByText(/IR de 15%/)).not.toBeInTheDocument();
  });

  it("com isentos e tributados, a nota manda comparar pela coluna líquida e diz que é simulação", async () => {
    renderCard([fixed({ asset_id: 1, asset_name: "Tesouro Reserva" }), exempt({ asset_id: 2 })]);

    await fixedTable();
    expect(
      screen.getByText(
        "Para comparar isentos e tributados, use a coluna % do CDI líquido. É uma simulação com a alíquota escolhida; o app não calcula o IR devido.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/mistura saldos/)).not.toBeInTheDocument();
  });

  it("saldo bruto e saldo líquido juntos também ganham a nota", async () => {
    renderCard([fixed({ asset_id: 1, asset_name: "Tesouro Reserva" }), fixed({ asset_id: 2, asset_name: "Caixinha", balance_is_net: true })]);
    await fixedTable();
    expect(screen.getByText(/Para comparar isentos e tributados, use a coluna/)).toBeInTheDocument();
  });

  it("só tributados com o mesmo tipo de saldo: sem grupos, sem nota, com a dica de marcar os isentos", async () => {
    renderCard([fixed({ asset_id: 1, asset_name: "Tesouro Reserva" }), fixed({ asset_id: 2, asset_name: "CDB" })]);

    const table = await fixedTable();
    expect(within(table).queryByText("Tributados")).not.toBeInTheDocument();
    expect(within(table).queryByText("Isentos de IR")).not.toBeInTheDocument();
    expect(screen.queryByText(/Para comparar isentos e tributados/)).not.toBeInTheDocument();
    expect(screen.getByText(/Marque os isentos em Carteira → editar ativo/)).toBeInTheDocument();
  });

  it("só isentos: sem cabeçalho de grupo e sem a dica de marcar", async () => {
    renderCard([exempt({ asset_id: 1 }), exempt({ asset_id: 2, asset_name: "LCA Banco Z" })]);

    const table = await fixedTable();
    expect(table.querySelector('th[scope="rowgroup"]')).toBeNull();
    expect(screen.queryByText(/Marque os isentos/)).not.toBeInTheDocument();
    expect(within(rowOf(table, /LCA Banco Z/)).getByText("Isento de IR")).toBeInTheDocument();
  });

  it("um ativo de fora da medição não entra nos grupos nem na nota", async () => {
    renderCard([
      fixed({ asset_id: 1, asset_name: "Tesouro Reserva" }),
      exempt({ asset_id: 2, pct_of_cdi_bps: null, net_pct_of_cdi_bps: null }),
    ]);

    const table = await fixedTable();
    expect(within(table).queryByText("LCI Banco Y")).not.toBeInTheDocument();
    expect(table.querySelector('th[scope="rowgroup"]')).toBeNull();
    expect(screen.queryByText(/Para comparar isentos e tributados/)).not.toBeInTheDocument();
    expect(screen.getByText("1 ativo ficou de fora por falta de saldos no período.")).toBeInTheDocument();
  });

  it("mostra a fonte da tabela regressiva com a data", async () => {
    renderCard([fixed({ asset_id: 1 })]);
    await fixedTable();
    expect(
      screen.getByText(/Fonte: Tabela regressiva do IR na renda fixa \(Lei 11\.033\/2004\), conferida em 06\/11\/2026\./),
    ).toBeInTheDocument();
  });

  it("sem nenhum ativo medido: explica o que falta e não mostra seletor nem tabela", async () => {
    renderCard([]);

    expect(await screen.findByText("Ainda não há dois saldos de um mesmo ativo de renda fixa para medir o rendimento.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /Rendimento de cada ativo de renda fixa/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Alíquota de IR para comparar")).not.toBeInTheDocument();
  });

  it("enquanto carrega, mostra o estado de carregamento", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AssetsVsCdiCard range="all" />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Carregando");
  });

  it("se a API falha, mostra o erro em vez de uma tabela vazia", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "Não deu para calcular." }), { status: 500 })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AssetsVsCdiCard range="all" />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Não deu para calcular.");
  });
});

describe("Renda fixa frente ao CDI: alíquota de IR", () => {
  const select = () => screen.getByRole("combobox", { name: "Alíquota de IR para comparar" });
  const rateOf = (fetchMock: ReturnType<typeof renderCard>, call = -1) =>
    new URL(fetchMock.mock.calls.at(call)![0], "http://app").searchParams.get("ir_rate_bps");

  it("vem em 15% e já pede essa alíquota à API", async () => {
    const fetchMock = renderCard([fixed({ asset_id: 1 })]);
    await fixedTable();
    expect(select()).toHaveValue("1500");
    expect(rateOf(fetchMock)).toBe("1500");
  });

  it("trocar a alíquota busca de novo com ela e guarda a escolha no navegador", async () => {
    const fetchMock = renderCard([fixed({ asset_id: 1 })]);
    await fixedTable();
    await userEvent.setup().selectOptions(select(), "2250");

    await waitFor(() => expect(rateOf(fetchMock)).toBe("2250"));
    expect(localStorage.getItem("il-ir-rate")).toBe("2250");
  });

  it("lembra a escolha da última vez", async () => {
    localStorage.setItem("il-ir-rate", "1750");
    const fetchMock = renderCard([fixed({ asset_id: 1 })]);
    await fixedTable();
    expect(select()).toHaveValue("1750");
    expect(rateOf(fetchMock, 0)).toBe("1750");
  });
});

describe("Renda variável frente ao CDI e ao Ibovespa", () => {
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
    expect(screen.getByText(/referência da bolsa brasileira; para ativos no exterior/)).toBeInTheDocument();
  });

  it("sem Ibovespa baixado: traço nas colunas e um aviso só, que diz onde atualizar", async () => {
    renderCard([
      asset({ ibovespa_bps: null, vs_ibovespa_bps: null, ibovespa_covered_through: null }),
      asset({ asset_id: 3, asset_name: "IVVB11", ibovespa_bps: null, vs_ibovespa_bps: null, ibovespa_covered_through: null }),
    ]);

    const table = await variableTable();
    const row = within(table).getByRole("row", { name: /IVVB11/ });
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getAllByText("Ainda não há dados do Ibovespa. Atualize os índices em Configurações → Dados e proteção."),
    ).toHaveLength(1);
  });

  it("com Ibovespa desatualizado: traço só onde falta e aviso com a última data", async () => {
    renderCard([
      asset({ end_date: "2026-08-28", ibovespa_covered_through: "2026-08-29" }),
      asset({ asset_id: 3, asset_name: "IVVB11", ibovespa_bps: null, vs_ibovespa_bps: null, ibovespa_covered_through: "2026-08-29" }),
    ]);

    const table = await variableTable();
    expect(within(within(table).getByRole("row", { name: /BOVA11/ })).getByText("+2 p.p.")).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /IVVB11/ })).toHaveTextContent("—");
    expect(screen.getByText("O Ibovespa só vai até 29/08/2026; atualize os índices.")).toBeInTheDocument();
    expect(screen.queryByText(/Ainda não há dados do Ibovespa/)).not.toBeInTheDocument();
  });

  it("a cripto não entra na tabela do Ibovespa", async () => {
    renderCard([asset({}), bitcoin()]);

    const table = await variableTable();
    expect(within(table).getByRole("row", { name: /BOVA11/ })).toBeInTheDocument();
    expect(within(table).queryByRole("row", { name: /Bitcoin/ })).not.toBeInTheDocument();
  });

  it("sem renda variável, o cartão do Ibovespa nem aparece", async () => {
    renderCard([bitcoin()]);
    await cryptoTable();
    expect(screen.queryByRole("table", { name: /renda variável contra o CDI/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Renda variável frente ao CDI e ao Ibovespa")).not.toBeInTheDocument();
  });
});

describe("Cripto frente ao CDI e ao dólar", () => {
  it("completo: o dólar no lugar do Ibovespa, com a diferença em p.p. e sem aviso", async () => {
    renderCard([bitcoin()]);

    const table = await cryptoTable();
    expect(within(table).getByRole("columnheader", { name: "Dólar no período" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Diferença vs. dólar" })).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: /Ibovespa/ })).not.toBeInTheDocument();

    const row = within(table).getByRole("row", { name: /Bitcoin/ });
    expect(within(row).getByText("+4%")).toBeInTheDocument();
    expect(within(row).getByText("+11 p.p.")).toBeInTheDocument();
    expect(screen.queryByText(/dólar só vai até|Ainda não há dados do dólar/)).not.toBeInTheDocument();
  });

  it("diz o limite: sem a cotação de cada moeda não separa cripto de câmbio", async () => {
    renderCard([bitcoin()]);
    await cryptoTable();
    expect(
      screen.getByText("Sem a cotação em dólar de cada moeda, não dá para separar o que veio da cripto do que veio do câmbio."),
    ).toBeInTheDocument();
  });

  it("sem dólar baixado: traço e um aviso só, que diz onde atualizar", async () => {
    renderCard([
      bitcoin({ usd_bps: null, vs_usd_bps: null, usd_covered_through: null }),
      bitcoin({ asset_id: 4, asset_name: "Ether", usd_bps: null, vs_usd_bps: null, usd_covered_through: null }),
    ]);

    const table = await cryptoTable();
    expect(within(within(table).getByRole("row", { name: /Ether/ })).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Ainda não há dados do dólar. Atualize os índices em Configurações → Dados e proteção.")).toHaveLength(1);
  });

  it("com dólar desatualizado: traço só onde falta e aviso com a última data", async () => {
    renderCard([bitcoin(), bitcoin({ asset_id: 4, asset_name: "Ether", usd_bps: null, vs_usd_bps: null, usd_covered_through: "2026-08-29" })]);

    const table = await cryptoTable();
    expect(within(within(table).getByRole("row", { name: /Bitcoin/ })).getByText("+11 p.p.")).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /Ether/ })).toHaveTextContent("—");
    expect(screen.getByText("O dólar só vai até 15/10/2026; atualize os índices.")).toBeInTheDocument();
  });

  it("renda fixa não aparece em nenhuma das tabelas de mercado", async () => {
    renderCard([fixed({ asset_id: 1, asset_name: "Tesouro Reserva" }), bitcoin()]);

    const table = await cryptoTable();
    expect(within(table).queryByText("Tesouro Reserva")).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /renda variável contra o CDI/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Ibovespa/)).not.toBeInTheDocument();
  });
});
