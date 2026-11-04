import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todayISO } from "@/shared/lib/format";
import type { Asset } from "../types";
import { RedemptionForm } from "./RedemptionForm";

const reserva = {
  id: 2,
  name: "Cofrinho Mercado Pago",
  institution_name: "Mercado Pago",
  purpose: "reserva",
  account_id: 5,
  archived: false,
  invested_cents: 71_391,
  current_cents: 80_391,
  valuation_date: "2000-01-01",
} as Asset;
const cdb = { ...reserva, id: 3, name: "CDB Banco X", purpose: null, account_id: null } as Asset;

const account = { id: 5, name: "Mercado Pago", archived: false, cash_enabled: true, opening_date: "2000-01-01", balance_cents: 5_000 };

const movement = {
  id: 40,
  date: todayISO(),
  kind: "resgate",
  asset_id: 2,
  asset_name: "Cofrinho Mercado Pago",
  related_asset_id: null,
  related_asset_name: null,
  amount_cents: 10_000,
  cost_cents: 8_880,
  initial: false,
  note: null,
  in_balance: false,
};

function mockApi(redemption: () => Response = () => new Response(JSON.stringify(movement), { status: 201 }), accounts: unknown[] = [account]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if ((init?.method ?? "GET") === "POST" && url.endsWith("/redemptions")) return redemption();
      if (url.includes("/accounts")) return new Response(JSON.stringify(accounts), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
  return calls;
}

function renderForm(props: { assets?: Asset[]; initialAssetId?: number | null } = {}) {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RedemptionForm assets={props.assets ?? [reserva, cdb]} initialAssetId={props.initialAssetId} onDone={onDone} onCancel={onCancel} />
    </QueryClientProvider>,
  );
  return { onDone, onCancel };
}

const submitButton = () => screen.getByRole("button", { name: /Registrar resgate|Registrando/ });
const bodyOf = (calls: { url: string; init?: RequestInit }[]) =>
  JSON.parse(String(calls.find((c) => c.url.endsWith("/redemptions"))!.init!.body));

afterEach(() => vi.unstubAllGlobals());

describe("Resgate: formulário", () => {
  it("explica que resgate não é prejuízo e começa com o botão desabilitado, dizendo o que falta", async () => {
    mockApi();
    renderForm();
    expect(screen.getByRole("form", { name: "Registrar resgate" })).toHaveTextContent("não é prejuízo");
    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveAccessibleDescription("Para registrar: Escolha o ativo do resgate.");
  });

  it("abre com o foco no ativo", async () => {
    mockApi();
    renderForm();
    expect(screen.getByLabelText("Ativo")).toHaveFocus();
  });

  it("com o ativo já escolhido, abre no valor", async () => {
    mockApi();
    renderForm({ initialAssetId: 2 });
    expect(screen.getByLabelText("Ativo")).toHaveValue("2");
    expect(screen.getByLabelText("Valor resgatado (R$)")).toHaveFocus();
  });

  it("mostra a prévia de saldo e investido e envia centavos, data de hoje e motivo", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    const { onDone } = renderForm({ initialAssetId: 2 });

    await user.type(screen.getByLabelText("Valor resgatado (R$)"), "100");
    const preview = screen.getByText(/^Saldo de Cofrinho Mercado Pago/);
    expect(preview).toHaveTextContent("de R$ 803,91 para R$ 703,91");
    expect(preview).toHaveTextContent("Investido: de R$ 713,91 para R$ 625,11");
    expect(preview).not.toHaveAttribute("role"); // a prévia visual não é anunciada a cada tecla
    await user.type(screen.getByLabelText("Motivo (opcional)"), "  Conserto do carro ");
    expect(screen.getByText(/^20\/120 caracteres/)).toBeInTheDocument();
    await user.click(submitButton());

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(bodyOf(calls)).toEqual({
      asset_id: 2,
      amount_cents: 10_000,
      date: todayISO(),
      note: "Conserto do carro",
      credit_cash: false,
      already_in_balance: false,
    });
    expect(onDone.mock.calls[0]![0]).toMatchObject({ creditedAccount: null, alreadyInBalance: false });
  });

  it("motivo vazio vai como null e o campo limita em 120 caracteres", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderForm({ initialAssetId: 3 });
    expect(screen.getByLabelText("Motivo (opcional)")).toHaveAttribute("maxlength", "120");
    await user.type(screen.getByLabelText("Valor resgatado (R$)"), "50");
    await user.click(submitButton());
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/redemptions"))).toBe(true));
    expect(bodyOf(calls).note).toBeNull();
  });

  it("“Tudo” preenche o saldo registrado", async () => {
    const user = userEvent.setup();
    mockApi();
    renderForm({ initialAssetId: 3 });
    await user.click(screen.getByRole("button", { name: "Resgatar tudo de CDB Banco X" }));
    expect(screen.getByLabelText("Valor resgatado (R$)")).toHaveValue("803,91");
  });

  it("valor maior que o saldo bloqueia antes de ir ao servidor, com o motivo no campo", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderForm({ initialAssetId: 2 });
    await user.type(screen.getByLabelText("Valor resgatado (R$)"), "900");

    expect(screen.getByText(/Maior que o saldo registrado de Cofrinho Mercado Pago/)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveAccessibleDescription("Para registrar: Corrija o valor indicado acima.");
    expect(screen.queryByText(/^Saldo de Cofrinho Mercado Pago/)).not.toBeInTheDocument(); // sem prévia de um valor impossível
    expect(calls.some((c) => c.url.endsWith("/redemptions"))).toBe(false);
  });

  it("data antes do último saldo bloqueia no modo normal", async () => {
    const user = userEvent.setup();
    mockApi();
    renderForm({ assets: [{ ...reserva, valuation_date: "2026-10-15" }], initialAssetId: 2 });
    await user.type(screen.getByLabelText("Valor resgatado (R$)"), "10");
    await user.clear(screen.getByLabelText("Data do resgate"));
    await user.type(screen.getByLabelText("Data do resgate"), "2026-10-10");
    expect(screen.getByText(/Antes do último saldo de Cofrinho Mercado Pago \(15\/10\/2026\)/)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });
});

describe("Resgate: o saldo já digitado já está sem o dinheiro", () => {
  const withBalanceDate = { ...reserva, valuation_date: "2026-10-15" } as Asset;

  it("mostra o saldo atual com a data e, ao marcar, explica que só o investido muda", async () => {
    const user = userEvent.setup();
    mockApi();
    renderForm({ assets: [withBalanceDate], initialAssetId: 2 });

    const box = screen.getByRole("checkbox", { name: "O saldo que já digitei já está sem esse dinheiro" });
    expect(box).toHaveAccessibleDescription(/Último valor registrado de Cofrinho Mercado Pago: R\$\s803,91 em 15\/10\/2026/);
    expect(box).toHaveAccessibleDescription(/Deixe desmarcado se o saldo ainda inclui esse dinheiro/);

    await user.click(box);
    expect(box).toHaveAccessibleDescription(/só reduz o investido, para o mesmo dinheiro não ser descontado duas vezes/);
  });

  it("envia already_in_balance, exige a data do saldo ou antes e oferece usá-la", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderForm({ assets: [withBalanceDate], initialAssetId: 2 });
    await user.type(screen.getByLabelText("Valor resgatado (R$)"), "100");
    await user.click(screen.getByRole("checkbox", { name: /já está sem esse dinheiro/ }));

    // Hoje é depois do saldo: bloqueia e oferece a data do saldo.
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(/o resgate é de 15\/10\/2026 ou antes/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Usar 15/10/2026, a data do saldo" }));
    expect(screen.getByLabelText("Data do resgate")).toHaveValue("2026-10-15");
    expect(screen.getByText(/fica no último valor registrado/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /já está sem esse dinheiro/ })).toHaveAccessibleDescription(/servidor confere se existe um saldo digitado/);

    await user.click(submitButton());
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/redemptions"))).toBe(true));
    expect(bodyOf(calls)).toMatchObject({ already_in_balance: true, date: "2026-10-15", amount_cents: 10_000 });
  });
});

describe("Resgate: caixa da conta", () => {
  it("só oferece creditar no caixa quando a conta tem caixa e envia credit_cash", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    const { onDone } = renderForm({ initialAssetId: 2 });

    const box = await screen.findByRole("checkbox", { name: "Creditar no caixa da conta Mercado Pago" });
    expect(box).not.toBeChecked();
    await user.type(screen.getByLabelText("Valor resgatado (R$)"), "100");
    await user.click(box);
    await user.click(submitButton());

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(bodyOf(calls).credit_cash).toBe(true);
    expect(onDone.mock.calls[0]![0]).toMatchObject({ creditedAccount: "Mercado Pago" });
  });

  it("ativo sem caixa não mostra a opção e manda credit_cash falso", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderForm({ initialAssetId: 3 });
    await user.type(screen.getByLabelText("Valor resgatado (R$)"), "10");
    expect(screen.queryByRole("checkbox", { name: /Creditar no caixa/ })).not.toBeInTheDocument();
    await user.click(submitButton());
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/redemptions"))).toBe(true));
    expect(bodyOf(calls).credit_cash).toBe(false);
  });
});

describe("Resgate: erro do servidor", () => {
  it("mostra a mensagem do servidor no formulário, mantém os dados e some quando a pessoa muda algo", async () => {
    const user = userEvent.setup();
    mockApi(() => new Response(JSON.stringify({ detail: "O valor é maior que o saldo na data." }), { status: 422 }));
    const { onDone } = renderForm({ initialAssetId: 2 });
    await user.type(screen.getByLabelText("Valor resgatado (R$)"), "100");
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("O valor é maior que o saldo na data.");
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Valor resgatado (R$)")).toHaveValue("100");
    expect(submitButton()).toBeEnabled();

    await user.type(screen.getByLabelText("Valor resgatado (R$)"), "5");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("Cancelar fecha sem enviar nada", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    const { onCancel } = renderForm();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.url.endsWith("/redemptions"))).toBe(false);
  });
});

describe("Resgate: anúncio para leitor de tela", () => {
  it("só anuncia o resumo depois que o valor para de mudar, e não anuncia valor inválido", async () => {
    const user = userEvent.setup();
    mockApi();
    renderForm({ initialAssetId: 2 });
    const region = document.querySelector('[role="status"]')!;
    const live = () => (region.textContent ?? "").replace(/\s/g, " ");

    expect(region).toHaveAttribute("aria-live", "polite");
    await user.type(screen.getByLabelText("Valor resgatado (R$)"), "100");
    // Logo depois de digitar, nada foi anunciado ainda (a prévia visual já mudou).
    expect(live()).toBe("");
    await waitFor(() => expect(live()).toBe("Resgate de R$ 100,00 de Cofrinho Mercado Pago: o saldo vai para R$ 703,91."), { timeout: 2000 });

    // Valor maior que o saldo: o anúncio é limpo.
    await user.clear(screen.getByLabelText("Valor resgatado (R$)"));
    await user.type(screen.getByLabelText("Valor resgatado (R$)"), "900");
    await waitFor(() => expect(live()).toBe(""), { timeout: 2000 });
  });
});
