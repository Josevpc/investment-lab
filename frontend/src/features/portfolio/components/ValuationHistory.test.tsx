import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Asset, Valuation } from "../types";
import { ValuationHistory } from "./ValuationHistory";

const asset = { id: 5, name: "VGHF11" } as Asset;

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function mockApi(valuations: Valuation[], overrides: (url: string, init?: RequestInit) => Response | undefined = () => undefined) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return overrides(url, init) ?? json(valuations);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function renderHistory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ValuationHistory asset={asset} />
    </QueryClientProvider>,
  );
}

const older: Valuation = { id: 1, asset_id: 5, date: "2026-09-30", invested_cents: 2877, current_cents: 2800 };
const latest: Valuation = { id: 2, asset_id: 5, date: "2026-10-17", invested_cents: 2877, current_cents: 553 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ValuationHistory", () => {
  it("lista os valores, marca o mais recente como atual e permite corrigi-lo", async () => {
    const user = userEvent.setup();
    const calls = mockApi([latest, older]);
    renderHistory();

    const rows = await screen.findAllByRole("row");
    // cabeçalho + 2 registros
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("atual")).toBeInTheDocument();
    expect(within(rows[2]).queryByText("atual")).not.toBeInTheDocument();

    await user.click(within(rows[1]).getByRole("button", { name: "Corrigir o valor de 17/10/2026" }));
    const current = screen.getByLabelText("Valor atual");
    await user.clear(current);
    await user.type(current, "28,10");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe("/api/v1/assets/5/valuations/2");
    expect(put.body).toEqual({ date: "2026-10-17", invested_cents: 2877, current_cents: 2810 });
  });

  it("abre a correção com campos de rótulo visível e deixa cancelar sem enviar nada", async () => {
    const user = userEvent.setup();
    const calls = mockApi([latest, older]);
    renderHistory();

    const rows = await screen.findAllByRole("row");
    expect(within(rows[1]).getByText(/Rend\./)).toBeInTheDocument();
    // No celular a coluna Investido some; o valor continua à vista, com rótulo, sob o saldo.
    expect(within(rows[1]).getByText(/Investido/)).toHaveTextContent("Investido R$ 28,77");
    // Todos os valores em reais respeitam o modo "ocultar valores" (classe .money).
    expect(rows[1].querySelectorAll(".money")).toHaveLength(5);
    await user.click(within(rows[1]).getByRole("button", { name: "Corrigir o valor de 17/10/2026" }));
    for (const label of ["Data do valor", "Valor investido", "Valor atual"]) {
      expect(screen.getByLabelText(label)).toBeVisible();
    }
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByLabelText("Valor atual")).not.toBeInTheDocument();
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("mostra o erro da API ao corrigir para uma data já usada", async () => {
    const user = userEvent.setup();
    mockApi([latest, older], (_url, init) =>
      init?.method === "PUT" ? json({ detail: "Já existe um valor registrado para esse ativo nessa data." }, 409) : undefined,
    );
    renderHistory();

    const rows = await screen.findAllByRole("row");
    await user.click(within(rows[1]).getByRole("button", { name: "Corrigir o valor de 17/10/2026" }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe um valor registrado");
  });

  it("não deixa excluir quando só há um registro, e exclui com confirmação quando há mais", async () => {
    const user = userEvent.setup();
    const calls = mockApi([latest, older], (_url, init) => (init?.method === "DELETE" ? json(null, 204) : undefined));
    renderHistory();

    await user.click(await screen.findByRole("button", { name: "Excluir o valor de 17/10/2026" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Excluir o valor de 17/10/2026?" });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Excluir valor" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(calls.find((c) => c.method === "DELETE")!.url).toBe("/api/v1/assets/5/valuations/2");
  });

  it("desabilita a exclusão do único registro", async () => {
    mockApi([latest]);
    renderHistory();
    expect(await screen.findByRole("button", { name: "Excluir o valor de 17/10/2026" })).toBeDisabled();
  });

  it("recusa valores inválidos antes de enviar", async () => {
    const user = userEvent.setup();
    const calls = mockApi([latest]);
    renderHistory();
    await user.click(await screen.findByRole("button", { name: "Corrigir o valor de 17/10/2026" }));
    await user.clear(screen.getByLabelText("Valor atual"));
    await user.type(screen.getByLabelText("Valor atual"), "abc");
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });
});
