import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Comparison, ComparisonItem } from "@/features/allocation";
import { AllocationCard } from "./AllocationCard";

const item = (patch: Partial<ComparisonItem>): ComparisonItem => ({
  class_id: 1,
  class_key: "rf",
  class_name: "Renda fixa",
  color: "#5aa88a",
  group_id: null,
  current_cents: 60_000,
  current_bps: 6000,
  target_bps: 6000,
  effective_target_bps: 6000,
  hold_status: "none",
  diff_cents: 0,
  held_assets: [],
  ...patch,
});

const base = { plan_id: 1, plan_name: "Plano padrão", total_cents: 100_000, base_cents: 100_000 };

const flat: Comparison = {
  ...base,
  items: [item({}), item({ class_id: 2, class_key: "fii", class_name: "FII", current_cents: 40_000, current_bps: 4000, target_bps: 4000, effective_target_bps: 4000 })],
};

const grouped: Comparison = {
  ...base,
  items: [
    item({}),
    item({ class_id: 2, class_key: "fii", class_name: "FII", group_id: 9, current_cents: 25_000, current_bps: 2500, target_bps: 2000, effective_target_bps: 2000, diff_cents: -5_000 }),
    item({ class_id: 3, class_key: "acoes", class_name: "Ações/ETF", group_id: 9, current_cents: 15_000, current_bps: 1500, target_bps: 2000, effective_target_bps: 2000, diff_cents: 5_000 }),
  ],
  groups: [
    {
      group_id: 9,
      name: "Renda variável",
      color: "#8a6bbf",
      class_keys: ["fii", "acoes"],
      current_cents: 40_000,
      current_bps: 4000,
      target_bps: 4000,
      effective_target_bps: 4000,
      diff_cents: 0,
      hold_status: "none",
    },
  ],
};

function renderCard(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AllocationCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Visão geral: carteira real e meta", () => {
  it("sem grupos, lista as categorias como sempre, cada uma levando aos ativos", async () => {
    renderCard(flat);

    const fii = await screen.findByRole("link", { name: /FII/ });
    expect(fii).toHaveAttribute("href", "/carteira/ativos?categoria=fii");
    expect(screen.queryByRole("button", { name: /expandir|Renda variável/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/soma das metas das categorias/)).not.toBeInTheDocument();
  });

  it("o grupo mostra o subtotal com rótulos e começa recolhido, com as categorias a um clique", async () => {
    renderCard(grouped);

    const toggle = await screen.findByRole("button", { name: /Renda variável/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /FII/ })).not.toBeInTheDocument();

    const row = toggle.closest("li")!;
    expect(row).toHaveTextContent("Grupo · 2 categorias");
    expect(row).toHaveTextContent("40%");
    expect(row).toHaveTextContent("meta");
    expect(row).toHaveTextContent("soma das metas das categorias");
    expect(row).toHaveTextContent("na meta");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("list", { name: "Categorias de Renda variável" });
    expect(within(list).getByRole("link", { name: /FII/ })).toHaveAttribute("href", "/carteira/ativos?categoria=fii");
    expect(within(list).getByRole("link", { name: /Ações\/ETF/ })).toHaveTextContent("5 pontos abaixo da meta");
    expect(within(list).getByRole("link", { name: /FII/ })).toHaveTextContent("5 pontos acima da meta");
  });

  it("o nome do grupo aparece uma vez só na linha: o botão que abre é o próprio título", async () => {
    renderCard(grouped);

    const toggle = await screen.findByRole("button", { name: /Renda variável/ });
    const row = toggle.closest("li")!;
    expect(within(row).getAllByText("Renda variável")).toHaveLength(1);
    expect(toggle).toHaveTextContent("Renda variável");
    expect(row).toHaveTextContent(/R\$\s400,00/);
  });

  it("funciona pelo teclado", async () => {
    renderCard(grouped);

    const toggle = await screen.findByRole("button", { name: /Renda variável/ });
    toggle.focus();
    await userEvent.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("categoria toda mantida dentro do grupo diz que não recebe novos aportes", async () => {
    const held: Comparison = {
      ...grouped,
      items: grouped.items.map((i) =>
        i.class_key === "acoes" ? { ...i, hold_status: "all" as const, diff_cents: null, effective_target_bps: 0, held_assets: [{ asset_id: 1, name: "PETR4", current_cents: 15_000 }] } : i,
      ),
      groups: [{ ...grouped.groups![0], hold_status: "partial" }],
    };
    renderCard(held);

    const toggle = await screen.findByRole("button", { name: /Renda variável/ });
    expect(toggle.closest("li")).toHaveTextContent("1 categoria mantida, sem novos aportes: a barra a inclui, mas o traço de meta e o falta/sobra não");
    await userEvent.click(toggle);
    const acoes = screen.getByRole("link", { name: /Ações\/ETF/ });
    expect(acoes).toHaveTextContent("Mantida, sem novos aportes");
    expect(acoes).not.toHaveTextContent(/pontos/);
  });

  it("mostra o vazio e o erro", async () => {
    renderCard({ ...flat, total_cents: 0, items: [] });
    expect(await screen.findByText("Sem investimentos para comparar com a meta.")).toBeInTheDocument();
  });

  it("avisa quando a comparação não carrega", async () => {
    renderCard({ detail: "Falhou ao comparar." }, 500);
    expect(await screen.findByRole("alert")).toHaveTextContent("Falhou ao comparar.");
  });

  it("diz a distância da meta em pontos, e só o que mais falta leva o selo de atenção", async () => {
    // Renda fixa 60% contra meta 70% (10 pontos abaixo); FII 40% contra 30% (10 acima); Cripto 0% contra 5% (5 abaixo).
    renderCard({
      ...base,
      items: [
        item({ current_bps: 6000, effective_target_bps: 7000 }),
        item({ class_id: 2, class_key: "fii", class_name: "FII", current_cents: 40_000, current_bps: 4000, effective_target_bps: 3000 }),
        item({ class_id: 3, class_key: "cripto", class_name: "Cripto", current_cents: 0, current_bps: 0, effective_target_bps: 500 }),
      ],
    });

    const rf = await screen.findByRole("link", { name: /Renda fixa/ });
    expect(within(rf).getByText("10 pontos abaixo da meta")).toHaveClass("bg-clay-t");
    expect(within(screen.getByRole("link", { name: /FII/ })).getByText("10 pontos acima da meta")).not.toHaveClass("bg-clay-t");
    expect(within(screen.getByRole("link", { name: /Cripto/ })).getByText("5 pontos abaixo da meta")).not.toHaveClass("bg-clay-t");
  });

  it("a barra de cada categoria descreve a participação e a meta, e a legenda explica o círculo de mel", async () => {
    renderCard(flat);
    expect(await screen.findByRole("img", { name: "Renda fixa: 60% da carteira, meta 60%" })).toBeInTheDocument();
    expect(screen.getByText("O círculo de mel marca a meta.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Carteira real por categoria: Renda fixa 60%; FII 40%/ })).toBeInTheDocument();
  });
});
