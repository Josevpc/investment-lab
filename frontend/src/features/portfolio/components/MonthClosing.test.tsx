import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentMonth, todayISO } from "@/shared/lib/format";
import type { Asset } from "../types";
import { MonthClosing } from "./MonthClosing";

const asset = {
  id: 1,
  name: "CDB Midway",
  institution_name: "Midway",
  purpose: null,
  invested_cents: 100_000,
  current_cents: 110_000,
  valuation_date: todayISO(),
} as Asset;

const summary = {
  total_current_cents: 110_000,
  total_invested_cents: 100_000,
  reserve_current_cents: 0,
  assets_count: 1,
  by_class: [],
};

function mockApi(snapshots: unknown[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/portfolio/summary")) return new Response(JSON.stringify(summary), { status: 200 });
      if (url.endsWith("/contributions")) {
        return new Response(JSON.stringify([{ month: currentMonth(), final_cents: 9_000, plan: [] }]), { status: 200 });
      }
      if (url.endsWith("/snapshots")) return new Response(JSON.stringify(snapshots), { status: 200 });
      if (url.includes("/accounts")) return new Response(JSON.stringify([]), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
}

function renderClosing() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MonthClosing assets={[asset]} onClose={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("Fechamento do mês: voltar às etapas", () => {
  it("na conferência, deixa voltar aos saldos para corrigir um valor e depois continuar de onde parou", async () => {
    const user = userEvent.setup();
    mockApi();
    renderClosing();

    // Aporte e saldos já em dia: a etapa atual é a conferência (passo 3).
    expect(await screen.findByRole("button", { name: "Está tudo certo" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Saldo atual de CDB Midway")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Voltar e corrigir um saldo" }));

    expect(await screen.findByLabelText("Saldo atual de CDB Midway")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Você voltou para Atualizar saldos e aportes por ativo");

    await user.click(screen.getByRole("button", { name: "Continuar de onde parei" }));

    expect(screen.queryByLabelText("Saldo atual de CDB Midway")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Está tudo certo" })).toBeInTheDocument();
  });

  it("cada etapa já feita tem um botão para rever e editar, e as pendentes não", async () => {
    const user = userEvent.setup();
    mockApi();
    renderClosing();
    await screen.findByRole("button", { name: "Está tudo certo" });

    expect(screen.getByRole("button", { name: "Voltar para a etapa: Atualizar saldos e aportes por ativo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Voltar para a etapa: Rever o aporte do mês" })).toBeInTheDocument();
    // "Registrar o fechamento" ainda é futura: sem botão.
    expect(screen.queryByRole("button", { name: "Voltar para a etapa: Registrar o fechamento" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Voltar para a etapa: Atualizar saldos e aportes por ativo" }));
    expect(await screen.findByLabelText("Saldo atual de CDB Midway")).toBeInTheDocument();
  });

  it("salvar a correção de um saldo leva de volta à etapa em que a pessoa estava", async () => {
    const user = userEvent.setup();
    mockApi();
    renderClosing();
    await user.click(await screen.findByRole("button", { name: "Voltar e corrigir um saldo" }));

    const balance = await screen.findByLabelText("Saldo atual de CDB Midway");
    await user.clear(balance);
    await user.type(balance, "1.200,00");
    await user.click(screen.getByRole("button", { name: "Salvar 1 ativo" }));

    expect(await screen.findByRole("button", { name: "Está tudo certo" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Saldo atual de CDB Midway")).not.toBeInTheDocument();
  });
});
