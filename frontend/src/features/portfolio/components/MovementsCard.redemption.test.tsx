import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todayISO } from "@/shared/lib/format";
import type { Movement } from "../types";
import { editHint, MovementsCard, undoMessage } from "./MovementsCard";

const cofrinho = {
  id: 2,
  name: "Cofrinho Mercado Pago",
  institution_name: "Mercado Pago",
  purpose: "reserva",
  archived: false,
  account_id: null,
  invested_cents: 71_391,
  current_cents: 80_391,
  valuation_date: "2000-01-01",
};
const cdb = { ...cofrinho, id: 3, name: "CDB Banco X", purpose: null };

const summary = {
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

const resgate: Movement = {
  id: 40,
  date: "2026-10-20",
  kind: "resgate",
  asset_id: 2,
  asset_name: "Cofrinho Mercado Pago",
  related_asset_id: null,
  related_asset_name: null,
  amount_cents: 10_000,
  cost_cents: 8_880,
  initial: false,
  note: "Conserto do carro",
  in_balance: false,
  off_goal: false,
};

const reserveAfter = {
  goal_cents: 1_000_000,
  balance_cents: 700_000,
  remaining_cents: 300_000,
  reached: false,
  assets: [],
};

function mockApi(opts: { movements?: Movement[]; summary?: unknown; undo?: () => Response; reserve?: unknown } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/redemptions")) {
        const sent = JSON.parse(String(init?.body));
        const asset = sent.asset_id === 3 ? cdb : cofrinho;
        return json({ ...resgate, id: 41, date: todayISO(), asset_id: asset.id, asset_name: asset.name, amount_cents: sent.amount_cents, note: null }, 201);
      }
      if (method === "POST" && url.endsWith("/undo")) return opts.undo?.() ?? json({});
      if (method === "PATCH") return json({ ...resgate, note: "Outro motivo" });
      if (url.includes("/accounts")) return json([]);
      if (url.includes("/reserve")) return json(opts.reserve ?? reserveAfter);
      if (url.includes("/assets")) return json([cofrinho, cdb]);
      if (url.includes("/movements")) return json(opts.movements ?? []);
      if (url.includes("/portfolio/month-summary")) return json(opts.summary ?? summary);
      return json({});
    }),
  );
  return calls;
}

function renderCard(props: { requestedForm?: "resgate"; requestedAssetId?: number } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MovementsCard {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const nb = (text: string | null) => (text ?? "").replace(/\s/g, " ");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openResgate(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole("button", { name: "Resgatar" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

describe("Movimentações: Resgatar", () => {
  it("abre o formulário e, ao cancelar, devolve o foco ao botão Resgatar", async () => {
    const user = userEvent.setup();
    mockApi();
    renderCard();
    await openResgate(user);
    expect(screen.getByRole("form", { name: "Registrar resgate" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resgatar" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("form", { name: "Registrar resgate" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resgatar" })).toHaveFocus();
  });

  it("o pedido de fora (?novo=resgate&ativo=ID) abre o formulário já com o ativo escolhido", async () => {
    mockApi();
    renderCard({ requestedForm: "resgate", requestedAssetId: 2 });
    const form = await screen.findByRole("form", { name: "Registrar resgate" });
    await waitFor(() => expect(within(form).getByLabelText("Ativo")).toHaveValue("2"));
  });

  it("registra, fecha o formulário e diz o que foi feito e quanto a reserva está abaixo da meta", async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    renderCard();
    await openResgate(user);

    await user.selectOptions(screen.getByLabelText("Ativo"), "2");
    await user.type(screen.getByLabelText("Valor resgatado (R$)"), "100");
    await user.click(screen.getByRole("button", { name: "Registrar resgate" }));

    const status = await screen.findByText(/registrado em/);
    expect(screen.queryByRole("form", { name: "Registrar resgate" })).not.toBeInTheDocument();
    await waitFor(() => expect(nb(status.textContent)).toContain("A reserva está R$ 3.000,00 abaixo da meta de R$ 10.000,00."));
    expect(nb(status.textContent)).toContain("Resgate de R$ 100,00 de Cofrinho Mercado Pago registrado");
    expect(nb(status.textContent)).toContain("O próximo aporte já sugere repor o que falta.");
    expect(calls.find((c) => c.url.endsWith("/redemptions"))!.init!.method).toBe("POST");
    // As telas que dependem do resgate são recarregadas.
    await waitFor(() => expect(calls.filter((c) => c.url.includes("/reserve")).length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: "Resgatar" })).toHaveFocus();
  });

  it("ativo que não é da reserva não fala da reserva e aponta o acumulado do ano", async () => {
    const user = userEvent.setup();
    mockApi();
    renderCard();
    await openResgate(user);
    await user.selectOptions(screen.getByLabelText("Ativo"), "3");
    await user.type(screen.getByLabelText("Valor resgatado (R$)"), "50");
    await user.click(screen.getByRole("button", { name: "Registrar resgate" }));

    const status = await screen.findByText(/registrado em/);
    expect(status).toHaveTextContent("linha Resgates");
    expect(status).not.toHaveTextContent("reserva");
  });
});

describe("Movimentações: lista com resgate", () => {
  it("rotula Resgate com estilo neutro, sinal de menos e o motivo; sem Excluir", async () => {
    mockApi({ movements: [resgate], summary: { ...summary, redemptions_cents: 10_000 } });
    renderCard();

    const row = (await screen.findByText("Motivo: Conserto do carro")).closest("tr")!;
    const label = within(row).getByText("Resgate");
    expect(label.className).not.toMatch(/red|emerald|blue/);
    expect(nb(within(row).getByText(/^−/).textContent)).toBe("− R$ 100,00");
    expect(within(row).getByRole("button", { name: "Editar resgate de Cofrinho Mercado Pago" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Desfazer resgate de Cofrinho Mercado Pago" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Excluir/ })).not.toBeInTheDocument();
    expect(nb((await screen.findByText(/Total investido no mês/)).textContent)).toContain("Resgates: R$ 100,00");
  });

  it("o total do mês só fala de resgates quando houve", async () => {
    mockApi();
    renderCard();
    expect(await screen.findByText(/Total investido no mês/)).not.toHaveTextContent("Resgates");
  });

  it("desfazer pede confirmação com o efeito e mostra o erro do servidor (409)", async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      movements: [resgate],
      undo: () => new Response(JSON.stringify({ detail: "Não dá para desfazer: o caixa ficaria negativo." }), { status: 409 }),
    });
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Desfazer resgate de Cofrinho Mercado Pago" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("O valor volta ao saldo do ativo e o custo volta ao investido");
    expect(dialog).toHaveTextContent("motivo: Conserto do carro");
    expect(calls.some((c) => c.url.includes("/undo"))).toBe(false); // só depois de confirmar
    await user.click(within(dialog).getByRole("button", { name: "Desfazer movimento" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("o caixa ficaria negativo");
    expect(calls.some((c) => c.url === "/api/v1/movements/40/undo")).toBe(true);
  });

  it("editar um resgate corrige só o motivo e avisa que valor e data não mudam", async () => {
    const user = userEvent.setup();
    const calls = mockApi({ movements: [resgate] });
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Editar resgate de Cofrinho Mercado Pago" }));
    const form = screen.getByRole("form", { name: "Editar resgate de Cofrinho Mercado Pago" });
    expect(form).toHaveTextContent("Só o motivo muda");
    expect(within(form).queryByLabelText("Valor (R$)")).not.toBeInTheDocument();

    const save = within(form).getByRole("button", { name: "Salvar alterações" });
    expect(save).toBeDisabled();
    const note = within(form).getByLabelText("Motivo (opcional)");
    expect(note).toHaveValue("Conserto do carro");
    await user.clear(note);
    await user.type(note, "Outro motivo");
    await user.click(save);

    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.init?.method === "PATCH")!;
    expect(patch.url).toBe("/api/v1/movements/40");
    expect(JSON.parse(String(patch.init!.body))).toEqual({ note: "Outro motivo" });
    expect(await screen.findByRole("status")).toHaveTextContent("Motivo do resgate de Cofrinho Mercado Pago atualizado: Outro motivo.");
    expect(screen.getByRole("button", { name: "Editar resgate de Cofrinho Mercado Pago" })).toHaveFocus();
  });

  it("apagar o motivo manda null", async () => {
    const user = userEvent.setup();
    const calls = mockApi({ movements: [resgate] });
    renderCard();
    await user.click(await screen.findByRole("button", { name: "Editar resgate de Cofrinho Mercado Pago" }));
    await user.clear(screen.getByLabelText("Motivo (opcional)"));
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.init?.method === "PATCH")!.init!.body))).toEqual({ note: null });
  });
});

describe("Movimentações: textos de resgate", () => {
  it("desfazer explica o efeito e a variante de saldo já atualizado", () => {
    expect(undoMessage(resgate)).toContain("O valor volta ao saldo do ativo e o custo volta ao investido");
    expect(undoMessage(resgate)).toContain("a venda sai do extrato");
    expect(undoMessage({ ...resgate, in_balance: true })).toContain("o saldo registrado não muda");
    // Só no resgate normal o servidor desloca os saldos digitados depois da data.
    const shifted = "Os saldos que você digitou depois dessa data mudam junto.";
    expect(undoMessage(resgate)).toContain(shifted);
    expect(undoMessage({ ...resgate, in_balance: true })).not.toContain(shifted);
  });

  it("editar diz que só o motivo muda", () => {
    expect(editHint(resgate)).toContain("Só o motivo muda");
    expect(editHint(resgate)).toContain("desfaça o resgate e registre de novo");
    expect(editHint(resgate)).toContain("Os saldos que você digitou depois dessa data mudam junto.");
    expect(editHint({ ...resgate, in_balance: true })).not.toContain("mudam junto");
  });
});
