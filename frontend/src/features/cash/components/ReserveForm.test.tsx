import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "@/features/portfolio";
import { todayISO } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import type { Account } from "../types";
import { ReserveForm } from "./ReserveForm";

const today = todayISO();
const account: Account = {
  id: 1,
  name: "XP",
  institution_id: 1,
  archived: false,
  cash_enabled: true,
  opening_date: "2000-01-01",
  balance_cents: 50_000,
  reserved_cents: 10_000,
  free_cents: 40_000,
};

// A API devolve até as arquivadas aqui de propósito: a tela precisa filtrar sozinha.
const classes = [
  { id: 3, key: "fii", name: "FII", color: "#5e8a57", archived: false },
  { id: 4, key: "acoes", name: "Ações", color: "#c46f4e", archived: false },
  { id: 5, key: "cripto", name: "Cripto", color: "#8b5e7d", archived: true },
  { id: 6, key: "etf", name: "ETF", color: "#5b7c93", archived: false },
];
const assets = [
  { id: 7, class_key: "fii", archived: false, hold_only: false, purpose: null },
  { id: 8, class_key: "acoes", archived: false, hold_only: true, purpose: null },
] as Asset[];

interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

function mockApi(createReply?: { status: number; body: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "GET" && url.startsWith("/api/v1/asset-classes")) return new Response(JSON.stringify(classes), { status: 200 });
      if (method === "POST" && createReply) return new Response(JSON.stringify(createReply.body), { status: createReply.status });
      return new Response(JSON.stringify({ id: 1 }), { status: 201 });
    }),
  );
  return calls;
}

function renderForm(onDone = vi.fn<(message: MoneyTextPart[]) => void>()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReserveForm account={account} assets={assets} onDone={onDone} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );
  return onDone;
}

const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");
const flat = (parts: MoneyTextPart[]) => parts.map((p) => (typeof p === "string" ? p : `R$ ${(p.cents / 100).toFixed(2).replace(".", ",")}`)).join("");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Separar para comprar", () => {
  it("só oferece categorias válidas: sem arquivadas e sem as só em manter posição", async () => {
    mockApi();
    renderForm();
    const select = await screen.findByRole("combobox", { name: "Categoria" });
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(3));
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Escolha a categoria", "FII", "ETF"]);
  });

  it("mostra antes como ficam o caixa livre e o separado, e envia categoria, valor e data", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    const onDone = renderForm();

    await waitFor(() => expect(screen.getByRole("option", { name: "FII" })).toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "Categoria" })).toHaveFocus();
    const submit = screen.getByRole("button", { name: "Separar para comprar" });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription("Escolha a categoria.");

    await user.selectOptions(screen.getByRole("combobox", { name: "Categoria" }), "3");
    await user.type(screen.getByLabelText("Valor a separar (R$)"), "100");
    expect(screen.getByText(/^Caixa livre: de/)).toHaveTextContent("Caixa livre: de R$ 400,00 para R$ 300,00");
    expect(screen.getByText(/^Separado para comprar: de/)).toHaveTextContent("de R$ 100,00 para R$ 200,00");
    expect(screen.queryByText(/^Total na conta: de/)).not.toBeInTheDocument();
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0]).toMatchObject({ url: "/api/v1/accounts/1/reservations", body: { class_id: 3, amount_cents: 10_000, date: today } });
    expect(posts(calls)[0].body).not.toHaveProperty("deposit");
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const message = flat(onDone.mock.calls[0][0]);
    expect(message).toContain("R$ 100,00 separados para FII");
    expect(message).toContain("Caixa livre: R$ 300,00");
    expect(message).toContain("ainda não investido");
    expect(message).toContain("o valor sai do separado primeiro");
  });

  it("acima do caixa livre diz quanto falta e só deixa seguir marcando “Depositar agora e separar”", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderForm();

    await user.selectOptions(await screen.findByRole("combobox", { name: "Categoria" }), "3");
    await user.type(screen.getByLabelText("Valor a separar (R$)"), "500");
    const submit = screen.getByRole("button", { name: "Separar para comprar" });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription(/O caixa livre não cobre/);
    expect(screen.getByText(/faltam/)).toHaveTextContent("O caixa livre tem R$ 400,00: faltam R$ 100,00");

    await user.click(screen.getByRole("checkbox", { name: "Depositar agora e separar" }));
    expect(submit).toBeEnabled();
    expect(screen.getByText(/^Total na conta: de/)).toHaveTextContent("de R$ 500,00 para R$ 1.000,00");
    await user.click(submit);

    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toEqual({ class_id: 3, amount_cents: 50_000, date: today, deposit: true });
  });

  it("se a API recusar por falta de caixa livre, mostra quanto falta e oferece “Depositar e separar”", async () => {
    const user = userEvent.setup();
    const calls = mockApi({ status: 422, body: { detail: "Caixa livre insuficiente em XP: faltam R$ 50,00.", shortfall_cents: 5_000 } });
    renderForm();

    await user.selectOptions(await screen.findByRole("combobox", { name: "Categoria" }), "3");
    await user.type(screen.getByLabelText("Valor a separar (R$)"), "100");
    await user.click(screen.getByRole("button", { name: "Separar para comprar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Caixa livre insuficiente em XP");
    expect(screen.getByText(/no caixa livre para separar esse valor/)).toHaveTextContent("Faltam R$ 50,00");
    await user.click(screen.getByRole("button", { name: "Depositar e separar" }));

    await waitFor(() => expect(posts(calls)).toHaveLength(2));
    expect(posts(calls)[1].body).toEqual({ class_id: 3, amount_cents: 10_000, date: today, deposit: true });
    expect(screen.getByRole("checkbox", { name: "Depositar agora e separar" })).toBeChecked();
  });

  it("outro erro da API aparece como alerta, sem a oferta de depósito", async () => {
    const user = userEvent.setup();
    mockApi({ status: 422, body: { detail: "A categoria está arquivada." } });
    renderForm();

    await user.selectOptions(await screen.findByRole("combobox", { name: "Categoria" }), "3");
    await user.type(screen.getByLabelText("Valor a separar (R$)"), "100");
    await user.click(screen.getByRole("button", { name: "Separar para comprar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A categoria está arquivada.");
    expect(screen.queryByRole("button", { name: "Depositar e separar" })).not.toBeInTheDocument();
  });
});
