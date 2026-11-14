import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import type { Account, Reservation, ReservationsOverview } from "../types";
import { ReservationsCard } from "./ReservationsCard";

const account: Account = {
  id: 1,
  name: "XP",
  institution_id: 1,
  archived: false,
  cash_enabled: true,
  opening_date: "2026-10-01",
  balance_cents: 100_000,
  reserved_cents: 55_000,
  free_cents: 45_000,
};

function reservation(id: number, extra: Partial<Reservation> = {}): Reservation {
  return {
    id,
    account_id: 1,
    class_id: 3,
    class_name: "FII",
    date: "2026-10-05",
    amount_cents: 30_000,
    used_cents: 0,
    released_cents: 0,
    remaining_cents: 30_000,
    deletable: true,
    ...extra,
  };
}

const fiiA = reservation(11);
const fiiB = reservation(12, { date: "2026-10-20", amount_cents: 20_000, used_cents: 5_000, remaining_cents: 15_000, deletable: false });
const acao = reservation(13, { class_id: 4, class_name: "Ações", date: "2026-11-01", amount_cents: 10_000, remaining_cents: 10_000 });

const overview: ReservationsOverview = {
  reserved_cents: 55_000,
  free_cents: 45_000,
  by_class: [
    { class_id: 3, class_name: "FII", color: "#5e8a57", remaining_cents: 45_000 },
    { class_id: 4, class_name: "Ações", color: "#c46f4e", remaining_cents: 10_000 },
  ],
  reservations: [fiiA, fiiB, acao],
};
const empty: ReservationsOverview = { reserved_cents: 0, free_cents: 100_000, by_class: [], reservations: [] };

interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

function mockApi(data: ReservationsOverview | "erro") {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "DELETE") return new Response(null, { status: 204 });
      if (method === "POST") return new Response(JSON.stringify(fiiA), { status: 200 });
      if (data === "erro") return new Response(JSON.stringify({ detail: "Falha ao ler o separado." }), { status: 500 });
      return new Response(JSON.stringify(data), { status: 200 });
    }),
  );
  return calls;
}

function renderCard(acc: Account = account) {
  const onNotice = vi.fn<(message: MoneyTextPart[]) => void>();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReservationsCard account={acc} onNotice={onNotice} />
    </QueryClientProvider>,
  );
  return onNotice;
}

const flat = (parts: MoneyTextPart[]) => parts.map((p) => (typeof p === "string" ? p : `R$ ${(p.cents / 100).toFixed(2).replace(".", ",")}`)).join("");
const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Separado nesta conta: lista", () => {
  it("agrupa por categoria e mostra data, valor, usado, liberado e restante com palavras", async () => {
    mockApi(overview);
    renderCard();

    const fii = await screen.findByRole("list", { name: "Separações para FII" });
    const rows = within(fii).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Separado em 05/10/2026");
    expect(rows[0]).toHaveTextContent("Restante R$ 300,00");
    expect(rows[0]).toHaveTextContent("Valor separado R$ 300,00 · usado em compras R$ 0,00 · liberado R$ 0,00");
    expect(rows[1]).toHaveTextContent("usado em compras R$ 50,00");
    expect(screen.getByRole("region", { name: "Separado para FII" })).toHaveTextContent("Restante em FII: R$ 450,00");
    expect(within(screen.getByRole("list", { name: "Separações para Ações" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(/ainda não investido/)).toHaveTextContent("Separado para comprar R$ 550,00 (ainda não investido) · caixa livre R$ 450,00");
  });

  it("só oferece Excluir para a separação sem uso", async () => {
    mockApi(overview);
    renderCard();
    await screen.findByRole("list", { name: "Separações para FII" });
    expect(screen.getByRole("button", { name: "Excluir FII de 05/10/2026" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir FII de 20/10/2026" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Liberar FII de 20/10/2026" })).toBeInTheDocument();
  });

  it("sem nada separado, convida a separar e não mostra totais zerados", async () => {
    mockApi(empty);
    renderCard({ ...account, reserved_cents: 0, free_cents: 100_000 });
    expect(await screen.findByText("Nada separado. Separe parte do caixa para juntar a meta de uma categoria até poder comprar.")).toBeInTheDocument();
    expect(screen.queryByText(/ainda não investido/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Liberar/ })).not.toBeInTheDocument();
  });

  it("caixa desativado orienta a ativar e nem busca o separado", () => {
    const calls = mockApi(empty);
    renderCard({ ...account, cash_enabled: false, balance_cents: 0, reserved_cents: 0, free_cents: 0 });
    expect(screen.getByText(/Ative o caixa desta conta/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("erro ao carregar mostra o motivo e deixa tentar de novo", async () => {
    const calls = mockApi("erro");
    const user = userEvent.setup();
    renderCard();
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao ler o separado.");
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThan(1));
  });

  it("“Mostrar encerradas” pede também as já usadas ou liberadas", async () => {
    const calls = mockApi(overview);
    const user = userEvent.setup();
    renderCard();
    await screen.findByRole("list", { name: "Separações para FII" });
    await user.click(screen.getByRole("button", { name: "Mostrar encerradas" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("include_closed=true"))).toBe(true));
    expect(screen.getByRole("button", { name: "Esconder encerradas" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Separado nesta conta: liberar", () => {
  it("a confirmação diz que volta ao caixa livre e que o mês continua contado; só grava ao confirmar", async () => {
    const user = userEvent.setup();
    const calls = mockApi(overview);
    const onNotice = renderCard();

    await user.click(await screen.findByRole("button", { name: "Liberar FII de 05/10/2026" }));
    const dialog = screen.getByRole("dialog", { name: "Liberar dinheiro separado para FII?" });
    expect(dialog).toHaveAccessibleDescription(/volta ao caixa livre de XP\. O mês em que foi separado \(out\/2026\) continua contado/);
    expect(within(dialog).getByLabelText("Valor a liberar (R$)")).toHaveValue("300,00");
    expect(writes(calls)).toHaveLength(0);

    const field = within(dialog).getByLabelText("Valor a liberar (R$)");
    await user.clear(field);
    await user.type(field, "100");
    expect(within(dialog).getByText(/Voltam ao caixa livre/)).toHaveTextContent("Voltam ao caixa livre R$ 100,00 e continuam separados R$ 200,00.");
    await user.click(within(dialog).getByRole("button", { name: "Liberar" }));

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ method: "POST", url: "/api/v1/cash/reservations/11/release", body: { amount_cents: 10_000 } });
    await waitFor(() => expect(onNotice).toHaveBeenCalled());
    const message = flat(onNotice.mock.calls[0][0]);
    expect(message).toContain("R$ 100,00 liberados de FII");
    expect(message).toContain("voltaram ao caixa livre, que agora tem R$ 550,00");
    expect(message).toContain("O mês out/2026 continua contado");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("não deixa liberar mais do que o restante e diz por quê", async () => {
    const user = userEvent.setup();
    const calls = mockApi(overview);
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Liberar FII de 20/10/2026" }));
    const dialog = screen.getByRole("dialog");
    const field = within(dialog).getByLabelText("Valor a liberar (R$)");
    await user.clear(field);
    await user.type(field, "200");
    const submit = within(dialog).getByRole("button", { name: "Liberar" });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription(/O máximo que dá para liberar é R\$\s150,00/);
    expect(writes(calls)).toHaveLength(0);
  });

  it("cancelar não grava nada", async () => {
    const user = userEvent.setup();
    const calls = mockApi(overview);
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Liberar FII de 05/10/2026" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
  });
});

describe("Separado nesta conta: excluir", () => {
  it("pede confirmação que descreve o efeito e só então exclui", async () => {
    const user = userEvent.setup();
    const calls = mockApi(overview);
    const onNotice = renderCard();

    await user.click(await screen.findByRole("button", { name: "Excluir FII de 05/10/2026" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Excluir a separação de R$ 300,00 para FII de 05/10/2026?");
    expect(dialog).toHaveTextContent("o valor volta ao caixa livre");
    expect(writes(calls)).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Excluir separação" }));

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ method: "DELETE", url: "/api/v1/cash/reservations/11" });
    await waitFor(() => expect(onNotice).toHaveBeenCalled());
    expect(flat(onNotice.mock.calls[0][0])).toContain("excluída. O valor está no caixa livre, que agora tem R$ 750,00");
  });

  it("não exclui quando a pessoa desiste", async () => {
    const user = userEvent.setup();
    const calls = mockApi(overview);
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Excluir FII de 05/10/2026" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    expect(writes(calls)).toHaveLength(0);
  });

  it("conta arquivada guarda o separado sem permitir mexer nele", async () => {
    mockApi(overview);
    renderCard({ ...account, archived: true });
    await screen.findByRole("list", { name: "Separações para FII" });
    expect(screen.queryByRole("button", { name: /^(Liberar|Excluir)/ })).not.toBeInTheDocument();
  });
});
