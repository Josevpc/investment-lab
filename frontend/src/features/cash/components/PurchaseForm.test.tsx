import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "@/features/portfolio";
import { todayISO } from "@/shared/lib/format";
import type { Account } from "../types";
import { PurchaseForm } from "./PurchaseForm";

const today = todayISO();
const account: Account = {
  id: 2,
  name: "XP",
  institution_id: 1,
  archived: false,
  cash_enabled: true,
  opening_date: "2000-01-01",
  balance_cents: 50_000,
};
const fii = { id: 7, name: "HGLG11", account_id: 2, archived: false, valuation_date: "2000-01-01" } as Asset;
const etf = { ...fii, id: 8, name: "BOVA11" } as Asset;

interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

function mockApi(reply?: { status: number; body: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (reply) return new Response(JSON.stringify(reply.body), { status: reply.status });
      return new Response(
        JSON.stringify({ movement: { id: 1 }, account_id: 2, deposit_cents: 0, cash_balance_cents: 40_000 }),
        { status: 201 },
      );
    }),
  );
  return calls;
}

function renderForm(onDone = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PurchaseForm account={account} assets={[fii, etf]} onDone={onDone} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );
  return onDone;
}

const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Comprar ativo com o caixa", () => {
  it("compra que cabe no caixa vai sem depósito", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    const onDone = renderForm();

    expect(screen.getByLabelText("Ativo comprado")).toHaveFocus();
    await user.selectOptions(screen.getByLabelText("Ativo comprado"), "7");
    await user.type(screen.getByLabelText("Valor da compra (R$)"), "100");
    expect(screen.getByText(/Caixa de hoje: de/)).toHaveTextContent("de R$ 500,00 para R$ 400,00");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Registrar compra" }));

    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].url).toBe("/api/v1/purchases");
    expect(posts(calls)[0].body).toEqual({ asset_id: 7, amount_cents: 10_000, date: today });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("com falta no caixa, só deixa comprar marcando o depósito da diferença, que vai no pedido", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderForm();

    await user.selectOptions(screen.getByLabelText("Ativo comprado"), "8");
    await user.type(screen.getByLabelText("Valor da compra (R$)"), "700");
    const submit = screen.getByRole("button", { name: "Registrar compra" });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription(/não cobre a compra/);

    await user.click(screen.getByRole("checkbox", { name: /Registrar também um depósito de R\$\s200,00/ }));
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toEqual({ asset_id: 8, amount_cents: 70_000, date: today, deposit_cents: 20_000 });
  });

  it("desmarcar o depósito volta a bloquear e nada é enviado", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderForm();

    await user.selectOptions(screen.getByLabelText("Ativo comprado"), "8");
    await user.type(screen.getByLabelText("Valor da compra (R$)"), "700");
    const deposit = screen.getByRole("checkbox", { name: /Registrar também um depósito/ });
    await user.click(deposit);
    await user.click(deposit);
    expect(screen.getByRole("button", { name: "Registrar compra" })).toBeDisabled();
    expect(posts(calls)).toHaveLength(0);
  });

  it("erro 422 com falta de caixa mostra o motivo e o próximo passo", async () => {
    const user = userEvent.setup();
    mockApi({ status: 422, body: { detail: "Caixa insuficiente em XP: faltam R$ 10,00 em 05/10/2026.", shortfall_cents: 1_000 } });
    renderForm();

    await user.selectOptions(screen.getByLabelText("Ativo comprado"), "7");
    await user.type(screen.getByLabelText("Valor da compra (R$)"), "100");
    await user.click(screen.getByRole("button", { name: "Registrar compra" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Caixa insuficiente em XP");
    expect(screen.getByText(/Registre antes o depósito que trouxe esse dinheiro/)).toBeInTheDocument();
  });
});
