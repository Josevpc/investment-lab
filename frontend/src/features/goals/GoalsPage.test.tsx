import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoalsPage } from "./GoalsPage";

// O gráfico depende de medidas de tela que o jsdom não tem; a tabela cobre os mesmos números.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

const settings = {
  net_worth_goal_cents: 100_000_000,
  year_goal_cents: 5_000_000,
  monthly_cents: 0,
  horizon_years: 20,
  inflation_bps: 450,
  conservative_bps: 600,
  base_bps: 900,
  optimistic_bps: 1_200,
};

const progress = {
  month: "2026-10",
  streak: {
    current: 3,
    best: 5,
    current_month_met: false,
    months: [
      { month: "2026-08", state: "met" },
      { month: "2026-09", state: "met" },
      { month: "2026-10", state: "open" },
    ],
  },
  net_worth: { current_cents: 25_000_000, goal_cents: 100_000_000, remaining_cents: 75_000_000, progress_bps: 2_500, reached: false },
  year: {
    year: 2026,
    goal_cents: 5_000_000,
    status: "ok",
    baseline_date: "2025-12-31",
    last_date: "2026-09-30",
    accumulated_cents: 3_000_000,
    contributions_cents: 2_000_000,
    withdrawals_cents: 0,
    appreciation_cents: 1_000_000,
    remaining_cents: 2_000_000,
    progress_bps: 6_000,
    reached: false,
  },
};

const scenario = (key: string, name: string, bps: number, final: number) => ({
  key,
  name,
  annual_bps: bps,
  final_nominal_cents: final,
  final_today_cents: Math.round(final * 0.6),
  goal_month: key === "otimista" ? "2040-03" : null,
  points: [
    { month: "2026-10", nominal_cents: 25_000_000, today_cents: 25_000_000 },
    { month: "2046-10", nominal_cents: final, today_cents: Math.round(final * 0.6) },
  ],
});

const projection = {
  start_month: "2026-10",
  start_cents: 25_000_000,
  monthly_cents: 150_000,
  monthly_source: "media",
  monthly_considered: 6,
  horizon_years: 20,
  inflation_bps: 450,
  net_worth_goal_cents: 100_000_000,
  goal_basis: "today",
  contributed_cents: 36_000_000,
  scenarios: [
    scenario("conservador", "Conservador", 600, 90_000_000),
    scenario("base", "Base", 900, 120_000_000),
    scenario("otimista", "Otimista", 1_200, 180_000_000),
  ],
};

function mockApi(overrides: { progress?: unknown; projection?: unknown; settings?: typeof settings } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  // Guarda o que foi salvo, para a tela recarregar as metas novas como o back-end faria.
  let saved: unknown = overrides.settings ?? settings;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const method = init?.method ?? "GET";
      if (url.endsWith("/goals/settings")) {
        if (method === "PUT") saved = JSON.parse(String(init!.body));
        return new Response(JSON.stringify(saved), { status: 200 });
      }
      if (url.endsWith("/goals/progress")) return new Response(JSON.stringify(overrides.progress ?? progress), { status: 200 });
      if (url.endsWith("/goals/projection")) return new Response(JSON.stringify(overrides.projection ?? projection), { status: 200 });
      return new Response(JSON.stringify({}), { status: method === "PUT" ? 200 : 404 });
    }),
  );
  return calls;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GoalsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Metas", () => {
  it("mostra a sequência, o que falta para ela crescer e os meses com texto, não só cor", async () => {
    mockApi();
    renderPage();

    expect(await screen.findByText("3 meses")).toBeInTheDocument();
    expect(screen.getByText(/chegar a 4 meses/)).toBeInTheDocument();
    const months = within(screen.getByRole("list", { name: "Últimos meses" })).getAllByRole("listitem");
    expect(months.map((m) => m.getAttribute("aria-label"))).toEqual([
      "agosto: cumprido",
      "setembro: cumprido",
      "outubro: em andamento",
    ]);
  });

  it("mostra o progresso do patrimônio e do ano, separando aporte de valorização", async () => {
    mockApi();
    renderPage();

    const net = await screen.findByRole("progressbar", { name: "Progresso da meta de patrimônio" });
    expect(net).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByRole("progressbar", { name: "Progresso da meta de 2026" })).toHaveAttribute("aria-valuenow", "60");
    expect(screen.getByText("Veio de aportes")).toBeInTheDocument();
    expect(screen.getByText("Veio de valorização")).toBeInTheDocument();
  });

  it("com aportes lançados nos ativos, não fala em estimativa", async () => {
    mockApi({ progress: { ...progress, year: { ...progress.year, contributions_source: "diario", estimated_months: [] } } });
    renderPage();

    expect(await screen.findByText("Veio de valorização")).toBeInTheDocument();
    expect(screen.queryByText("Aportes estimados.")).not.toBeInTheDocument();
    expect(screen.queryByText(/\(estimada\)/)).not.toBeInTheDocument();
  });

  it("API antiga, sem a origem dos aportes, é tratada como aportes lançados", async () => {
    mockApi(); // o `progress` padrão não traz contributions_source nem estimated_months
    renderPage();

    expect(await screen.findByText("Veio de valorização")).toBeInTheDocument();
    expect(screen.queryByText("Aportes estimados.")).not.toBeInTheDocument();
  });

  it("quando parte dos aportes do ano é estimada, avisa quais meses e marca a valorização como estimada", async () => {
    mockApi({
      progress: { ...progress, year: { ...progress.year, contributions_source: "misto", estimated_months: ["2026-02", "2026-03"] } },
    });
    renderPage();

    expect(await screen.findByText("Veio de valorização (estimada)")).toBeInTheDocument();
    const notice = screen.getByText("Aportes estimados.").closest("p");
    expect(notice).toHaveTextContent(
      "Em 2 meses sem aportes lançados nos ativos (fev/2026 e mar/2026), usamos o aporte planejado. Nos demais, os aportes lançados.",
    );
  });

  it("sem base para medir o ano, não mostra aviso de estimativa", async () => {
    mockApi({
      progress: {
        ...progress,
        year: { ...progress.year, status: "sem_base", baseline_date: null, last_date: null, contributions_source: "planejado", estimated_months: ["2026-01"] },
      },
    });
    renderPage();

    expect(await screen.findByText(/Ainda faltam saldos em duas datas para medir o ano/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atualizar saldos" })).toHaveAttribute("href", "/carteira/atualizar");
    expect(screen.queryByText("Aportes estimados.")).not.toBeInTheDocument();
  });

  it("sem meta e sem saldos, orienta o próximo passo em vez de mostrar zeros", async () => {
    mockApi({
      progress: {
        ...progress,
        streak: { current: 0, best: 0, current_month_met: false, months: [] },
        net_worth: { ...progress.net_worth, goal_cents: 0, progress_bps: 0, remaining_cents: 0 },
        year: { ...progress.year, status: "sem_base", goal_cents: 0, baseline_date: null, last_date: null },
      },
    });
    renderPage();

    expect(await screen.findByText("Comece sua sequência")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Definir meta" })).toHaveLength(1);
    expect(screen.getByText(/Ainda faltam saldos em duas datas para medir o ano/)).toBeInTheDocument();
  });

  it("a projeção traz o futuro em valores de hoje, deixa trocar para nominal e avisa que é simulação", async () => {
    const user = userEvent.setup();
    mockApi();
    renderPage();

    expect(await screen.findByText(/Daqui a 20 anos, no cenário base/)).toBeInTheDocument();
    expect(screen.getByText(/Já descontada a inflação/)).toBeInTheDocument();
    expect(screen.getByText(/É uma simulação, não uma promessa/)).toBeInTheDocument();
    expect(screen.getByText("Chega à meta em mar/2040 (daqui a 13 anos e 5 meses), em valores de hoje")).toBeInTheDocument();
    expect(screen.getAllByText("Não chega à meta em 20 anos, em valores de hoje")).toHaveLength(2); // conservador e base

    await user.click(screen.getByRole("button", { name: "Valores nominais" }));
    expect(screen.getByText(/Valor nominal, sem descontar a inflação/)).toBeInTheDocument();
    // A data de chegada continua em valores de hoje, também na visão nominal.
    expect(screen.getByText("Chega à meta em mar/2040 (daqui a 13 anos e 5 meses), em valores de hoje")).toBeInTheDocument();
  });

  it("a meta é em reais de hoje: a regra aparece no lugar da comparação nominal e a linha acompanha a visão", async () => {
    const user = userEvent.setup();
    mockApi();
    renderPage();

    expect(await screen.findByText(/A data de chegada à meta é calculada em valores de hoje/)).toBeInTheDocument();
    expect(screen.queryByText(/compara o valor nominal com a meta/)).not.toBeInTheDocument();
    expect(screen.getByText(/A linha de traço e ponto, em mel, é a sua meta de patrimônio, em reais de hoje/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Valores nominais" }));
    expect(screen.getByText(/só aparece no gráfico em valores de hoje/)).toBeInTheDocument();
    expect(screen.queryByText(/A linha de traço e ponto/)).not.toBeInTheDocument();
  });

  it("numa API antiga, sem goal_basis, a frase diz que a data é nominal", async () => {
    const { goal_basis: _omit, ...legacy } = projection;
    mockApi({ projection: legacy });
    renderPage();

    expect(await screen.findByText(/A data de chegada à meta compara o valor nominal com a meta/)).toBeInTheDocument();
    expect(screen.getByText("Chega à meta em mar/2040 (daqui a 13 anos e 5 meses), em valor nominal")).toBeInTheDocument();
    // A explicação "meta em reais de hoje" não vale para a API antiga.
    expect(screen.queryByText(/A meta está em reais de hoje/)).not.toBeInTheDocument();
  });

  it("sem meta de patrimônio, não fala em meta na projeção", async () => {
    mockApi({ projection: { ...projection, net_worth_goal_cents: 0 } });
    renderPage();

    expect(await screen.findByText(/Daqui a 20 anos, no cenário base/)).toBeInTheDocument();
    expect(screen.queryByText(/A linha de traço e ponto/)).not.toBeInTheDocument();
    expect(screen.queryByText(/chegada à meta/)).not.toBeInTheDocument();
  });

  it("rotula as premissas da projeção: aporte fixo sem reajuste, taxa única, sem imposto", async () => {
    mockApi();
    renderPage();

    expect(await screen.findByText(/O aporte é um valor fixo em reais, sem reajuste/)).toBeInTheDocument();
    expect(screen.getByText(/taxa única para a carteira inteira/)).toBeInTheDocument();
    expect(screen.getByText(/não descontam imposto de renda nem custos/)).toBeInTheDocument();
    expect(screen.getByText(/inflação de 4,5% ao ano/)).toBeInTheDocument();
  });

  it("salva as metas convertendo reais e percentuais, e confirma o que aconteceu", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderPage();

    const goal = await screen.findByLabelText(/^Meta de patrimônio total \(R\$\)/);
    await user.clear(goal);
    await user.type(goal, "500000");
    const base = screen.getByLabelText("Retorno base (% ao ano)");
    await user.clear(base);
    await user.type(base, "10,5");
    await user.click(screen.getByRole("button", { name: "Salvar metas" }));

    await waitFor(() => expect(calls.some((c) => c.init?.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(put.url).toBe("/api/v1/goals/settings");
    expect(JSON.parse(String(put.init!.body))).toMatchObject({
      net_worth_goal_cents: 50_000_000,
      base_bps: 1_050,
      conservative_bps: 600,
      horizon_years: 20,
    });
    expect(await screen.findByText(/Metas salvas/)).toBeInTheDocument();
  });

  it("não deixa salvar com retornos fora de ordem", async () => {
    const user = userEvent.setup();
    mockApi();
    renderPage();

    const conservative = await screen.findByLabelText("Retorno conservador (% ao ano)");
    await user.clear(conservative);
    await user.type(conservative, "15");

    expect(screen.getByText(/em ordem crescente/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar metas" })).toBeDisabled();
  });

  it("o ritmo de aportes fica na projeção e aceitar a sugestão atualiza o campo da meta", async () => {
    const user = userEvent.setup();
    const withGoal = { ...settings, monthly_cents: 150_000 };
    const calls = mockApi({
      settings: withGoal,
      progress: {
        ...progress,
        contribution_pace: {
          reference_month: "2026-09",
          windows: [
            { months: 3, average_cents: 210_000, months_with_data: 3 },
            { months: 6, average_cents: 200_000, months_with_data: 6 },
            { months: 12, average_cents: 190_000, months_with_data: 9 },
          ],
          goal_cents: 150_000,
          suggestion: { window_months: 6, average_cents: 200_000, suggested_cents: 200_000 },
        },
      },
    });
    renderPage();

    const projection = (await screen.findByRole("heading", { name: "Seu futuro, em perspectiva" })).closest("section")!;
    const pace = within(projection).getByRole("region", { name: "Seu ritmo de aportes" });
    expect(await screen.findByLabelText(/^Meta de aporte mensal \(R\$\)/)).toHaveValue("1500,00");

    await user.click(await within(pace).findByRole("button", { name: /^Aumentar meta para/ }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PUT")).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.init?.method === "PUT")!.init!.body))).toEqual({ ...withGoal, monthly_cents: 200_000 });
    expect(await within(pace).findByText(/A projeção já usa o novo valor/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/^Meta de aporte mensal \(R\$\)/)).toHaveValue("2000,00"));
  });
});
