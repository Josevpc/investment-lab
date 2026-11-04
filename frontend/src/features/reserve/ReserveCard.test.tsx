import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { unprotectedMoney } from "@/test/privacy";
import { ReserveCard } from "./ReserveCard";
import type { Reserve } from "./types";

const reserve: Reserve = {
  goal_cents: 1_000_000,
  months: 6,
  monthly_cents: 0,
  balance_cents: 700_000,
  remaining_cents: 300_000,
  progress_bps: 7_000,
  reached: false,
  average_salary_cents: null,
  salaries_considered: 0,
  suggested_goal_cents: null,
  coverage_months: null,
  assets: [
    { id: 2, name: "Cofrinho Mercado Pago", institution_name: "Mercado Pago", current_cents: 500_000 },
    { id: 9, name: "Tesouro Selic", institution_name: "Tesouro", current_cents: 200_000 },
  ],
  monthly_mode: "percent",
  percent_bps: 2_000,
};

function renderCard(data: Reserve) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReserveCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Reserva: Usei a reserva", () => {
  it("cada ativo da reserva tem um link para o resgate já com o ativo", async () => {
    renderCard(reserve);
    const first = await screen.findByRole("link", { name: "Usei a reserva: registrar resgate de Cofrinho Mercado Pago" });
    expect(first).toHaveAttribute("href", "/carteira/movimentacoes?novo=resgate&ativo=2");
    expect(first).toHaveTextContent("Usei a reserva");
    expect(screen.getByRole("link", { name: "Usei a reserva: registrar resgate de Tesouro Selic" })).toHaveAttribute(
      "href",
      "/carteira/movimentacoes?novo=resgate&ativo=9",
    );
  });

  it("explica que o resgate não aparece como prejuízo", async () => {
    renderCard(reserve);
    expect(await screen.findByText(/nada aparece como prejuízo/)).toBeInTheDocument();
  });

  it("sem ativo na reserva, não há link", async () => {
    renderCard({ ...reserve, assets: [] });
    expect(await screen.findByText(/Nenhum ativo na reserva/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Usei a reserva/ })).not.toBeInTheDocument();
  });

  it("leva ao histórico de todas as retiradas (sem filtro por reserva)", async () => {
    renderCard(reserve);
    expect(await screen.findByRole("link", { name: "Ver todas as retiradas" })).toHaveAttribute("href", "/carteira/retiradas");
  });
});

describe("Reserva: ocultar valores", () => {
  it("nenhum valor em reais fica fora de <Money>, nem na sugestão da meta", async () => {
    const user = userEvent.setup();
    const data: Reserve = { ...reserve, monthly_mode: "fixed", monthly_cents: 50_000, average_salary_cents: 650_000, salaries_considered: 3 };
    renderCard(data);
    await screen.findByText(/Faltam/);
    await user.click(screen.getByRole("button", { name: "Configurar meta" }));
    expect(screen.getByText(/Sugestão: 6 × média/)).toBeInTheDocument();
    expect(unprotectedMoney(document.body)).toEqual([]);
  });

  it("sem ativo na reserva, o aviso não usa borda tracejada", async () => {
    renderCard({ ...reserve, assets: [] });
    const note = await screen.findByText(/Nenhum ativo na reserva/);
    expect(note.className).not.toMatch(/dashed|border/);
  });
});
