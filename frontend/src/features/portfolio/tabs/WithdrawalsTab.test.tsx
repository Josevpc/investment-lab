import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatBRL as formatRaw } from "@/shared/lib/format";
import type { Withdrawal, WithdrawalList } from "../types";
import { WithdrawalsTab } from "./WithdrawalsTab";

// toHaveTextContent normaliza o espaço sem quebra do Intl ("R$ 1,00"); o esperado precisa da mesma forma.
const formatBRL = (cents: number) => formatRaw(cents).replace(/\s/g, " ");

const base: Withdrawal = {
  movement_id: 1,
  date: "2026-10-20",
  effective_date: null,
  asset_id: 2,
  asset_name: "CDB Banco X",
  institution_name: "Banco X",
  asset_archived: false,
  amount_cents: 30_000,
  cost_cents: 28_000,
  note: "conserto do carro",
  in_balance: false,
  from_reserve: false,
  reserve_balance_after_cents: null,
  reserve_below_goal_cents: null,
};

const reserveWithdrawal: Withdrawal = {
  ...base,
  movement_id: 2,
  date: "2026-09-05",
  asset_id: 3,
  asset_name: "Cofrinho Mercado Pago",
  institution_name: "Mercado Pago",
  amount_cents: 50_000,
  note: null,
  from_reserve: true,
  // O saldo digitado já estava sem o dinheiro: o saldo vale do primeiro saldo digitado (30/09) em diante.
  in_balance: true,
  effective_date: "2026-09-30",
  reserve_balance_after_cents: 650_000,
  reserve_below_goal_cents: 350_000,
};

const list: WithdrawalList = {
  items: [base, reserveWithdrawal],
  total_cents: 80_000,
  count: 2,
  reserve_total_cents: 50_000,
  years: [2026, 2025],
};

const reserveBase = {
  goal_cents: 1_000_000,
  months: 6,
  monthly_cents: 0,
  balance_cents: 650_000,
  remaining_cents: 350_000,
  progress_bps: 6_500,
  reached: false,
  average_salary_cents: null,
  salaries_considered: 0,
  suggested_goal_cents: null,
  coverage_months: null,
  assets: [],
  monthly_mode: "percent",
  percent_bps: 0,
};

interface Options {
  withdrawals?: WithdrawalList | "erro";
  reserve?: Record<string, unknown> | "erro";
  byYear?: Record<string, WithdrawalList>;
}

function mockApi({ withdrawals = list, reserve = reserveBase, byYear = {} }: Options = {}) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.includes("/withdrawals")) {
        if (withdrawals === "erro") return json({ detail: "O servidor falhou." }, 500);
        const year = new URL(url, "http://x").searchParams.get("year");
        return json((year && byYear[year]) || withdrawals);
      }
      if (url.endsWith("/reserve")) return reserve === "erro" ? json({ detail: "falhou" }, 500) : json(reserve);
      return json({});
    }),
  );
  return urls;
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WithdrawalsTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Retiradas: lista", () => {
  it("mostra título, ação principal, total, quantidade e a parte da reserva", async () => {
    mockApi();
    renderTab();

    expect(await screen.findByRole("heading", { name: /Retiradas da carteira/ })).toBeInTheDocument();
    const action = screen.getByRole("link", { name: "Registrar resgate" });
    expect(action).toHaveAttribute("href", "/carteira/movimentacoes?novo=resgate");
    expect(action).toHaveClass("bg-ink"); // a ação principal da tela, em tinta

    const total = (await screen.findByText("Total retirado")).parentElement!;
    expect(total).toHaveTextContent(formatBRL(80_000));
    expect(total).toHaveTextContent("2 retiradas");
    expect(screen.getByText("Da reserva").parentElement).toHaveTextContent(formatBRL(50_000));
    expect(screen.getByText(/As retiradas do caixa das contas ficam no extrato de cada conta\./)).toBeInTheDocument();
  });

  it("a tabela mantém a semântica com papéis explícitos (no celular ela vira cartões em display: block)", async () => {
    mockApi();
    renderTab();

    const table = await screen.findByRole("table");
    expect(table).toHaveAttribute("role", "table");
    expect(table.querySelector("thead")).toHaveAttribute("role", "rowgroup");
    expect(table.querySelector("tbody")).toHaveAttribute("role", "rowgroup");
    expect([...table.querySelectorAll("th")].every((th) => th.getAttribute("role") === "columnheader")).toBe(true);
    expect([...table.querySelectorAll("tbody tr")].every((tr) => tr.getAttribute("role") === "row")).toBe(true);
    expect([...table.querySelectorAll("tbody td")].every((td) => td.getAttribute("role") === "cell")).toBe(true);
  });

  it("cada retirada mostra data, ativo, valor com sinal e motivo; sem motivo diz 'Sem motivo'", async () => {
    mockApi();
    renderTab();

    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Data",
      "Ativo e motivo",
      "Valor",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);

    expect(rows[0]).toHaveTextContent("20/10/2026");
    expect(rows[0]).toHaveTextContent("CDB Banco X · Banco X");
    expect(rows[0]).toHaveTextContent(`− ${formatBRL(30_000)}`);
    expect(rows[0]).toHaveTextContent("conserto do carro");
    expect(within(rows[0]).queryByText("Reserva")).not.toBeInTheDocument();

    expect(rows[1]).toHaveTextContent("05/09/2026");
    expect(within(rows[1]).getByText("Sem motivo")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Reserva")).toBeInTheDocument();
  });

  it("marca o ativo arquivado", async () => {
    mockApi({ withdrawals: { ...list, items: [{ ...base, asset_archived: true }], count: 1 } });
    renderTab();
    expect(await screen.findByText("Arquivado")).toBeInTheDocument();
  });

  it("cada linha tem um link para corrigir em Movimentações, no mês do resgate, nomeando o ativo", async () => {
    mockApi();
    renderTab();

    const first = await screen.findByRole("link", { name: "Corrigir em Movimentações: retirada de CDB Banco X em 20/10/2026" });
    expect(first).toHaveAttribute("href", "/carteira/movimentacoes?mes=2026-10");
    expect(first).toHaveTextContent("Corrigir em Movimentações");
    expect(screen.getByRole("link", { name: /retirada de Cofrinho Mercado Pago em 05\/09\/2026/ })).toHaveAttribute(
      "href",
      "/carteira/movimentacoes?mes=2026-09",
    );
  });

  it("não mostra 'Da reserva' quando nada saiu da reserva", async () => {
    mockApi({ withdrawals: { ...list, items: [base], count: 1, total_cents: 30_000, reserve_total_cents: 0 } });
    renderTab();
    expect(await screen.findByText("Total retirado")).toBeInTheDocument();
    expect(screen.getByText("1 retirada")).toBeInTheDocument();
    expect(screen.queryByText("Da reserva")).not.toBeInTheDocument();
  });
});

describe("Retiradas: como a reserva ficou", () => {
  const rowOf = async (name: string) => (await screen.findByRole("link", { name: new RegExp(name) })).closest("tr")!;

  it("diz quanto a reserva ficou e quanto estava abaixo da meta atual", async () => {
    mockApi();
    renderTab();
    const row = await rowOf("Cofrinho Mercado Pago");
    expect(row).toHaveTextContent(`A reserva ficou com ${formatBRL(650_000)} (${formatBRL(350_000)} abaixo da meta atual)`);
    expect(row).toHaveTextContent("Saldo de 30/09/2026");
  });

  it("dentro da meta: diz 'dentro da meta atual'", async () => {
    mockApi({ withdrawals: { ...list, items: [{ ...reserveWithdrawal, reserve_below_goal_cents: 0 }], count: 1 } });
    renderTab();
    expect(await rowOf("Cofrinho")).toHaveTextContent(`A reserva ficou com ${formatBRL(650_000)} (dentro da meta atual)`);
  });

  it("com saldo mas sem meta (abaixo da meta nulo): diz quanto ficou, sem parênteses", async () => {
    mockApi({ withdrawals: { ...list, items: [{ ...reserveWithdrawal, reserve_below_goal_cents: null }], count: 1 } });
    renderTab();
    const row = await rowOf("Cofrinho");
    expect(row).toHaveTextContent(`A reserva ficou com ${formatBRL(650_000)}. Saldo de 30/09/2026.`);
    expect(row).not.toHaveTextContent("meta atual");
    expect(row).not.toHaveTextContent("(");
  });

  it("resgate comum da reserva: o saldo é do próprio dia do resgate", async () => {
    mockApi({
      withdrawals: { ...list, items: [{ ...reserveWithdrawal, in_balance: false, effective_date: "2026-09-05" }], count: 1 },
    });
    renderTab();
    expect(await rowOf("Cofrinho")).toHaveTextContent("Saldo de 05/09/2026");
  });

  it("sem saldo digitado depois do resgate, explica que ainda não há dado", async () => {
    mockApi({
      withdrawals: {
        ...list,
        items: [
          { ...reserveWithdrawal, in_balance: true, effective_date: null, reserve_balance_after_cents: null, reserve_below_goal_cents: null },
        ],
        count: 1,
      },
    });
    renderTab();
    const row = await rowOf("Cofrinho");
    expect(row).toHaveTextContent("Ainda não há saldo digitado depois deste resgate");
    expect(row).not.toHaveTextContent("A reserva ficou com");
  });
});

describe("Retiradas: situação atual da reserva", () => {
  it("com meta e falta: mostra quanto tem, quanto falta e o link para registrar aporte", async () => {
    mockApi();
    renderTab();
    await screen.findByText("Total retirado");
    await waitFor(() =>
      expect(screen.getByText(/Reserva de emergência, hoje:/).closest("p")).toHaveTextContent(
        `Reserva de emergência, hoje: ${formatBRL(650_000)} de ${formatBRL(1_000_000)}. Faltam ${formatBRL(350_000)} para repor.`,
      ),
    );
    expect(screen.getByRole("link", { name: "Registrar aporte" })).toHaveAttribute("href", "/aporte");
  });

  it("com a meta cumprida: diz 'Reserva completa'", async () => {
    mockApi({ reserve: { ...reserveBase, balance_cents: 1_000_000, remaining_cents: 0, reached: true } });
    renderTab();
    expect(await screen.findByText("Reserva completa.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Registrar aporte" })).not.toBeInTheDocument();
  });

  it("a zona da reserva é argila quando falta repor e jade quando está completa", async () => {
    mockApi();
    renderTab();
    const zone = (await screen.findByText(/Reserva de emergência, hoje:/)).closest("div")!;
    expect(zone).toHaveClass("bg-clay-t");
  });

  it("sem meta: convida a definir e leva à configuração da reserva", async () => {
    mockApi({ reserve: { ...reserveBase, goal_cents: 0, remaining_cents: 0 } });
    renderTab();
    expect(await screen.findByRole("link", { name: "Defina a meta da reserva" })).toHaveAttribute("href", "/configuracoes#reserva");
  });

  it("se a reserva não carrega, a lista aparece e o bloco avisa", async () => {
    mockApi({ reserve: "erro" });
    renderTab();
    expect(await screen.findByText(/não foi possível carregar a situação da reserva/)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});

describe("Retiradas: filtro de ano", () => {
  it("começa em Todos, lista os anos e pede só o ano escolhido ao servidor", async () => {
    const user = userEvent.setup();
    const only2025: WithdrawalList = {
      items: [{ ...base, movement_id: 9, date: "2025-03-10", asset_name: "Tesouro Selic" }],
      total_cents: 10_000,
      count: 1,
      reserve_total_cents: 0,
      years: [2026, 2025],
    };
    const urls = mockApi({ byYear: { "2025": only2025 } });
    renderTab();

    const select = await screen.findByRole("combobox", { name: "Ano" });
    expect(select).toHaveValue("");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Todos", "2026", "2025"]);
    expect(urls.filter((u) => u.includes("/withdrawals"))[0]).toMatch(/\/withdrawals$/);

    await user.selectOptions(select, "2025");

    expect(await screen.findByText("Tesouro Selic")).toBeInTheDocument();
    expect(urls.some((u) => u.endsWith("/withdrawals?year=2025"))).toBe(true);
    expect(screen.queryByText("CDB Banco X")).not.toBeInTheDocument();
    expect(screen.getByText("1 retirada em 2025")).toBeInTheDocument();
    // O filtro continua com todos os anos, não só o do recorte.
    expect(within(screen.getByRole("combobox", { name: "Ano" })).getAllByRole("option")).toHaveLength(3);
  });
});

describe("Retiradas: estados", () => {
  const empty: WithdrawalList = { items: [], total_cents: 0, count: 0, reserve_total_cents: 0, years: [] };

  it("carregando mostra o aviso de carregamento", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    renderTab();
    expect(screen.getByRole("status")).toHaveTextContent("Carregando");
  });

  it("vazio: explica como registrar e mantém o botão principal", async () => {
    mockApi({ withdrawals: empty });
    renderTab();
    expect(await screen.findByText(/Nenhuma retirada registrada\./)).toHaveTextContent(
      "Quando tirar dinheiro de um ativo, use Resgatar em Movimentações: o saldo e o investido caem juntos e nada aparece como prejuízo.",
    );
    expect(screen.getByRole("link", { name: "Registrar resgate" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Ano" })).not.toBeInTheDocument();
  });

  it("vazio em um ano: cita o ano", async () => {
    const user = userEvent.setup();
    mockApi({ byYear: { "2025": { ...empty, years: [2026, 2025] } } });
    renderTab();
    await user.selectOptions(await screen.findByRole("combobox", { name: "Ano" }), "2025");
    expect(await screen.findByText(/Nenhuma retirada registrada em 2025\./)).toBeInTheDocument();
  });

  it("erro: mostra a mensagem, orienta a recarregar e deixa tentar de novo", async () => {
    mockApi({ withdrawals: "erro" });
    renderTab();
    expect(await screen.findByRole("alert")).toHaveTextContent("O servidor falhou.");
    expect(screen.getByText("Recarregue a página para tentar de novo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  });
});
