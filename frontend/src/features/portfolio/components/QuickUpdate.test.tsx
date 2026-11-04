import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "../types";
import { QuickUpdate } from "./QuickUpdate";

const asset = (extra: Partial<Asset>): Asset =>
  ({
    class_key: "renda_fixa",
    class_name: "Renda Fixa",
    purpose: null,
    quantity: null,
    balance_is_net: false,
    ...extra,
  }) as Asset;

const caixinha = asset({
  id: 2,
  name: "Caixinha",
  institution_id: 20,
  institution_name: "Mercado Pago",
  invested_cents: 50_000,
  current_cents: 50_000,
  valuation_date: "2026-10-17",
  balance_is_net: true,
});
const cdb = asset({
  id: 7,
  name: "CDB Midway",
  institution_id: 30,
  institution_name: "Midway",
  invested_cents: 100_000,
  current_cents: 110_000,
  valuation_date: "2026-10-10",
});
const fii = asset({
  id: 9,
  name: "VGHF11",
  class_key: "renda_variavel",
  class_name: "Renda Variável",
  institution_id: 40,
  institution_name: "XP",
  quantity: "45",
  invested_cents: 27_000,
  current_cents: 27_675,
  valuation_date: "2026-10-17",
});

/** Respostas do desempenho de cada ativo no período (a API de mentira). */
const performance: Record<number, object> = {
  2: { class_key: "renda_fixa", balance_is_net: true, pct_of_cdi_bps: 11_800, return_bps: 30, cdi_bps: 25, start_date: "2026-10-17", end_date: "2026-10-24", warnings: [] },
  7: { class_key: "renda_fixa", balance_is_net: false, pct_of_cdi_bps: 10_200, return_bps: 100, cdi_bps: 98, start_date: "2026-10-10", end_date: "2026-10-24", warnings: [] },
  9: { class_key: "renda_variavel", balance_is_net: false, pct_of_cdi_bps: null, return_bps: 407, cdi_bps: 50, start_date: "2026-10-17", end_date: "2026-10-24", warnings: [] },
};

type Call = [string, RequestInit | undefined];

function mockApi({ failSave = false }: { failSave?: boolean } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return failSave
        ? new Response(JSON.stringify({ detail: "O caixa da conta não cobre este aporte." }), { status: 409 })
        : new Response("{}", { status: 200 });
    }
    const match = /\/analytics\/assets\/(\d+)\/vs-cdi/.exec(url);
    if (match) return new Response(JSON.stringify(performance[Number(match[1])]), { status: 200 });
    return new Response("[]", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const posts = (fetchMock: ReturnType<typeof mockApi>) =>
  (fetchMock.mock.calls as unknown as Call[])
    .filter(([, init]) => init?.method === "POST")
    .map(([url, init]) => ({ url, body: JSON.parse(String(init?.body)) }));

function renderPage(assets: Asset[] = [cdb, fii, caixinha]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <QuickUpdate assets={assets} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const balance = (name: string) => screen.getByLabelText(`Saldo atual de ${name}`);
const saveButton = () => screen.getByRole("button", { name: /Salvar atualização/ });

beforeEach(() => {
  // Só a data é falsa: os temporizadores reais continuam, para o userEvent e o waitFor.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 24, 12, 0, 0) });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Atualização rápida: a lista", () => {
  it("agrupa por instituição e diz há quanto tempo cada saldo foi atualizado", () => {
    mockApi();
    renderPage();

    const groups = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(groups).toEqual(["Mercado Pago", "Midway", "XP"]); // em ordem alfabética

    const midway = screen.getByRole("region", { name: "Midway" });
    expect(within(midway).getByText(/atualizado há 14 dias/)).toBeInTheDocument();
    expect(within(midway).getByText("Desatualizado")).toBeInTheDocument();
    const mercadoPago = screen.getByRole("region", { name: "Mercado Pago" });
    expect(within(mercadoPago).getByText(/atualizado há 7 dias/)).toBeInTheDocument();
    expect(within(mercadoPago).queryByText("Desatualizado")).not.toBeInTheDocument(); // uma semana ainda é em dia
    expect(within(screen.getByRole("region", { name: "XP" })).getByText(/atualizado há 7 dias/)).toBeInTheDocument();
  });

  it("sem ativos, orienta a cadastrar o primeiro", () => {
    mockApi();
    renderPage([]);
    expect(screen.getByText(/Cadastre um ativo/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Novo ativo" })).toHaveAttribute("href", "/carteira/ativos?novo=1");
  });

  it("nada digitado: nada para salvar", () => {
    mockApi();
    renderPage();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText("Nada para salvar ainda.")).toBeInTheDocument();
  });

  it("explica que o que ficar em branco continua como está", () => {
    mockApi();
    renderPage();
    expect(screen.getByText(/deixe em branco o que não mudou/i)).toBeInTheDocument();
  });
});

describe("Atualização rápida: digitando", () => {
  it("mostra na hora quanto o ativo rendeu desde o saldo anterior, com sinal e em %", async () => {
    mockApi();
    const user = renderPage();

    await user.type(balance("CDB Midway"), "1.111,00");

    const row = screen.getByRole("listitem", { name: "CDB Midway" });
    expect(row).toHaveTextContent(/\+R\$.11,00/);
    expect(row).toHaveTextContent("+1%");
    expect(row).toHaveTextContent("desde 10/10/2026");
    expect(balance("CDB Midway")).toHaveAccessibleDescription(/\+R\$.11,00/);
  });

  it("queda aparece com sinal negativo, não só em vermelho", async () => {
    mockApi();
    const user = renderPage();

    await user.type(balance("CDB Midway"), "1.090,00");

    expect(screen.getByRole("listitem", { name: "CDB Midway" })).toHaveTextContent(/-R\$.10,00/);
    expect(screen.getByRole("listitem", { name: "CDB Midway" })).toHaveTextContent("-0,91%");
  });

  it("Enter pula para o saldo do próximo ativo, sem enviar o formulário", async () => {
    const fetchMock = mockApi();
    const user = renderPage();

    await user.type(balance("Caixinha"), "501,50{Enter}");

    expect(balance("CDB Midway")).toHaveFocus(); // a ordem da tela: Mercado Pago, Midway, XP
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it("Enter no último saldo leva o foco ao botão de salvar", async () => {
    mockApi();
    const user = renderPage();

    await user.type(screen.getByLabelText("Cotação de VGHF11"), "6,40{Enter}");

    expect(saveButton()).toHaveFocus(); // o botão só recebe o foco quando há o que salvar
  });

  it("valor inválido é apontado no ativo e trava o salvamento", async () => {
    mockApi();
    const user = renderPage();

    await user.type(balance("CDB Midway"), "abc");

    expect(screen.getByRole("listitem", { name: "CDB Midway" })).toHaveTextContent("Valor inválido.");
    expect(balance("CDB Midway")).toBeInvalid();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(/Corrija os valores apontados/)).toBeInTheDocument();
  });

  it("a cotação de um ativo com quantidade calcula o saldo", async () => {
    mockApi();
    const user = renderPage();

    await user.type(screen.getByLabelText("Cotação de VGHF11"), "6,40");

    // 45 × R$ 6,40 = R$ 288,00: rendeu R$ 11,25 sobre os R$ 276,75 anteriores.
    expect(screen.getByRole("listitem", { name: "VGHF11" })).toHaveTextContent(/\+R\$.11,25/);
    expect(screen.getByRole("listitem", { name: "VGHF11" })).toHaveTextContent("+4,07%");
  });
});

describe("Atualização rápida: aporte opcional", () => {
  it("só aparece quando a pessoa pede", async () => {
    mockApi();
    const user = renderPage();
    expect(screen.queryByLabelText("Aporte em CDB Midway")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Adicionar aporte em CDB Midway" }));

    expect(screen.getByLabelText("Aporte em CDB Midway")).toBeInTheDocument();
    expect(screen.getByLabelText("Dia do aporte em CDB Midway")).toBeInTheDocument();
  });

  it("o aporte sai do rendimento: saldo com aporte não vira ganho", async () => {
    mockApi();
    const user = renderPage();
    await user.click(screen.getByRole("button", { name: "Adicionar aporte em CDB Midway" }));

    await user.type(screen.getByLabelText("Aporte em CDB Midway"), "500");
    await user.type(balance("CDB Midway"), "1.612,00");

    expect(screen.getByRole("listitem", { name: "CDB Midway" })).toHaveTextContent(/\+R\$.12,00/); // 1.612 − 1.100 − 500
  });

  it("aporte sem saldo pede o saldo", async () => {
    mockApi();
    const user = renderPage();
    await user.click(screen.getByRole("button", { name: "Adicionar aporte em CDB Midway" }));

    await user.type(screen.getByLabelText("Aporte em CDB Midway"), "500");

    expect(screen.getByRole("listitem", { name: "CDB Midway" })).toHaveTextContent("Informe o saldo atual, já com o aporte.");
    expect(saveButton()).toBeDisabled();
  });
});

describe("Atualização rápida: salvando", () => {
  it("grava só os ativos que mudaram, com a data dos saldos", async () => {
    const fetchMock = mockApi();
    const user = renderPage();

    await user.type(balance("Caixinha"), "501,50");
    await user.type(balance("CDB Midway"), "1.111,00");
    expect(screen.getByText("2 ativos para salvar.")).toBeInTheDocument();
    await user.click(saveButton());

    await screen.findByText("Saldos atualizados");
    expect(posts(fetchMock)).toEqual([
      { url: "/api/v1/assets/2/balance", body: { date: "2026-10-24", balance_cents: 50_150, contribution_cents: 0 } },
      { url: "/api/v1/assets/7/balance", body: { date: "2026-10-24", balance_cents: 111_100, contribution_cents: 0 } },
    ]);
  });

  it("manda o aporte e o dia dele quando é outro dia", async () => {
    const fetchMock = mockApi();
    const user = renderPage();
    await user.click(screen.getByRole("button", { name: "Adicionar aporte em CDB Midway" }));
    await user.type(screen.getByLabelText("Aporte em CDB Midway"), "500");
    await user.type(balance("CDB Midway"), "1.612,00");
    const day = screen.getByLabelText("Dia do aporte em CDB Midway");
    await user.clear(day);
    await user.type(day, "2026-10-20");

    await user.click(saveButton());

    await screen.findByText("Saldos atualizados");
    expect(posts(fetchMock)[0].body).toMatchObject({
      balance_cents: 161_200,
      contribution_cents: 50_000,
      contribution_date: "2026-10-20",
    });
  });

  it("se a gravação falha, mostra o motivo e mantém o que foi digitado", async () => {
    mockApi({ failSave: true });
    const user = renderPage();
    await user.type(balance("CDB Midway"), "1.111,00");

    await user.click(saveButton());

    expect(await screen.findByText(/O caixa da conta não cobre este aporte/)).toBeInTheDocument();
    expect(balance("CDB Midway")).toHaveValue("1.111,00");
    expect(screen.queryByText("Saldos atualizados")).not.toBeInTheDocument();
  });
});

describe("Atualização rápida: o resultado", () => {
  async function saveThree() {
    const fetchMock = mockApi();
    const user = renderPage();
    await user.type(balance("Caixinha"), "501,50");
    await user.type(balance("CDB Midway"), "1.111,00");
    await user.type(screen.getByLabelText("Cotação de VGHF11"), "6,40");
    await user.click(saveButton());
    await screen.findByText("Saldos atualizados");
    return { user, fetchMock };
  }

  it("diz o que foi feito: quantos ativos, quanto rendeu no total e em %", async () => {
    await saveThree();

    expect(screen.getByText(/3 ativos atualizados/)).toBeInTheDocument();
    const total = screen.getByRole("group", { name: "Total desde a última atualização" });
    expect(total).toHaveTextContent(/\+R\$.23,75/); // 1,50 + 11,00 + 11,25
    expect(total).toHaveTextContent("+1,27%"); // 2.375 sobre 50.000 + 110.000 + 27.675 = 187.675
  });

  it("mostra, ativo por ativo, a variação e o desempenho contra o CDI", async () => {
    await saveThree();

    const table = await screen.findByRole("table", { name: /Resultado da atualização/ });
    const caixinhaRow = within(table).getByRole("row", { name: /Caixinha/ });
    expect(caixinhaRow).toHaveTextContent("+0,3%");
    await waitFor(() => expect(caixinhaRow).toHaveTextContent("118% do CDI")); // renda fixa: % do CDI
    expect(caixinhaRow).toHaveTextContent("saldo líquido de IR");
    expect(within(table).getByRole("row", { name: /CDB Midway/ })).toHaveTextContent("+1%");
    await waitFor(() => expect(within(table).getByRole("row", { name: /CDB Midway/ })).toHaveTextContent("102% do CDI"));
    // Renda variável não tem "% do CDI": diferença em pontos percentuais.
    await waitFor(() => expect(within(table).getByRole("row", { name: /VGHF11/ })).toHaveTextContent("+3,57 p.p."));
  });

  it("avisa que uma semana é pouco para o % do CDI", async () => {
    await saveThree();
    expect(screen.getByText(/Em períodos curtos/)).toBeInTheDocument();
  });

  it("diz o que vem a seguir: ver desempenho ou fechar o mês", async () => {
    await saveThree();

    expect(screen.getByRole("link", { name: "Ver desempenho" })).toHaveAttribute("href", "/historico?aba=desempenho");
    expect(screen.getByRole("link", { name: "Fazer o fechamento do mês" })).toHaveAttribute("href", "/carteira/fechamento");
  });

  it("\"Atualizar mais saldos\" volta à lista, limpa e com os saldos novos como ponto de partida", async () => {
    const { user } = await saveThree();

    await user.click(screen.getByRole("button", { name: "Atualizar mais saldos" }));

    expect(balance("CDB Midway")).toHaveValue("");
    expect(saveButton()).toBeDisabled();
  });

  it("conta os ativos que ficaram como estavam", async () => {
    const fetchMock = mockApi();
    const user = renderPage();
    await user.type(balance("CDB Midway"), "1.111,00");
    await user.click(saveButton());

    await screen.findByText("Saldos atualizados");
    expect(screen.getByText(/2 ativos não mudaram e ficaram como estavam/)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(1);
  });
});
