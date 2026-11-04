import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Performance } from "@/features/analytics";
import { PerformanceTab } from "./PerformanceTab";

// O gráfico depende de medidas de tela que o jsdom não tem; a tabela cobre os mesmos números.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

const classes = [
  { id: 1, key: "renda_fixa", name: "Renda fixa", color: "#000", archived: false },
  { id: 2, key: "renda_variavel", name: "Renda variável", color: "#000", archived: false },
];

function performance(overrides: Partial<Performance> = {}): Performance {
  return {
    scope: "total",
    scope_label: "Carteira total",
    include_reserve: false,
    observations_count: 2,
    points: [
      { date: "2026-08-31", value_cents: 1_000_000, flows_cents: 0, portfolio_bps: 0, cdi_bps: 0, ibovespa_bps: 0 },
      { date: "2026-09-30", value_cents: 1_165_000, flows_cents: 150_000, portfolio_bps: 150, cdi_bps: 90, ibovespa_bps: 320 },
    ],
    summary: {
      start_date: "2026-08-31",
      end_date: "2026-09-30",
      portfolio_bps: 150,
      cdi_bps: 90,
      vs_cdi_bps: 60,
      ibovespa_bps: 320,
      vs_ibovespa_bps: -170,
      flows_cents: 150_000,
    },
    method: "Retorno ponderado pelo tempo, pelas datas dos saldos.",
    warnings: [],
    stale_assets: [],
    benchmark_source: "Banco Central (SGS)",
    benchmark_updated_at: "2026-10-01T09:00:00",
    cdi_covered_through: "2026-09-30",
    ibovespa_covered_through: "2026-10-16",
    ibovespa_source: "B3 (Ibovespa)",
    ...overrides,
  };
}

function renderTab(data: Performance) {
  return renderTabWithUnmount(data).calls;
}

function renderTabWithUnmount(data: Performance) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/asset-classes")) return new Response(JSON.stringify(classes), { status: 200 });
      const scope = new URL(url, "http://x").searchParams.get("scope") ?? "total";
      const label = classes.find((c) => c.key === scope)?.name ?? "Carteira total";
      return new Response(JSON.stringify({ ...data, scope, scope_label: label }), { status: 200 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PerformanceTab range="all" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { calls, unmount };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Sua carteira vs. mercado com o Ibovespa", () => {
  it("começa sem o Ibovespa na carteira total, liga sozinho na renda variável e desliga na renda fixa", async () => {
    const user = userEvent.setup();
    renderTab(performance());

    await screen.findByText("Diferença vs. CDI");
    const ibovespa = screen.getByRole("checkbox", { name: "Ibovespa" });
    expect(ibovespa).not.toBeChecked();
    expect(screen.queryByText("Diferença vs. Ibovespa")).not.toBeInTheDocument();

    const scope = await screen.findByRole("combobox", { name: /Escopo/ });
    await screen.findByRole("option", { name: "Renda variável" });
    await user.selectOptions(scope, "renda_variavel");
    expect(screen.getByRole("checkbox", { name: "Ibovespa" })).toBeChecked();

    await user.selectOptions(scope, "renda_fixa");
    expect(screen.getByRole("checkbox", { name: "Ibovespa" })).not.toBeChecked();
  });

  it("ligado à mão em qualquer escopo: métricas, coluna na tabela, metodologia e fonte com a data", async () => {
    const user = userEvent.setup();
    renderTab(performance());

    await user.click(await screen.findByRole("checkbox", { name: "Ibovespa" }));

    expect(screen.getByText("Diferença vs. Ibovespa")).toBeInTheDocument();
    expect(screen.getByText("-1,7 p.p.")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: /CDI e Ibovespa/ });
    expect(within(table).getByRole("columnheader", { name: "Retorno: Ibovespa" })).toBeInTheDocument();
    expect(within(within(table).getByRole("row", { name: /30\/09\/2026/ })).getByText("+3,2%")).toBeInTheDocument();
    expect(screen.getByText("Ibovespa: B3 (Ibovespa), dados até 16/10/2026.")).toBeInTheDocument();
    expect(screen.queryByText(/Ainda não há dados do Ibovespa/)).not.toBeInTheDocument();
  });

  it("sem Ibovespa baixado: traço nas métricas e aviso de onde atualizar, só com a série ligada", async () => {
    const user = userEvent.setup();
    renderTab(
      performance({
        points: performance().points.map((point) => ({ ...point, ibovespa_bps: null })),
        summary: { ...performance().summary, ibovespa_bps: null, vs_ibovespa_bps: null },
        ibovespa_covered_through: null,
        ibovespa_source: null,
      }),
    );

    await screen.findByText("Diferença vs. CDI");
    const message = "Ainda não há dados do Ibovespa. Atualize os índices em Configurações → Dados e proteção.";
    expect(screen.queryByText(message)).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Ibovespa" }));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByText("Diferença vs. Ibovespa").parentElement).toHaveTextContent("—");
    expect(screen.getByText(/Ibovespa: ainda não baixado/)).toBeInTheDocument();
  });

  it("com Ibovespa desatualizado: usa o aviso do back-end sem repetir o nosso e o esconde com a série desligada", async () => {
    const user = userEvent.setup();
    const warning = "O Ibovespa só vai até 29/08/2026; o último fechamento ficou sem comparação.";
    renderTab(
      performance({
        points: [performance().points[0], { ...performance().points[1], ibovespa_bps: null }],
        summary: { ...performance().summary, ibovespa_bps: null, vs_ibovespa_bps: null },
        warnings: [warning],
        ibovespa_covered_through: "2026-08-29",
      }),
    );

    await screen.findByText("Diferença vs. CDI");
    expect(screen.queryByText(warning)).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Ibovespa" }));
    expect(screen.getByText(warning)).toBeInTheDocument();
    expect(screen.queryByText(/atualize os índices\.$/)).not.toBeInTheDocument();
    expect(screen.getByText("Ibovespa: B3 (Ibovespa), dados até 29/08/2026.")).toBeInTheDocument();
  });
});

describe("Sua carteira vs. mercado a partir dos saldos digitados", () => {
  it("não fala de Selic em lugar nenhum: nem opção, nem métrica, nem coluna", async () => {
    renderTab(performance());

    await screen.findByText("Diferença vs. CDI");
    expect(screen.queryByRole("checkbox", { name: "Selic" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Selic/)).not.toBeInTheDocument();
  });

  it("a tabela traz a data, o valor, o fluxo do intervalo (com sinal) e o retorno de cada série", async () => {
    renderTab(performance());

    await screen.findByText("Diferença vs. CDI");
    const table = screen.getByRole("table", { name: /Valor, fluxo e retorno acumulado/ });
    expect(within(table).getByRole("columnheader", { name: "Data do saldo" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Valor da carteira" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Fluxo no intervalo" })).toBeInTheDocument();

    const first = within(table).getByRole("row", { name: /31\/08\/2026/ });
    expect(first).toHaveTextContent(/R\$\s10\.000,00/);
    expect(within(first).getAllByRole("cell")[1]).toHaveTextContent("—");
    const last = within(table).getByRole("row", { name: /30\/09\/2026/ });
    expect(last).toHaveTextContent(/R\$\s11\.650,00/);
    expect(last).toHaveTextContent(/\+\sR\$\s1\.500,00/);
    expect(last).toHaveTextContent("+1,5%");
    expect(last).toHaveTextContent("+0,9%");
  });

  it("resgate aparece com sinal de menos no fluxo do período", async () => {
    renderTab(
      performance({
        points: [performance().points[0], { ...performance().points[1], flows_cents: -20_000 }],
        summary: { ...performance().summary, flows_cents: -20_000 },
      }),
    );

    await screen.findByText("Diferença vs. CDI");
    const metric = screen.getByText("Fluxo no período").parentElement!;
    expect(metric).toHaveTextContent(/−\sR\$\s200,00/);
  });

  it("a nota de mudança de método pode ser dispensada e a escolha fica lembrada", async () => {
    const user = userEvent.setup();
    const { unmount } = renderTabWithUnmount(performance());

    await screen.findByText("Mudou o jeito de calcular.");
    await user.click(screen.getByRole("button", { name: "Entendi" }));
    expect(screen.queryByText("Mudou o jeito de calcular.")).not.toBeInTheDocument();
    // O "Como calculamos" continua à mão depois de dispensar a nota.
    expect(screen.getByText("Como calculamos")).toBeInTheDocument();

    unmount();
    renderTab(performance());
    await screen.findByText("Diferença vs. CDI");
    expect(screen.queryByText("Mudou o jeito de calcular.")).not.toBeInTheDocument();
  });

  it("o valor da coluna se chama pelo escopo: carteira no total, categoria numa categoria", async () => {
    const user = userEvent.setup();
    renderTab(performance());

    await screen.findByText("Diferença vs. CDI");
    expect(screen.getByRole("columnheader", { name: "Valor da carteira" })).toBeInTheDocument();
    await screen.findByRole("option", { name: "Renda fixa" });
    await user.selectOptions(screen.getByRole("combobox", { name: /Escopo/ }), "renda_fixa");
    expect(await screen.findByRole("columnheader", { name: "Valor da categoria" })).toBeInTheDocument();
  });

  it("avisa a mudança de método e mostra o texto de método da API e o CDI até a data exata", async () => {
    renderTab(performance());

    expect(await screen.findByText("Mudou o jeito de calcular.")).toBeInTheDocument();
    expect(screen.getByText(/podem ser diferentes dos que você via antes/)).toBeInTheDocument();
    expect(screen.getByText(/Retorno ponderado pelo tempo, pelas datas dos saldos\./)).toBeInTheDocument();
    expect(screen.getByText(/CDI até 30\/09\/2026\./)).toBeInTheDocument();
  });

  it("avisa de ativos sem atualização e leva para Atualizar saldos", async () => {
    renderTab(
      performance({
        stale_assets: [
          { asset_id: 1, asset_name: "CDB Banco X", last_observed_date: "2026-09-02", days: 28 },
          { asset_id: 2, asset_name: "Tesouro Selic", last_observed_date: "2026-09-29", days: 1 },
        ],
        // O back-end avisa em texto geral; o detalhe por ativo vem só em stale_assets.
        warnings: ["Há ativos sem saldo novo há mais de 10 dias; o desempenho usa o último saldo digitado deles."],
      }),
    );

    expect(await screen.findByText(/CDB Banco X está sem atualização há 28 dias/)).toBeInTheDocument();
    expect(screen.getByText(/Tesouro Selic está sem atualização há 1 dia \(/)).toBeInTheDocument();
    const alert = screen.getByRole("status");
    expect(within(alert).getByRole("link", { name: "Atualizar saldos" })).toHaveAttribute("href", "/carteira/atualizar");
    expect(screen.getByText(/Há ativos sem saldo novo há mais de 10 dias/)).toBeInTheDocument();
  });

  it("sem aviso quando todos os saldos estão em dia", async () => {
    renderTab(performance());

    await screen.findByText("Diferença vs. CDI");
    expect(screen.queryByText(/sem atualização há/)).not.toBeInTheDocument();
  });

  it("com uma data só o back-end devolve 0%: a tela mostra traço, não um resultado", async () => {
    renderTab(
      performance({
        observations_count: 1,
        points: [{ date: "2026-10-31", value_cents: 1_000_000, flows_cents: 0, portfolio_bps: 0, cdi_bps: 0, ibovespa_bps: 0 }],
        summary: { ...performance().summary, start_date: "2026-10-31", end_date: "2026-10-31", portfolio_bps: 0, cdi_bps: 0, vs_cdi_bps: 0, flows_cents: 0 },
        warnings: ["Ainda faltam saldos em duas datas diferentes neste intervalo para comparar o desempenho."],
      }),
    );

    await screen.findByText(/Atualize os saldos em pelo menos duas datas para comparar com o CDI/);
    expect(screen.getByText("Diferença vs. CDI").parentElement).toHaveTextContent("—");
    expect(screen.getByText("mesmas datas").parentElement).toHaveTextContent("—");
    expect(screen.queryByText(/Ainda faltam saldos em duas datas diferentes/)).not.toBeInTheDocument();
  });

  it("com menos de duas datas com saldo, orienta o próximo passo em vez de mostrar um gráfico vazio", async () => {
    renderTab(
      performance({
        observations_count: 1,
        points: [{ date: "2026-09-30", value_cents: 1_000_000, flows_cents: 0, portfolio_bps: null, cdi_bps: null, ibovespa_bps: null }],
        summary: {
          ...performance().summary,
          start_date: null,
          end_date: null,
          portfolio_bps: null,
          cdi_bps: null,
          vs_cdi_bps: null,
          ibovespa_bps: null,
          vs_ibovespa_bps: null,
          flows_cents: 0,
        },
      }),
    );

    expect(await screen.findByText(/Atualize os saldos em pelo menos duas datas para comparar com o CDI/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atualizar saldos" })).toHaveAttribute("href", "/carteira/atualizar");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
