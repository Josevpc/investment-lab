import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todayISO } from "@/shared/lib/format";
import { CashAccountsPage } from "./CashAccountsPage";
import type { Account } from "./types";

const today = todayISO();

const xp: Account = { id: 1, name: "XP", institution_id: 1, archived: false, cash_enabled: true, opening_date: "2026-10-01", balance_cents: 50_000 };
const inter: Account = { id: 2, name: "Inter", institution_id: 2, archived: false, cash_enabled: false, opening_date: null, balance_cents: 0 };

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

function mockApi(accounts: Account[] | "erro") {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const path = url.split("?")[0];
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (method === "GET" && path === "/api/v1/accounts") {
        return accounts === "erro" ? json({ detail: "Falha ao ler as contas." }, 500) : json(accounts);
      }
      const list = accounts === "erro" ? [] : accounts;
      if (path === "/api/v1/cash/balance") return json({ as_of: today, total_cents: list.reduce((s, a) => s + a.balance_cents, 0), accounts: [] });
      if (path === "/api/v1/cash/contributed-capital")
        return json({ as_of: today, start: null, deposits_cents: 30_000, withdrawals_cents: 5_000, contributed_cents: 25_000, by_account: [] });
      if (path === "/api/v1/institutions") return json([{ id: 1, name: "XP" }, { id: 2, name: "Inter" }]);
      if (path === "/api/v1/assets") return json([{ id: 7, name: "HGLG11", account_id: 1, archived: false }]);
      return json({}, 201);
    }),
  );
  return calls;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CashAccountsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** O aviso de sucesso chega numa região de status que já existe na tela (há outras, como a de carregamento). */
async function expectStatus(text: string) {
  await waitFor(() =>
    expect(
      screen
        .getAllByRole("status")
        .map((s) => (s.textContent ?? "").replace(/\s+/g, " "))
        .join(" | "),
    ).toContain(text),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Contas e caixa", () => {
  it("sem nenhuma conta, explica de onde elas vêm e leva a cadastrar a instituição", async () => {
    mockApi([]);
    renderPage();
    expect(await screen.findByText(/Nenhuma conta ainda/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cadastrar instituição em Ativos" })).toHaveAttribute("href", "/carteira/ativos");
  });

  it("lista o caixa de cada conta e convida a ativar onde ainda não há caixa", async () => {
    mockApi([xp, inter]);
    renderPage();

    const list = await screen.findByRole("list", { name: "Contas" });
    const [inter_, xp_] = within(list).getAllByRole("listitem"); // por instituição: Inter antes de XP
    expect(inter_).toHaveTextContent("Caixa não ativado");
    expect(within(inter_).getByRole("link", { name: "Ativar caixa de Inter" })).toHaveAttribute("href", "/carteira/contas/2");
    expect(xp_).toHaveTextContent("R$ 500,00");
    expect(xp_).toHaveTextContent("1 ativo");
    expect(screen.getByText("Capital aportado pelo caixa")).toBeInTheDocument();
    expect(screen.getByText(/Não é valor atual nem rendimento/)).toBeInTheDocument();
  });

  it("transferir fica desabilitado com o motivo quando só uma conta tem caixa", async () => {
    mockApi([xp, inter]);
    renderPage();
    const button = await screen.findByRole("button", { name: "Transferir entre contas" });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAccessibleDescription(/pelo menos duas contas/);
  });

  it("transfere entre duas contas com caixa, mostrando os dois saldos antes", async () => {
    const user = userEvent.setup();
    const calls = mockApi([xp, { ...inter, cash_enabled: true, opening_date: "2026-10-01", balance_cents: 1_000 }]);
    renderPage();

    const button = await screen.findByRole("button", { name: "Transferir entre contas" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await user.selectOptions(screen.getByLabelText("De (origem)"), "1");
    await user.selectOptions(screen.getByLabelText("Para (destino)"), "2");
    await user.type(screen.getByLabelText("Valor (R$)"), "100");
    expect(screen.getByText(/Caixa de XP:/)).toHaveTextContent("de R$ 500,00 para R$ 400,00");
    expect(screen.getByText(/Caixa de Inter:/)).toHaveTextContent("de R$ 10,00 para R$ 110,00");
    await user.click(screen.getByRole("button", { name: "Transferir" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      url: "/api/v1/cash/transfers",
      body: { from_account_id: 1, to_account_id: 2, amount_cents: 10_000, date: today },
    });
    await expectStatus("Transferência registrada: R$ 100,00 de XP para Inter");
  });

  it("esconde as arquivadas até a pessoa pedir", async () => {
    const user = userEvent.setup();
    mockApi([xp, { ...inter, archived: true }]);
    renderPage();

    const list = await screen.findByRole("list", { name: "Contas" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Mostrar arquivadas (1)" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("erro ao carregar mostra o motivo e permite tentar de novo", async () => {
    mockApi("erro");
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao ler as contas.");
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
  });
});
