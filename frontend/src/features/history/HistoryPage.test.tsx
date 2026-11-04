import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Snapshot } from "./types";
import { HistoryPage } from "./HistoryPage";

// Aqui só interessa a tabela de fechamentos; abas e banner têm testes próprios.
vi.mock("@/features/overview", () => ({ NextStepBanner: () => null }));
vi.mock("./components/WealthTab", () => ({ WealthTab: () => null }));

const snapshot = (overrides: Partial<Snapshot>): Snapshot => ({
  id: 1,
  date: "2026-09-30",
  total_cents: 12_345_678,
  invested_cents: 11_000_000,
  assets_count: 4,
  manual: false,
  reserve_cents: 0,
  reserve_invested_cents: 0,
  by_class: [],
  ...overrides,
});

const snapshots = [snapshot({ reserve_cents: 150_000, reserve_invested_cents: 120_000 }), snapshot({ id: 2, date: "2026-08-31", manual: true, invested_cents: 0, total_cents: 500_000 })];

function mockApi() {
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (method === "DELETE") return new Response(null, { status: 204 });
      if (method === "PUT" || method === "POST") return new Response(JSON.stringify(snapshots[0]), { status: 200 });
      if (url.endsWith("/snapshots")) return new Response(JSON.stringify(snapshots), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    }),
  );
  return calls;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HistoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Histórico: fechamentos registrados", () => {
  it("no celular, situação e reserva (rotulada) ficam sob a data; Situação e Reserva viram colunas só a partir de md", async () => {
    mockApi();
    renderPage();

    const table = await screen.findByRole("table", { name: /Fechamentos registrados/ });
    const manualRow = within(table).getByRole("rowheader", { name: /31\/08\/2026/ });
    expect(manualRow).toHaveTextContent("Digitado");
    expect(manualRow).toHaveTextContent("sem valor investido: afeta o desempenho");
    expect(manualRow).not.toHaveTextContent("Reserva"); // sem reserva, não ocupa linha
    const walletRow = within(table).getByRole("rowheader", { name: /30\/09\/2026/ });
    expect(walletRow).toHaveTextContent("Da carteira · 4 ativos");
    expect(walletRow).toHaveTextContent("Reserva: R$ 1.500,00");

    const header = (name: string) => within(table).getByRole("columnheader", { name });
    for (const name of ["Situação", "Reserva"]) expect(header(name)).toHaveClass("hidden", "md:table-cell");
    for (const name of ["Patrimônio", "Investido"]) expect(header(name)).not.toHaveClass("hidden");
    // Sem rolagem, a tabela não vira parada de Tab (ruído para quem usa teclado).
    expect(screen.queryByRole("region", { name: "Fechamentos registrados" })).not.toBeInTheDocument();
    expect(table.closest("[tabindex]")).toBeNull();
  });

  it("se um valor muito grande não couber, a rolagem é alcançável pelo teclado", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(520);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(328);
    mockApi();
    renderPage();

    await screen.findByRole("table", { name: /Fechamentos registrados/ });
    expect(screen.getByRole("region", { name: "Fechamentos registrados" })).toHaveAttribute("tabindex", "0");
  });

  it("cada fechamento tem Editar e Excluir numa linha própria no celular, e excluir pelo teclado confirma o efeito", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderPage();

    await screen.findByRole("table", { name: /Fechamentos registrados/ });
    for (const date of ["30/09/2026", "31/08/2026"]) {
      for (const verb of ["Editar", "Excluir"]) {
        // Uma cópia por largura de tela; a outra fica com display: none (fora do teclado e do leitor de tela).
        const [desktop, mobile] = screen.getAllByRole("button", { name: `${verb} fechamento de ${date}` });
        expect(desktop.closest("td")).toHaveClass("hidden", "md:table-cell");
        expect(mobile.closest("tr")).toHaveClass("md:hidden");
        expect(mobile).toHaveClass("min-h-10"); // alvo de toque de 40 px
      }
    }

    const mobileRemove = screen.getAllByRole("button", { name: "Excluir fechamento de 30/09/2026" })[1];
    mobileRemove.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("alertdialog", { name: "Excluir o fechamento de 30/09/2026?" });
    expect(dialog).toHaveTextContent("Os valores dos ativos não são alterados");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus(); // o caminho seguro é o padrão
    await user.keyboard("{Tab}{Enter}"); // Cancelar tem o foco inicial; Tab leva ao botão de confirmar
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/snapshots/1"))).toBe(true));
  });
});

describe("Histórico: investido da reserva no fechamento", () => {
  const investedLabel = "Quanto da reserva foi aporte (R$)";

  it("só aparece quando há valor na reserva, e some (limpo) se a reserva voltar a zero", async () => {
    const user = userEvent.setup();
    mockApi();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Digitar manualmente" }));
    expect(screen.queryByRole("textbox", { name: investedLabel })).not.toBeInTheDocument();

    const reserve = screen.getByRole("textbox", { name: "Valor da reserva de emergência" });
    await user.type(reserve, "1500");
    const invested = screen.getByRole("textbox", { name: investedLabel });
    expect(screen.getByText(/usamos o valor atual da reserva como investido/)).toBeInTheDocument();
    await user.type(invested, "1000");

    await user.clear(reserve);
    expect(screen.queryByRole("textbox", { name: investedLabel })).not.toBeInTheDocument();
    await user.type(reserve, "1500");
    expect(screen.getByRole("textbox", { name: investedLabel })).toHaveValue("");
  });

  it("um valor intermediário na reserva (ex.: 0 a caminho de 0,5) não apaga o que já foi digitado no investido", async () => {
    const user = userEvent.setup();
    mockApi();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Digitar manualmente" }));
    const reserve = screen.getByRole("textbox", { name: "Valor da reserva de emergência" });
    await user.type(reserve, "1500");
    await user.type(screen.getByRole("textbox", { name: investedLabel }), "1000");

    fireEvent.change(reserve, { target: { value: "0" } });
    expect(screen.queryByRole("textbox", { name: investedLabel })).not.toBeInTheDocument();
    fireEvent.change(reserve, { target: { value: "0,5" } });
    expect(screen.getByRole("textbox", { name: investedLabel })).toHaveValue("1000");
  });

  it("na criação, vazio não envia o campo e preenchido envia em centavos inteiros", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Digitar manualmente" }));
    await user.type(screen.getByRole("textbox", { name: "Valor da reserva de emergência" }), "1500");
    await user.click(screen.getByRole("button", { name: "Salvar snapshot" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const empty = calls.find((c) => c.method === "POST")!;
    expect(empty.body).toMatchObject({ reserve_cents: 150_000 });
    expect(empty.body).not.toHaveProperty("reserve_invested_cents");

    // O painel fecha após salvar; abre de novo e preenche o investido.
    await user.click(await screen.findByRole("button", { name: "Digitar manualmente" }));
    await user.type(screen.getByRole("textbox", { name: "Valor da reserva de emergência" }), "1500");
    await user.type(screen.getByRole("textbox", { name: investedLabel }), "1.234,56");
    await user.click(screen.getByRole("button", { name: "Salvar snapshot" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(2));
    expect(calls.filter((c) => c.method === "POST")[1].body).toMatchObject({ reserve_cents: 150_000, reserve_invested_cents: 123_456 });
  });

  it("na edição, já mostra o investido do fechamento e não envia nada se ele não mudou", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderPage();

    await screen.findByRole("table", { name: /Fechamentos registrados/ });
    await user.click(screen.getAllByRole("button", { name: "Editar fechamento de 30/09/2026" })[0]);
    expect(screen.getByRole("textbox", { name: investedLabel })).toHaveValue("1200,00");
    expect(screen.getByText(/Se apagar o campo, mantemos o valor que ele já tinha/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")!.body).not.toHaveProperty("reserve_invested_cents");
  });

  it("na edição, apagar o campo mantém o valor (não envia) e alterar envia o novo em centavos", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderPage();

    await screen.findByRole("table", { name: /Fechamentos registrados/ });
    await user.click(screen.getAllByRole("button", { name: "Editar fechamento de 30/09/2026" })[0]);
    const invested = screen.getByRole("textbox", { name: investedLabel });
    await user.clear(invested);
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1));
    expect(calls.find((c) => c.method === "PUT")!.body).not.toHaveProperty("reserve_invested_cents");

    await user.click(screen.getAllByRole("button", { name: "Editar fechamento de 30/09/2026" })[0]);
    const again = screen.getByRole("textbox", { name: investedLabel });
    await user.clear(again);
    await user.type(again, "1300,50");
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(2));
    expect(calls.filter((c) => c.method === "PUT")[1].body).toMatchObject({ reserve_invested_cents: 130_050 });
  });

  it("valor inválido bloqueia o botão com o motivo à vista e nada é enviado", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderPage();

    await screen.findByRole("table", { name: /Fechamentos registrados/ });
    await user.click(screen.getAllByRole("button", { name: "Editar fechamento de 30/09/2026" })[0]);
    const invested = screen.getByRole("textbox", { name: investedLabel });
    await user.clear(invested);
    await user.type(invested, "-50");

    expect(invested).toBeInvalid();
    expect(screen.getByText(/Informe um valor de R\$ 0,00 em diante/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Salvar alterações" });
    expect(save).toBeDisabled();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);

    await user.clear(invested);
    await user.type(invested, "0");
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")!.body).toMatchObject({ reserve_invested_cents: 0 });
  });
});
