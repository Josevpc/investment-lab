import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetsTab } from "./AssetsTab";

function mockApi(accountsOk: boolean) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.includes("/accounts?")) return accountsOk ? json([{ id: 5, name: "XP", institution_id: 10, archived: false, cash_enabled: true }]) : json({ detail: "falhou" }, 500);
      if (url.includes("/asset-classes")) return json([{ id: 1, key: "renda_fixa", name: "Renda Fixa", color: "#2563eb", archived: false }]);
      if (url.endsWith("/institutions")) return json([{ id: 10, name: "XP" }]);
      if (init?.method === "POST") return json({ id: 9, name: "CDB", is_new_investment: true, initial_contribution_cents: 10_000, initial_contribution_date: "2026-10-26", invested_cents: 10_000, valuation_date: "2026-10-26" });
      return json([]);
    }),
  );
  return calls;
}

function renderNew() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/carteira/ativos?novo=1"]}>
        <AssetsTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("AssetsTab: contas do caixa no cadastro", () => {
  it("com as contas carregadas, o formulário mostra o campo Conta", async () => {
    mockApi(true);
    renderNew();
    expect(await screen.findByLabelText(/^Conta/)).toHaveValue("5");
  });

  it("se as contas não carregam, o formulário abre sem o campo Conta", async () => {
    mockApi(false);
    renderNew();
    expect(await screen.findByLabelText("Nome")).toBeInTheDocument();
    expect(screen.getByLabelText("Instituição")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Conta/)).not.toBeInTheDocument();
  });
});

describe("AssetsTab: novo ou antigo no cadastro", () => {
  it("envia is_new_investment com a escolha da pessoa", async () => {
    const user = userEvent.setup();
    const calls = mockApi(true);
    renderNew();
    await user.type(await screen.findByLabelText("Nome"), "CDB");
    await user.type(screen.getByLabelText("Valor atual (R$)"), "100");
    await user.click(screen.getByRole("radio", { name: /^Novo/ }));
    await user.click(screen.getByRole("button", { name: "Adicionar ativo" }));

    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.url).toBe("/api/v1/assets");
    expect(JSON.parse(String(post.init!.body))).toMatchObject({ name: "CDB", current_cents: 10_000, is_new_investment: true });
  });
});
