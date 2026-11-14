import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "@/features/portfolio";
import { todayISO } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import type { Account, ReservationsOverview } from "../types";
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

describe("Comprar ativo com o caixa: com dinheiro separado", () => {
  const withReserved: Account = { ...account, reserved_cents: 20_000, free_cents: 30_000 };
  const hglg = { ...fii, class_name: "FII" } as Asset;
  const bova = { ...etf, class_name: "ETF" } as Asset;
  const overview: ReservationsOverview = {
    reserved_cents: 20_000,
    free_cents: 30_000,
    by_class: [{ class_id: 3, class_name: "FII", color: "#5e8a57", remaining_cents: 20_000 }],
    reservations: [
      { id: 11, account_id: 2, class_id: 3, class_name: "FII", date: "2026-10-05", amount_cents: 20_000, used_cents: 0, released_cents: 0, remaining_cents: 20_000, deletable: true },
    ],
  };

  function mockReserved(result: Record<string, unknown> = {}) {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (method === "GET") return new Response(JSON.stringify(overview), { status: 200 });
        return new Response(
          JSON.stringify({ movement: { id: 1 }, account_id: 2, deposit_cents: 0, cash_balance_cents: 40_000, ...result }),
          { status: 201 },
        );
      }),
    );
    return calls;
  }

  function renderReserved(acc: Account = withReserved) {
    const onDone = vi.fn<(message: MoneyTextPart[]) => void>();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PurchaseForm account={acc} assets={[hglg, bova]} onDone={onDone} onCancel={vi.fn()} />
      </QueryClientProvider>,
    );
    return onDone;
  }

  const text = (parts: MoneyTextPart[]) => parts.map((p) => (typeof p === "string" ? p : `R$ ${(p.cents / 100).toFixed(2).replace(".", ",")}`)).join("");

  it("antes de confirmar, diz quanto sai do separado da categoria e quanto do caixa livre", async () => {
    const user = userEvent.setup();
    mockReserved();
    renderReserved();

    await user.selectOptions(screen.getByLabelText("Ativo comprado"), "7");
    await user.type(screen.getByLabelText("Valor da compra (R$)"), "500");
    expect(await screen.findByText(/^Vai usar/)).toHaveTextContent("Vai usar R$ 200,00 do separado para FII e R$ 300,00 do caixa livre.");
    expect(screen.getByRole("button", { name: "Registrar compra" })).toBeEnabled();
  });

  it("compra pequena sai toda do separado", async () => {
    const user = userEvent.setup();
    mockReserved();
    renderReserved();

    await user.selectOptions(screen.getByLabelText("Ativo comprado"), "7");
    await user.type(screen.getByLabelText("Valor da compra (R$)"), "100");
    expect(await screen.findByText(/^Vai usar/)).toHaveTextContent("Vai usar R$ 100,00 do separado para FII e R$ 0,00 do caixa livre.");
  });

  it("o separado de outra categoria não paga a compra: só o caixa livre", async () => {
    const user = userEvent.setup();
    mockReserved();
    renderReserved();

    await user.selectOptions(screen.getByLabelText("Ativo comprado"), "8");
    await user.type(screen.getByLabelText("Valor da compra (R$)"), "200");
    expect(await screen.findByText(/^Não há nada separado para ETF/)).toHaveTextContent("vai usar R$ 200,00 do caixa livre");

    await user.clear(screen.getByLabelText("Valor da compra (R$)"));
    await user.type(screen.getByLabelText("Valor da compra (R$)"), "400");
    const submit = screen.getByRole("button", { name: "Registrar compra" });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/O caixa livre tem/)).toHaveTextContent("O caixa livre tem R$ 300,00: faltam R$ 100,00 para esta compra.");
  });

  it("no sucesso diz o que saiu do separado, do caixa livre e quanto ainda está separado", async () => {
    const user = userEvent.setup();
    const calls = mockReserved({ from_reserved_cents: 10_000, from_free_cents: 0, reserved_left_cents: 10_000 });
    const onDone = renderReserved();

    await user.selectOptions(screen.getByLabelText("Ativo comprado"), "7");
    await user.type(screen.getByLabelText("Valor da compra (R$)"), "100");
    await user.click(screen.getByRole("button", { name: "Registrar compra" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls.filter((c) => c.method === "POST")[0].body).toEqual({ asset_id: 7, amount_cents: 10_000, date: today });
    const message = text(onDone.mock.calls[0][0]);
    expect(message).toContain("Compra registrada. R$ 100,00 saíram do separado e R$ 0,00 do caixa livre.");
    expect(message).toContain("Ainda há R$ 100,00 separados para FII.");
  });

  it("sem nada separado na conta, nada extra aparece: nem busca, nem prévia, nem a frase nova", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    const onDone = renderForm();

    await user.selectOptions(screen.getByLabelText("Ativo comprado"), "7");
    await user.type(screen.getByLabelText("Valor da compra (R$)"), "100");
    expect(screen.queryByText(/^Vai usar/)).not.toBeInTheDocument();
    expect(screen.queryByText(/separado/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Registrar compra" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls.some((c) => c.url.includes("reservations"))).toBe(false);
    expect(text(onDone.mock.calls[0][0] as MoneyTextPart[])).toMatch(/^Compra registrada: R\$ 100,00 em HGLG11/);
    expect(text(onDone.mock.calls[0][0] as MoneyTextPart[])).not.toContain("separado");
  });
});
