import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todayISO } from "@/shared/lib/format";
import { CashAccountPage } from "./CashAccountPage";
import type { Account, Entry } from "./types";

const today = todayISO();
const month = today.slice(0, 7);

const xp: Account = {
  id: 1,
  name: "XP",
  institution_id: 1,
  archived: false,
  cash_enabled: true,
  opening_date: `${month}-01`,
  balance_cents: 50_000,
};

const deposit: Entry = {
  id: 5,
  account_id: 1,
  date: `${month}-02`,
  kind: "deposito",
  amount_cents: 20_000,
  asset_id: null,
  movement_id: null,
  transfer_id: null,
  counterpart_account_id: null,
  balance_cents: 50_000,
  deletable: true,
};

const purchase: Entry = { ...deposit, id: 6, kind: "compra", amount_cents: -10_000, asset_id: 7, movement_id: 9, balance_cents: 40_000, deletable: false };

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

type Reply = { status?: number; body: unknown };

function mockApi({ account = xp, entries = [] as Entry[], overrides = {} as Record<string, Reply> } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const key = `${method} ${url.split("?")[0]}`;
      const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
      if (overrides[key]) return json(overrides[key].body, overrides[key].status ?? 200);
      if (key === "GET /api/v1/accounts/1") return json(account);
      if (key === "GET /api/v1/accounts") return json([account, { ...xp, id: 2, name: "Inter", institution_id: 2 }]);
      if (key === "GET /api/v1/accounts/1/entries") return json({ account_id: 1, balance_cents: account.balance_cents, entries });
      if (key === "GET /api/v1/cash/contributed-capital")
        return json({ as_of: today, start: null, deposits_cents: 20_000, withdrawals_cents: 0, contributed_cents: 20_000, by_account: [] });
      if (key === "GET /api/v1/institutions") return json([{ id: 1, name: "XP" }]);
      if (key === "GET /api/v1/assets") return json([{ id: 7, name: "HGLG11", account_id: 1, archived: false, valuation_date: `${month}-01` }]);
      if (key === "GET /api/v1/accounts/1/reconcile") {
        const real = Number(new URL(url, "http://x").searchParams.get("real_cents"));
        return json({ account_id: 1, as_of: today, calculated_cents: 50_000, real_cents: real, difference_cents: real - 50_000 });
      }
      if (method === "DELETE") return json(null, 204);
      return json({}, 201);
    }),
  );
  return calls;
}

function renderPage(path = "/carteira/contas/1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/carteira/contas/:id" element={<CashAccountPage />} />
        </Routes>
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

const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");

describe("Conta: ativar o caixa", () => {
  it("explica que vale uma vez só e envia saldo e data", async () => {
    const user = userEvent.setup();
    const calls = mockApi({ account: { ...xp, cash_enabled: false, opening_date: null, balance_cents: 0 } });
    renderPage();

    const form = await screen.findByRole("form", { name: "Ativar o caixa de XP" });
    expect(within(form).getByText(/Vale uma vez só/)).toBeInTheDocument();
    const submit = within(form).getByRole("button", { name: "Ativar caixa" });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription(/Informe o saldo em caixa/);

    await user.type(within(form).getByLabelText(/Saldo em caixa no extrato/), "1.500,00");
    await user.click(submit);

    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]).toMatchObject({ url: "/api/v1/accounts/1/opening-balance", body: { date: today, amount_cents: 150_000 } });
    await expectStatus("Caixa ativado com R$ 1.500,00");
  });
});

describe("Conta: lançamentos", () => {
  it("registra um depósito mostrando antes como o caixa fica", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Registrar lançamento" }));
    await user.type(screen.getByLabelText("Valor do depósito (R$)"), "200");
    expect(screen.getByText(/Caixa de hoje: de/)).toHaveTextContent("Caixa de hoje: de R$ 500,00 para R$ 700,00");
    await user.click(screen.getByRole("button", { name: "Registrar depósito" }));

    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]).toMatchObject({ url: "/api/v1/accounts/1/deposits", body: { date: today, amount_cents: 20_000 } });
    await expectStatus("Depósito registrado: R$ 200,00");
    await expectStatus("Caixa de hoje: R$ 700,00");
    // O formulário fecha e o foco volta ao botão que o abriu.
    await waitFor(() => expect(screen.getByRole("button", { name: "Registrar lançamento" })).toHaveFocus());
  });

  it("não deixa tirar mais do que há no caixa e diz por quê", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Registrar lançamento" }));
    await user.click(screen.getByRole("button", { name: "Retirada" }));
    await user.type(screen.getByLabelText("Valor da retirada (R$)"), "600");
    const submit = screen.getByRole("button", { name: "Registrar retirada" });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription("É mais do que há no caixa hoje.");
    expect(posts(calls)).toHaveLength(0);
  });

  it("ajuste vai com o sinal do sentido escolhido", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Registrar lançamento" }));
    await user.click(screen.getByRole("button", { name: "Ajuste" }));
    await user.click(screen.getByRole("button", { name: "Tirar do caixa (−)" }));
    await user.type(screen.getByLabelText("Valor do ajuste (R$)"), "0,35");
    await user.click(screen.getByRole("button", { name: "Registrar ajuste" }));

    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]).toMatchObject({ url: "/api/v1/accounts/1/adjustments", body: { amount_cents: -35 } });
  });

  it("traduz o erro do back-end em próximo passo", async () => {
    const user = userEvent.setup();
    mockApi({
      overrides: {
        "POST /api/v1/accounts/1/withdrawals": {
          status: 422,
          body: { detail: "Caixa insuficiente em XP: faltam R$ 10,00 em 05/10/2026.", shortfall_cents: 1_000 },
        },
      },
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Registrar lançamento" }));
    await user.click(screen.getByRole("button", { name: "Retirada" }));
    await user.type(screen.getByLabelText("Valor da retirada (R$)"), "100");
    await user.click(screen.getByRole("button", { name: "Registrar retirada" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Caixa insuficiente em XP");
    expect(screen.getByText(/Registre antes o depósito que trouxe esse dinheiro/)).toBeInTheDocument();
  });
});

describe("Conta: conferir com o extrato", () => {
  it("mostra calculado x extrato x diferença e só grava depois de confirmar", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Conferir com o extrato" }));
    await user.type(screen.getByLabelText("Saldo no extrato (R$)"), "480");

    const adjust = await screen.findByRole("button", { name: /Ajustar o caixa em − R\$\s20,00/ });
    expect(screen.getByText("a menos no extrato do que no app")).toBeInTheDocument();
    await user.click(adjust);

    const dialog = screen.getByRole("alertdialog", { name: "Confirmar o ajuste?" });
    expect(dialog).toHaveTextContent("O caixa calculado passa de R$ 500,00 para R$ 480,00");
    expect(posts(calls)).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Confirmar ajuste" }));
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]).toMatchObject({
      url: "/api/v1/accounts/1/reconcile/adjustment",
      body: { real_cents: 48_000, as_of: today, confirm: true },
    });
    await expectStatus("Caixa conferido");
  });

  it("quando confere, diz que não há nada a ajustar", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Conferir com o extrato" }));
    await user.type(screen.getByLabelText("Saldo no extrato (R$)"), "500");
    expect(await screen.findByText(/O caixa confere com o extrato\. Nada a ajustar\./)).toBeInTheDocument();
    expect(posts(calls)).toHaveLength(0);
  });
});

describe("Conta: extrato", () => {
  it("mostra tipo, sinal e saldo; lançamento de movimento leva a Movimentações em vez de Excluir", async () => {
    mockApi({ entries: [purchase, deposit] });
    renderPage();

    const list = await screen.findByRole("list", { name: "Lançamentos de XP" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Compra");
    expect(rows[0]).toHaveTextContent("Compra de HGLG11");
    expect(rows[0]).toHaveTextContent("saída de − R$ 100,00");
    expect(within(rows[0]).queryByRole("button", { name: /Excluir/ })).not.toBeInTheDocument();
    expect(within(rows[0]).getByRole("link", { name: /^Ver movimento/ })).toHaveAttribute("href", `/carteira/movimentacoes?mes=${month}`);
    expect(rows[1]).toHaveTextContent("entrada de + R$ 200,00");
  });

  it("exclui um lançamento manual só depois de confirmar o efeito", async () => {
    const user = userEvent.setup();
    const calls = mockApi({ entries: [deposit] });
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^Excluir depósito de/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("O valor sai do caixa e do capital aportado de XP");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Excluir lançamento" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/v1/cash/entries/5")).toBe(true));
    await expectStatus("Depósito de R$ 200,00");
  });

  it("não exclui quando a pessoa desiste", async () => {
    const user = userEvent.setup();
    const calls = mockApi({ entries: [deposit] });
    renderPage();

    await user.click(await screen.findByRole("button", { name: /^Excluir depósito de/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("sem lançamentos no período, convida a ver tudo ou registrar", async () => {
    mockApi({ entries: [] });
    renderPage();
    expect(await screen.findByText(/Nenhum lançamento neste período/)).toBeInTheDocument();
  });
});

describe("Conta: estados", () => {
  it("conta que não existe mais orienta a voltar", async () => {
    mockApi({ overrides: { "GET /api/v1/accounts/1": { status: 404, body: { detail: "Conta não encontrada." } } } });
    renderPage();
    expect(await screen.findByText(/Essa conta não existe/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Todas as contas/ })).toHaveAttribute("href", "/carteira/contas");
  });

  it("não deixa arquivar conta com ativos e diz o que fazer", async () => {
    mockApi({ account: { ...xp, balance_cents: 0 } });
    renderPage();
    const archive = await screen.findByRole("button", { name: "Arquivar conta" });
    await waitFor(() => expect(archive).toBeDisabled());
    expect(archive).toHaveAccessibleDescription(/Arquive-os em Carteira → Ativos/);
  });
});

describe("Conta: foco, limites e estados extras", () => {
  it("abrir um formulário leva o foco ao primeiro campo; cancelar devolve ao botão de origem", async () => {
    const user = userEvent.setup();
    mockApi();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Conferir com o extrato" }));
    expect(screen.getByLabelText("Saldo no extrato (R$)")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Conferir com o extrato" })).toHaveFocus());
  });

  it("ao confirmar o ajuste, o foco vai para a confirmação e, ao voltar, para o botão de ajustar", async () => {
    const user = userEvent.setup();
    mockApi();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Conferir com o extrato" }));
    await user.type(screen.getByLabelText("Saldo no extrato (R$)"), "480");
    await user.click(await screen.findByRole("button", { name: /Ajustar o caixa em/ }));
    expect(screen.getByRole("alertdialog", { name: "Confirmar o ajuste?" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Ajustar o caixa em/ })).toHaveFocus());
  });

  it("recusa valor acima do teto do back-end com mensagem em português", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Registrar lançamento" }));
    await user.type(screen.getByLabelText("Valor do depósito (R$)"), "100000000001");
    const submit = screen.getByRole("button", { name: "Registrar depósito" });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription("O valor máximo aceito é R$ 100 bilhões.");
    expect(posts(calls)).toHaveLength(0);
  });

  it("endereço com id inválido é tratado como conta que não existe, sem “Tentar de novo”", async () => {
    mockApi();
    renderPage("/carteira/contas/abc");
    expect(await screen.findByText(/Essa conta não existe/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).not.toBeInTheDocument();
  });

  it("enquanto os ativos carregam, não diz que a conta não tem ativos; com erro, explica", async () => {
    mockApi({ overrides: { "GET /api/v1/assets": { status: 500, body: { detail: "Falhou." } } } });
    renderPage();
    expect(await screen.findByText(/não deu para carregar os ativos/)).toBeInTheDocument();
    expect(screen.queryByText(/nenhum ativo nesta conta/)).not.toBeInTheDocument();
    const buy = screen.getByRole("button", { name: "Comprar ativo com o caixa" });
    expect(buy).toBeDisabled();
    expect(buy).toHaveAccessibleDescription(/Não deu para carregar os ativos/);
  });

  it("botões desabilitados dizem o motivo pelo nome acessível da descrição", async () => {
    mockApi({ overrides: { "GET /api/v1/accounts": { body: [xp] } } });
    renderPage();
    const transfer = await screen.findByRole("button", { name: "Transferir para outra conta" });
    await waitFor(() => expect(transfer).toBeDisabled());
    expect(transfer).toHaveAccessibleDescription(/outra conta tiver o caixa ativado/);
  });

  it("“Ver movimento” tem nome acessível que começa pelo texto visível", async () => {
    mockApi({ entries: [purchase] });
    renderPage();
    const link = await screen.findByRole("link", { name: /^Ver movimento/ });
    expect(link).toHaveAccessibleDescription(/desfaça o movimento em Movimentações/);
  });
});
