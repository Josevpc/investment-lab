import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "../types";
import { ClosingEditor } from "./ClosingEditor";

const nbsp = (text: string) => text.replace(/ /g, " ");

const cdb = {
  id: 7,
  name: "CDB Midway",
  institution_name: "Midway",
  purpose: null,
  invested_cents: 100_000,
  current_cents: 110_000,
} as Asset;

function renderEditor(onDone = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ClosingEditor assets={[cdb]} onDone={onDone} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onDone;
}

/** A API de mentira: lista de contas vazia (nenhum caixa ativado) e {} para o resto. */
function mockFetch(accounts: unknown[] = []) {
  const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/accounts") ? accounts : {}), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Primeira gravação feita (as consultas GET ficam de fora). */
function firstPost(fetchMock: ReturnType<typeof mockFetch>) {
  return (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([, init]) => init?.method === "POST")!;
}

afterEach(() => vi.unstubAllGlobals());

describe("ClosingEditor", () => {
  it("calcula o investido e o rendimento enquanto o usuário digita", async () => {
    const user = userEvent.setup();
    renderEditor();

    // Sem mexer em nada: investido R$ 1.000 e rendimento R$ 100.
    expect(screen.getByText((t) => nbsp(t) === "R$ 1.000,00")).toBeInTheDocument();
    expect(screen.getByText((t) => nbsp(t) === "R$ 100,00")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Aporte do mês em CDB Midway"), "500");
    const balance = screen.getByLabelText("Saldo atual de CDB Midway");
    await user.clear(balance);
    await user.type(balance, "1.615,00");

    expect(screen.getByText((t) => nbsp(t) === "R$ 1.500,00")).toBeInTheDocument(); // 1.000 + aporte
    expect(screen.getByText((t) => nbsp(t) === "R$ 115,00")).toBeInTheDocument(); // o que veio de rendimento
    expect(screen.getByRole("button", { name: "Salvar 1 ativo" })).toBeEnabled();
  });

  it("envia aporte e saldo para a API só dos ativos alterados", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    const onDone = renderEditor();

    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled(); // nada mudou

    await user.type(screen.getByLabelText("Aporte do mês em CDB Midway"), "500");
    const balance = screen.getByLabelText("Saldo atual de CDB Midway");
    await user.clear(balance);
    await user.type(balance, "1.615,00");
    await user.click(screen.getByRole("button", { name: "Salvar 1 ativo" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // Além do POST, o aporte consulta a sequência para a comemoração.
    const posts = (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    const [url, init] = posts[0];
    expect(url).toBe("/api/v1/assets/7/balance");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ balance_cents: 161_500, contribution_cents: 50_000 });
  });

  it("só envia o investido quando o usuário escolhe corrigi-lo", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    renderEditor();

    await user.click(screen.getByLabelText("Corrigir o valor investido"));
    const invested = screen.getByLabelText("Valor investido em CDB Midway");
    await user.clear(invested);
    await user.type(invested, "900");
    await user.click(screen.getByRole("button", { name: "Salvar 1 ativo" }));

    await waitFor(() => expect(firstPost(fetchMock)).toBeDefined());
    const [, init] = firstPost(fetchMock);
    expect(JSON.parse(String(init.body))).toMatchObject({ invested_cents: 90_000, contribution_cents: 0 });
  });

  it("bloqueia o salvamento com valores inválidos", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText("Aporte do mês em CDB Midway"), "abc");
    expect(screen.getByText("Há valores inválidos.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Salvar/ })).toBeDisabled();
  });

  it("para ativos com quantidade, a cotação calcula o saldo", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    const fii = { id: 9, name: "VGHF11", institution_name: "XP", purpose: null, quantity: "45", invested_cents: 27_000, current_cents: 27_675 } as Asset;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ClosingEditor assets={[cdb, fii]} onDone={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Só o ativo com quantidade tem o campo de cotação.
    expect(screen.queryByLabelText("Cotação de CDB Midway")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Cotação de VGHF11"), "6,40");

    expect(screen.getByLabelText("Saldo atual de VGHF11")).toHaveValue("288,00"); // 45 x R$ 6,40
    await user.click(screen.getByRole("button", { name: "Salvar 1 ativo" }));
    await waitFor(() => expect(firstPost(fetchMock)).toBeDefined());
    const [url, init] = firstPost(fetchMock);
    expect(url).toBe("/api/v1/assets/9/balance");
    expect(JSON.parse(String(init.body))).toMatchObject({ balance_cents: 28_800 });
  });

  it("digitar o saldo à mão limpa a cotação", async () => {
    const user = userEvent.setup();
    const fii = { id: 9, name: "VGHF11", institution_name: "XP", purpose: null, quantity: "45", invested_cents: 27_000, current_cents: 27_675 } as Asset;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ClosingEditor assets={[fii]} onDone={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.type(screen.getByLabelText("Cotação de VGHF11"), "6,40");
    const balance = screen.getByLabelText("Saldo atual de VGHF11");
    await user.clear(balance);
    await user.type(balance, "300");
    expect(screen.getByLabelText("Cotação de VGHF11")).toHaveValue("");
  });
});

describe("ClosingEditor: aportes numa conta com caixa ativado", () => {
  const account = { id: 5, name: "XP", archived: false, cash_enabled: true, opening_date: "2000-01-01", balance_cents: 50_000 };
  const a = { ...cdb, id: 1, name: "FII A", account_id: 5 } as Asset;
  const b = { ...cdb, id: 2, name: "FII B", account_id: 5 } as Asset;

  function renderTwo() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ClosingEditor assets={[a, b]} onDone={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("a soma do que sai do caixa da mesma conta precisa caber; só o ativo marcado vai com use_cash", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([account]);
    renderTwo();

    await user.type(screen.getByLabelText("Aporte do mês em FII A"), "300");
    await user.type(screen.getByLabelText("Aporte do mês em FII B"), "300");
    expect(await screen.findAllByText(/Este aporte também entra no caixa da conta/)).toHaveLength(2);

    await user.click(screen.getByRole("checkbox", { name: /para o aporte em FII A/ }));
    await user.click(screen.getByRole("checkbox", { name: /para o aporte em FII B/ }));
    const save = screen.getByRole("button", { name: "Salvar 2 ativos" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription(/não cobre os aportes/);

    await user.click(screen.getByRole("checkbox", { name: /para o aporte em FII B/ }));
    await user.click(save);
    const bodies = () =>
      (fetchMock.mock.calls as unknown as [string, RequestInit][])
        .filter(([, init]) => init?.method === "POST")
        .map(([url, init]) => [url, JSON.parse(String(init.body))]);
    await waitFor(() => expect(bodies()).toHaveLength(2));
    expect(bodies()[0]).toEqual(["/api/v1/assets/1/balance", expect.objectContaining({ use_cash: true })]);
    expect(bodies()[1][1]).not.toHaveProperty("use_cash");
  });
});
