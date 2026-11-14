import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todayISO } from "@/shared/lib/format";
import { editHint, MovementsCard, undoMessage } from "./MovementsCard";

const cofrinho = {
  id: 2,
  name: "Cofrinho Mercado Pago",
  institution_name: "Mercado Pago",
  purpose: "reserva",
  archived: false,
  invested_cents: 71_391,
  current_cents: 71_391,
  valuation_date: "2026-10-15",
};

const bitcoin = {
  ...cofrinho,
  id: 4,
  name: "Bitcoin",
  ticker: "BTC",
  class_key: "cripto",
  purpose: null,
  quantity: "0.0025",
  invested_cents: 80_000,
  current_cents: 87_500,
};

const fii = {
  ...cofrinho,
  id: 6,
  name: "HGLG11",
  ticker: "HGLG11",
  class_key: "acoes",
  asset_type: "fii",
  purpose: null,
  quantity: "10",
  invested_cents: 150_000,
  current_cents: 160_000,
};

const emptySummary = {
  month: "2026-10",
  by_class: [],
  reserve_cents: 0,
  reserve_goal_cents: 0,
  off_goal_cents: 0,
  total_cents: 0,
  proventos_cents: 0,
  redemptions_cents: 0,
  registered_cents: 0,
  new_assets_cents: 0,
  new_assets: [],
};

function mockApi(movements: unknown[] = [], accounts: unknown[] = [], summary: unknown = emptySummary) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const method = init?.method ?? "GET";
    if (method === "GET" && url.includes("/accounts")) return new Response(JSON.stringify(accounts), { status: 200 });
    if (method === "GET" && url.includes("/assets")) return new Response(JSON.stringify([cofrinho, { ...cofrinho, id: 3, name: "Outro" }, bitcoin, { ...bitcoin, id: 5, name: "Ether", quantity: null }, fii, { ...fii, id: 7, name: "XPML11", quantity: null }]), { status: 200 });
    if (method === "GET" && url.includes("/movements")) return new Response(JSON.stringify(movements), { status: 200 });
    if (method === "GET" && url.includes("/portfolio/month-summary")) return new Response(JSON.stringify(summary), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MovementsCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole("button", { name: "Registrar aporte" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

describe("Movimentações: registrar aporte", () => {
  it("oferece a ação de registrar aporte ao lado das demais", async () => {
    mockApi();
    renderCard();
    expect(await screen.findByRole("button", { name: "Registrar aporte" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transferir entre ativos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar provento" })).toBeInTheDocument();
  });

  it("sem saldo informado, soma o aporte ao saldo registrado", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderCard();
    await openForm(user);

    await user.selectOptions(screen.getByLabelText("Ativo"), "2");
    await user.type(screen.getByLabelText("Valor do aporte (R$)"), "90");
    expect(screen.getByText(/Em branco: o saldo passa de/)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Registrar aporte" }).at(-1)!);

    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.url).toBe("/api/v1/assets/2/balance");
    expect(JSON.parse(String(post.init!.body))).toEqual({
      date: todayISO(),
      balance_cents: 71_391 + 9_000,
      contribution_cents: 9_000,
    });
  });

  it("envia o dia do aporte e o saldo digitado quando informados", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderCard();
    await openForm(user);

    await user.selectOptions(screen.getByLabelText("Ativo"), "2");
    await user.type(screen.getByLabelText("Valor do aporte (R$)"), "90");
    await user.clear(screen.getByLabelText("Dia do aporte"));
    await user.type(screen.getByLabelText("Dia do aporte"), "2026-10-16");
    await user.type(screen.getByLabelText(/Saldo atual do ativo, com o aporte/), "803,91");
    await user.click(screen.getAllByRole("button", { name: "Registrar aporte" }).at(-1)!);

    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.init?.method === "POST")!.init!.body));
    expect(body).toMatchObject({ balance_cents: 80_391, contribution_cents: 9_000, contribution_date: "2026-10-16" });
  });

  it("cripto: informa quantidade e cotação e o app calcula valor, saldo e nova quantidade", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderCard();
    await openForm(user);

    await user.selectOptions(screen.getByLabelText("Ativo"), "4");
    expect(screen.queryByLabelText("Valor do aporte (R$)")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Quantidade comprada/), "0,0012");
    await user.type(screen.getByLabelText("Cotação (R$ por moeda)"), "350000");
    expect(screen.getByRole("status")).toHaveTextContent("Aporte de R$ 420,00");
    expect(screen.getByRole("status")).toHaveTextContent("0.0037");
    await user.click(screen.getAllByRole("button", { name: "Registrar aporte" }).at(-1)!);

    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.url).toBe("/api/v1/assets/4/balance");
    expect(JSON.parse(String(post.init!.body))).toEqual({
      date: todayISO(),
      balance_cents: 129_500, // 0,0037 x R$ 350.000
      contribution_cents: 42_000, // 0,0012 x R$ 350.000
      quantity_added: "0.0012",
    });
  });

  it("cripto: o botão busca a cotação e preenche o campo", async () => {
    const user = userEvent.setup();
    mockApi();
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) =>
      url.includes("/quotes/crypto") ? new Response(JSON.stringify({ ticker: "BTC", price: "431884.5", source: "Binance" }), { status: 200 }) : base(url, init),
    );
    renderCard();
    await openForm(user);

    await user.selectOptions(screen.getByLabelText("Ativo"), "4");
    await user.click(screen.getByRole("button", { name: "Buscar cotação de Bitcoin" }));

    await waitFor(() => expect(screen.getByLabelText("Cotação (R$ por moeda)")).toHaveValue("431884,5"));
  });

  it("cripto sem quantidade cadastrada continua pedindo o valor em R$ e explica o porquê", async () => {
    const user = userEvent.setup();
    mockApi();
    renderCard();
    await openForm(user);

    await user.selectOptions(screen.getByLabelText("Ativo"), "5");
    expect(screen.getByLabelText("Valor do aporte (R$)")).toBeInTheDocument();
    expect(screen.getByText(/não tem a quantidade de moedas cadastrada/)).toBeInTheDocument();
  });

  it("FII com quantidade: informa as cotas, vê a prévia com o preço médio e envia quantity_added", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderCard();
    await openForm(user);

    await user.selectOptions(screen.getByLabelText("Ativo"), "6");
    const shares = screen.getByLabelText("Cotas compradas (opcional)");
    expect(screen.getByText("Você tem 10 cotas em HGLG11.")).toBeInTheDocument();
    expect(shares).toHaveAccessibleDescription("Você tem 10 cotas em HGLG11.");
    await user.type(screen.getByLabelText("Valor do aporte (R$)"), "1.234,00");
    await user.type(shares, "4");
    expect(screen.getByRole("status")).toHaveTextContent("Depois do aporte você terá 14 cotas. Preço médio desta compra: R$ 308,50 por cota.");
    await user.click(screen.getAllByRole("button", { name: "Registrar aporte" }).at(-1)!);

    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.url).toBe("/api/v1/assets/6/balance");
    expect(JSON.parse(String(post.init!.body))).toEqual({
      date: todayISO(),
      balance_cents: 160_000 + 123_400,
      contribution_cents: 123_400,
      quantity_added: "4",
    });
  });

  it("FII com o campo de cotas vazio não envia quantity_added", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderCard();
    await openForm(user);

    await user.selectOptions(screen.getByLabelText("Ativo"), "6");
    await user.type(screen.getByLabelText("Valor do aporte (R$)"), "100");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Registrar aporte" }).at(-1)!);

    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.init?.method === "POST")!.init!.body));
    expect(body).toEqual({ date: todayISO(), balance_cents: 170_000, contribution_cents: 10_000 });
    expect(body).not.toHaveProperty("quantity_added");
  });

  it("ativo sem quantidade cadastrada não mostra o campo de cotas e orienta a editar o ativo", async () => {
    const user = userEvent.setup();
    mockApi();
    renderCard();
    await openForm(user);

    await user.selectOptions(screen.getByLabelText("Ativo"), "7");
    expect(screen.queryByLabelText(/Cotas compradas/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Valor do aporte (R$)")).toBeInTheDocument();
    expect(
      screen.getByText("XPML11 não tem a quantidade de cotas cadastrada. Edite o ativo e preencha a quantidade para informar as cotas compradas no aporte."),
    ).toBeInTheDocument();
  });

  it("cotas inválidas mostram o erro e bloqueiam o envio", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderCard();
    await openForm(user);

    await user.selectOptions(screen.getByLabelText("Ativo"), "6");
    await user.type(screen.getByLabelText("Valor do aporte (R$)"), "100");
    const shares = screen.getByLabelText("Cotas compradas (opcional)");
    await user.type(shares, "abc");
    expect(screen.getByText("Quantidade inválida.")).toBeInTheDocument();
    expect(shares).toBeInvalid();
    expect(shares).toHaveAccessibleDescription(/Quantidade inválida\./);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const submit = screen.getAllByRole("button", { name: "Registrar aporte" }).at(-1)!;
    expect(submit).toBeDisabled();

    await user.clear(shares);
    expect(submit).toBeEnabled();
    expect(calls.some((c) => c.init?.method === "POST")).toBe(false);
  });

  it("não deixa registrar sem ativo e sem valor", async () => {
    const user = userEvent.setup();
    mockApi();
    renderCard();
    await openForm(user);
    expect(screen.getAllByRole("button", { name: "Registrar aporte" }).at(-1)).toBeDisabled();
  });
});

const aporteMovement = {
  id: 6,
  date: "2026-10-06",
  kind: "aporte",
  asset_id: 2,
  asset_name: "Cofrinho Mercado Pago",
  related_asset_id: null,
  related_asset_name: null,
  amount_cents: 9_000,
  cost_cents: null,
  initial: false,
  off_goal: false,
};

describe("Movimentações: registrar provento", () => {
  it("avisa, no campo Creditar em, que provento sem crédito pode ser contado duas vezes", async () => {
    const user = userEvent.setup();
    mockApi();
    renderCard();
    const open = await screen.findByRole("button", { name: "Registrar provento" });
    await waitFor(() => expect(open).toBeEnabled());
    await user.click(open);

    const credit = screen.getByLabelText(/^Creditar em \(opcional\)/);
    expect(credit).toHaveAccessibleName(/pode ser contado duas vezes/);
    expect(credit).toHaveAccessibleName(/conta da corretora/);

    await user.selectOptions(screen.getByLabelText(/^Ativo que pagou/), "3");
    await user.selectOptions(credit, "2");
    expect(credit).toHaveAccessibleName(/conta uma vez só no rendimento/);
  });
});

describe("Movimentações: fora da meta do mês", () => {
  const nb = (text: string | null) => (text ?? "").replace(/ /g, " ");

  it("o formulário traz a caixa desmarcada, com a explicação ligada a ela", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderCard();
    await openForm(user);

    const box = screen.getByRole("checkbox", { name: "Fora da meta do mês" });
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription(/não no plano do mês, na sequência nem no ritmo de aporte/);

    await user.selectOptions(screen.getByLabelText("Ativo"), "2");
    await user.type(screen.getByLabelText("Valor do aporte (R$)"), "90");
    await user.click(screen.getAllByRole("button", { name: "Registrar aporte" }).at(-1)!);
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.init?.method === "POST")!.init!.body))).not.toHaveProperty("off_goal");
  });

  it("marcada, envia off_goal com o aporte", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderCard();
    await openForm(user);

    await user.selectOptions(screen.getByLabelText("Ativo"), "2");
    await user.type(screen.getByLabelText("Valor do aporte (R$)"), "90");
    await user.click(screen.getByRole("checkbox", { name: "Fora da meta do mês" }));
    await user.click(screen.getAllByRole("button", { name: "Registrar aporte" }).at(-1)!);

    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.init?.method === "POST")!.init!.body))).toMatchObject({
      contribution_cents: 9_000,
      off_goal: true,
    });
  });

  it("o aporte marcado ganha o selo em texto e a ação de voltar a contar; o resumo mostra o total fora da meta", async () => {
    mockApi([{ ...aporteMovement, off_goal: true }], [], { ...emptySummary, registered_cents: 9_000, total_cents: 9_000, off_goal_cents: 9_000 });
    renderCard();

    expect(await screen.findByText("Fora da meta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Contar na meta.*R\$\s90,00 em Cofrinho Mercado Pago/ })).toBeInTheDocument();
    expect(nb((await screen.findByText(/Total investido no mês/)).textContent)).toContain("· Fora da meta: R$ 90,00");
  });

  it("sem aporte marcado, não há selo nem linha de fora da meta", async () => {
    mockApi([aporteMovement]);
    renderCard();
    expect(await screen.findByText(/Total investido no mês/)).not.toHaveTextContent("Fora da meta");
    expect(screen.queryByText("Fora da meta")).not.toBeInTheDocument();
  });

  it("“Tirar da meta” grava off_goal e diz o que foi feito e o que muda", async () => {
    const user = userEvent.setup();
    const calls = mockApi([aporteMovement]);
    renderCard();

    await user.click(await screen.findByRole("button", { name: /^Tirar da meta.*R\$\s90,00 em Cofrinho Mercado Pago/ }));

    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.init?.method === "PATCH")!;
    expect(patch.url).toBe("/api/v1/movements/6");
    expect(JSON.parse(String(patch.init!.body))).toEqual({ off_goal: true });
    const status = await screen.findByRole("status");
    expect(nb(status.textContent)).toBe(
      "Aporte de R$ 90,00 em Cofrinho Mercado Pago marcado como fora da meta. Ele continua no investido; o plano do mês e a sequência deixam de contá-lo.",
    );
  });

  it("“Contar na meta” desmarca e avisa que o plano volta a contar o aporte", async () => {
    const user = userEvent.setup();
    const calls = mockApi([{ ...aporteMovement, off_goal: true }]);
    renderCard();

    await user.click(await screen.findByRole("button", { name: /^Contar na meta/ }));

    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.init?.method === "PATCH")!.init!.body))).toEqual({ off_goal: false });
    expect(nb((await screen.findByRole("status")).textContent)).toContain("voltou a contar na meta");
  });

  it("só o aporte tem a ação: provento não", async () => {
    mockApi([{ ...aporteMovement, id: 7, kind: "provento", related_asset_name: null }]);
    renderCard();
    await screen.findByRole("button", { name: /^Editar provento/ });
    expect(screen.queryByRole("button", { name: /meta/ })).not.toBeInTheDocument();
  });
});

describe("Movimentações: desfazer", () => {
  it("explica o efeito antes de confirmar e desfaz o aporte", async () => {
    const user = userEvent.setup();
    const calls = mockApi([aporteMovement]);
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Desfazer aporte de Cofrinho Mercado Pago" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("sai do investido e do saldo");
    expect(calls.some((c) => c.url.includes("/undo"))).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Desfazer movimento" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/v1/movements/6/undo")).toBe(true));
    expect(calls.find((c) => c.url === "/api/v1/movements/6/undo")!.init?.method).toBe("POST");
  });

  it("avisa que a quantidade de cotas não volta sozinha quando o ativo tem quantidade", async () => {
    const user = userEvent.setup();
    mockApi([{ ...aporteMovement, asset_id: 6, asset_name: "HGLG11" }]);
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Desfazer aporte de HGLG11" }));

    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "A quantidade de cotas de HGLG11 não volta sozinha; confira no cadastro do ativo.",
    );
  });

  it("não fala de cotas quando o ativo não tem quantidade", async () => {
    const user = userEvent.setup();
    mockApi([aporteMovement]);
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Desfazer aporte de Cofrinho Mercado Pago" }));

    expect(await screen.findByRole("alertdialog")).not.toHaveTextContent("quantidade de cotas");
  });

  it("não faz nada quando a pessoa não confirma", async () => {
    const user = userEvent.setup();
    const calls = mockApi([aporteMovement]);
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Desfazer aporte de Cofrinho Mercado Pago" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("/undo"))).toBe(false);
  });

  it("descreve cada tipo de movimento", () => {
    const base = { ...aporteMovement, asset_name: "Destino", related_asset_name: "Origem", related_asset_id: 1 };
    expect(undoMessage({ ...base, kind: "transferencia" } as never)).toContain("voltam para a origem");
    expect(undoMessage({ ...base, kind: "provento" } as never)).toContain("sai do saldo de Origem");
  });
});

describe("Movimentações: editar", () => {
  async function openEdit(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Editar aporte de Cofrinho Mercado Pago" }));
    return screen.getByRole("form", { name: "Editar aporte de Cofrinho Mercado Pago" });
  }

  it("só habilita salvar depois de mudar algo e envia apenas o que mudou", async () => {
    const user = userEvent.setup();
    const calls = mockApi([aporteMovement]);
    renderCard();
    await openEdit(user);

    const save = screen.getByRole("button", { name: "Salvar alterações" });
    expect(save).toBeDisabled();
    const amount = screen.getByLabelText("Valor (R$)");
    expect(amount).toHaveValue("90,00");

    await user.clear(amount);
    await user.type(amount, "50");
    await user.click(save);

    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.init?.method === "PATCH")!;
    expect(patch.url).toBe("/api/v1/movements/6");
    expect(JSON.parse(String(patch.init!.body))).toEqual({ amount_cents: 5_000 });
    expect(await screen.findByRole("status")).toHaveTextContent("Aporte atualizado: R$ 50,00");
  });

  it("não deixa salvar valor inválido ou data no futuro e Cancelar não envia nada", async () => {
    const user = userEvent.setup();
    const calls = mockApi([aporteMovement]);
    renderCard();
    await openEdit(user);

    await user.clear(screen.getByLabelText("Valor (R$)"));
    await user.type(screen.getByLabelText("Valor (R$)"), "abc");
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();
    expect(screen.getByText("Valor inválido.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("form", { name: /Editar aporte/ })).not.toBeInTheDocument();
    expect(calls.some((c) => c.init?.method === "PATCH")).toBe(false);
  });

  it("explica o efeito de cada tipo antes de salvar", () => {
    const base = { ...aporteMovement, asset_name: "Destino", related_asset_name: "Origem", related_asset_id: 1 };
    expect(editHint(base as never)).toContain("pertencer a ele");
    expect(editHint({ ...base, kind: "transferencia" } as never)).toContain("total investido da carteira não muda");
    expect(editHint({ ...base, kind: "provento" } as never)).toContain("creditado em Origem");
    expect(editHint({ ...base, kind: "provento", related_asset_id: null, related_asset_name: null } as never)).toContain(
      "nenhum saldo é alterado",
    );
  });
});

describe("Movimentações: aporte numa conta com caixa ativado", () => {
  const withAccount = { ...cofrinho, account_id: 5 };
  const account = { id: 5, name: "Mercado Pago", archived: false, cash_enabled: true, opening_date: "2000-01-01", balance_cents: 5_000 };

  function mockWithCash() {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const method = init?.method ?? "GET";
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
        if (method === "GET" && url.includes("/accounts")) return json([account]);
        if (method === "GET" && url.includes("/assets")) return json([withAccount, { ...withAccount, id: 3, name: "Outro" }]);
        if (method === "GET" && url.includes("/movements")) return json([]);
        return json({});
      }),
    );
    return calls;
  }

  async function fill(user: ReturnType<typeof userEvent.setup>, value: string) {
    await openForm(user);
    await user.selectOptions(screen.getByLabelText("Ativo"), "2");
    await user.type(screen.getByLabelText("Valor do aporte (R$)"), value);
  }

  const body = (calls: { init?: RequestInit }[]) => JSON.parse(String(calls.find((c) => c.init?.method === "POST")!.init!.body));

  it("avisa que o aporte entra no caixa como dinheiro novo e, por padrão, não usa o caixa", async () => {
    const user = userEvent.setup();
    const calls = mockWithCash();
    renderCard();
    await fill(user, "30");

    expect(await screen.findByText(/Este aporte também entra no caixa da conta/)).toHaveTextContent("o capital aportado sobe");
    await user.click(screen.getAllByRole("button", { name: "Registrar aporte" }).at(-1)!);
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    expect(body(calls)).not.toHaveProperty("use_cash");
  });

  it("com “Usar o dinheiro que já está no caixa”, envia use_cash e explica que o capital não muda", async () => {
    const user = userEvent.setup();
    const calls = mockWithCash();
    renderCard();
    await fill(user, "30");

    await user.click(await screen.findByRole("checkbox", { name: /Usar o dinheiro que já está no caixa de Mercado Pago/ }));
    expect(screen.getByText(/Este aporte também entra no caixa da conta/)).toHaveTextContent("o capital aportado não muda");
    await user.click(screen.getAllByRole("button", { name: "Registrar aporte" }).at(-1)!);
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    expect(body(calls)).toMatchObject({ contribution_cents: 3_000, use_cash: true });
  });

  it("caixa insuficiente bloqueia e diz o motivo", async () => {
    const user = userEvent.setup();
    const calls = mockWithCash();
    renderCard();
    await fill(user, "80");

    await user.click(await screen.findByRole("checkbox", { name: /Usar o dinheiro que já está no caixa/ }));
    const submit = screen.getAllByRole("button", { name: "Registrar aporte" }).at(-1)!;
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription(/não cobre o aporte/);
    expect(calls.some((c) => c.init?.method === "POST")).toBe(false);
  });

  it("aporte antes do saldo inicial fica só na carteira, sem a opção de usar o caixa", async () => {
    const user = userEvent.setup();
    mockWithCash();
    renderCard();
    await fill(user, "30");
    await user.clear(screen.getByLabelText("Dia do aporte"));
    await user.type(screen.getByLabelText("Dia do aporte"), "1999-12-31");

    expect(await screen.findByText(/anterior ao saldo inicial do caixa de Mercado Pago/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Usar o dinheiro/ })).not.toBeInTheDocument();
  });
});

describe("Movimentações: investimento novo e total do mês", () => {
  const nb = (text: string | null) => (text ?? "").replace(/ /g, " ");
  const initialMovement = { ...aporteMovement, id: 8, date: "2026-10-03", amount_cents: 71_391, initial: true };

  it("mostra aportes, ativos novos, total investido e proventos do resumo do mês", async () => {
    mockApi([], [], {
      ...emptySummary,
      registered_cents: 9_000,
      new_assets_cents: 71_391,
      total_cents: 80_391,
      proventos_cents: 1_250,
      new_assets: [{ asset_id: 2, asset_name: "Cofrinho Mercado Pago", amount_cents: 71_391 }],
    });
    renderCard();
    const line = await screen.findByText(/Total investido no mês/);
    expect(nb(line.textContent)).toBe("Aportes: R$ 90,00 · Ativos novos: R$ 713,91 · Total investido no mês: R$ 803,91 · Proventos: R$ 12,50");
  });

  it("sem separado no mês, a linha do total não ganha nada novo", async () => {
    mockApi([], [], { ...emptySummary, registered_cents: 9_000, total_cents: 9_000, reserved_cents: 0 });
    renderCard();
    const line = await screen.findByText(/Total investido no mês/);
    expect(nb(line.textContent)).not.toContain("Separado");
    expect(nb(line.textContent)).toBe("Aportes: R$ 90,00 · Ativos novos: R$ 0,00 · Total investido no mês: R$ 90,00 · Proventos: R$ 0,00");
  });

  it("com separado no mês, mostra o separado com rótulo próprio e a soma visível fecha com o total", async () => {
    // R$ 40 separados em outubro; a compra de R$ 100 só acontece no mês seguinte, usando esse separado.
    mockApi([], [], { ...emptySummary, registered_cents: 9_000, new_assets_cents: 71_391, reserved_cents: 4_000, total_cents: 84_391 });
    renderCard();
    const line = await screen.findByText(/Total investido no mês/);
    expect(nb(line.textContent)).toBe(
      "Aportes: R$ 90,00 · Ativos novos: R$ 713,91 · Separado no mês: R$ 40,00 · Total investido no mês: R$ 843,91 · Proventos: R$ 0,00",
    );
    expect(9_000 + 71_391 + 4_000).toBe(84_391);
  });

  it("aporte do cadastro tem selo, não se edita e oferece “Não contar como aporte” em vez de desfazer", async () => {
    mockApi([initialMovement]);
    renderCard();
    expect(await screen.findByText("Ativo novo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Não contar como aporte: Cofrinho Mercado Pago" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Editar aporte/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Desfazer/ })).not.toBeInTheDocument();
  });

  it("confirma dizendo que o saldo não muda e grava o ativo como antigo", async () => {
    const user = userEvent.setup();
    const calls = mockApi([initialMovement]);
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Não contar como aporte: Cofrinho Mercado Pago" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("o saldo não muda");
    expect(calls.some((c) => c.init?.method === "PUT")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Não contar como aporte" }));

    await waitFor(() => expect(calls.some((c) => c.init?.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(put.url).toBe("/api/v1/assets/2");
    expect(JSON.parse(String(put.init!.body))).toMatchObject({ name: "Cofrinho Mercado Pago", account_id: null, is_new_investment: false });
    expect(calls.some((c) => c.url.includes("/undo"))).toBe(false);
    expect(nb((await screen.findByRole("status")).textContent)).toBe(
      "R$ 713,91 de Cofrinho Mercado Pago não conta mais como aporte de outubro. O saldo do ativo não mudou.",
    );
  });

  it("sem confirmar, nada é enviado", async () => {
    const user = userEvent.setup();
    const calls = mockApi([initialMovement]);
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Não contar como aporte: Cofrinho Mercado Pago" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    expect(calls.some((c) => c.init?.method === "PUT")).toBe(false);
  });
});

describe("Movimentações: link para as retiradas", () => {
  it("com resgates no mês, o total ganha o link para ver todas as retiradas", async () => {
    mockApi([], [], { ...emptySummary, redemptions_cents: 50_000 });
    renderCard();
    expect(await screen.findByRole("link", { name: "Ver todas as retiradas" })).toHaveAttribute("href", "/carteira/retiradas");
  });

  it("sem resgates no mês, não há link", async () => {
    mockApi();
    renderCard();
    await screen.findByText(/Total investido no mês/);
    expect(screen.queryByRole("link", { name: "Ver todas as retiradas" })).not.toBeInTheDocument();
  });
});
