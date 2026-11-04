import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReserveSummary } from "./ReserveSummary";
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
  assets: [{ id: 2, name: "Cofrinho", institution_name: "Mercado Pago", current_cents: 700_000 }],
  monthly_mode: "percent",
  percent_bps: 0,
};

function renderCard(body: unknown, status = 200, withAssets = false) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReserveSummary withAssets={withAssets} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return container;
}

afterEach(() => vi.unstubAllGlobals());

describe("Reserva de emergência em resumo", () => {
  it("mostra quanto tem, a meta, o que falta por escrito e o progresso na barra", async () => {
    const container = renderCard(reserve);
    await screen.findByText("70% da meta");
    expect(container).toHaveTextContent(/R\$\s7\.000,00/);
    expect(container).toHaveTextContent(/de R\$\s10\.000,00 de meta/);
    expect(screen.getByText(/Faltam/)).toHaveTextContent(/Faltam\s+R\$\s3\.000,00/);
    expect(screen.getByRole("progressbar", { name: "Progresso da reserva de emergência" })).toHaveAttribute("aria-valuenow", "70");
    expect(screen.getByText("70% da meta")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver todas as retiradas" })).toHaveAttribute("href", "/carteira/retiradas");
    // Todo valor em reais passa por <Money>.
    expect(container.querySelectorAll(".money").length).toBeGreaterThanOrEqual(3);
  });

  it("meta cumprida: diz 'Reserva completa' em vez de 'Faltam'", async () => {
    renderCard({ ...reserve, balance_cents: 1_000_000, remaining_cents: 0, progress_bps: 10_000, reached: true });
    expect(await screen.findByText("Reserva completa")).toBeInTheDocument();
    expect(screen.queryByText(/Faltam/)).not.toBeInTheDocument();
  });

  it("sem meta: convida a definir e leva às configurações", async () => {
    renderCard({ ...reserve, goal_cents: 0, remaining_cents: 0 });
    expect(await screen.findByRole("link", { name: "Definir a meta da reserva" })).toHaveAttribute("href", "/configuracoes#reserva");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("com withAssets, cada ativo da reserva tem o atalho para o resgate já com o ativo", async () => {
    renderCard(reserve, 200, true);
    const link = await screen.findByRole("link", { name: "Usei a reserva: registrar resgate de Cofrinho" });
    expect(link).toHaveAttribute("href", "/carteira/movimentacoes?novo=resgate&ativo=2");
  });

  it("sem withAssets, não lista ativos", async () => {
    renderCard(reserve);
    await screen.findByText("70% da meta");
    expect(screen.queryByRole("list", { name: "Ativos da reserva" })).not.toBeInTheDocument();
  });

  it("no erro, diz o que houve", async () => {
    renderCard({ detail: "A reserva falhou." }, 500);
    expect(await screen.findByRole("alert")).toHaveTextContent("A reserva falhou.");
  });
});
