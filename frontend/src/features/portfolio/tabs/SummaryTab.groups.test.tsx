import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Comparison, ComparisonItem } from "@/features/allocation";
import { SummaryTab } from "./SummaryTab";

const item = (patch: Partial<ComparisonItem>): ComparisonItem => ({
  class_id: 1,
  class_key: "rf",
  class_name: "Renda fixa",
  color: "#5aa88a",
  group_id: null,
  current_cents: 50_000,
  current_bps: 5000,
  target_bps: 5000,
  effective_target_bps: 5000,
  hold_status: "none",
  diff_cents: 0,
  held_assets: [],
  ...patch,
});

// Carteira de R$ 1.000: Renda fixa solta (R$ 500) e o grupo Renda variável com FII (R$ 200) e Ações/ETF (R$ 300, toda mantida).
const comparison: Comparison = {
  plan_id: 1,
  plan_name: "Plano padrão",
  total_cents: 100_000,
  base_cents: 70_000,
  items: [
    item({ effective_target_bps: 7143, diff_cents: 0 }),
    item({
      class_id: 2,
      class_key: "fii",
      class_name: "FII",
      group_id: 9,
      current_cents: 20_000,
      current_bps: 2000,
      target_bps: 1500,
      effective_target_bps: 2143,
      diff_cents: 5_000,
    }),
    item({
      class_id: 3,
      class_key: "acoes",
      class_name: "Ações/ETF",
      group_id: 9,
      current_cents: 30_000,
      current_bps: 3000,
      target_bps: 1500,
      effective_target_bps: 0,
      hold_status: "all",
      diff_cents: null,
      held_assets: [{ asset_id: 7, name: "PETR4", current_cents: 30_000 }],
    }),
  ],
  groups: [
    {
      group_id: 9,
      name: "Renda variável",
      color: "#8a6bbf",
      class_keys: ["fii", "acoes"],
      current_cents: 50_000,
      current_bps: 5000,
      target_bps: 3000,
      effective_target_bps: 2143,
      diff_cents: 5_000,
      hold_status: "partial",
    },
  ],
};

function renderTab(data: Comparison = comparison) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.endsWith("/allocation/comparison")) return json(data);
      if (url.endsWith("/portfolio/summary")) return json({ assets_count: 3, by_class: [], by_type: [], fii_segments: [], by_institution: [] });
      if (url.includes("/assets")) return json([]);
      if (url.endsWith("/reserve")) return json({ goal_cents: 0 });
      return new Response(JSON.stringify({ detail: "não usado" }), { status: 404 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SummaryTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

/** A linha (<summary>) da categoria ou do grupo com esse nome. */
const lineOf = (name: string) => screen.getByText(name, { selector: "span" }).closest("summary")!;
const boxOf = (name: string) => lineOf(name).closest("details")!;

describe("Carteira > Resumo: grupos na comparação com a meta", () => {
  it("a linha do grupo traz valor atual, % da carteira, meta somada e falta/sobra, com rótulos", async () => {
    renderTab();
    await screen.findByText("Renda variável", { selector: "span" });

    const group = lineOf("Renda variável");
    expect(group).toHaveTextContent("Grupo · 2 categorias · sem ativos");
    expect(group).toHaveTextContent("50%");
    expect(group).toHaveTextContent(/R\$\s500,00/);
    expect(group).toHaveTextContent("soma das metas das categorias");
    expect(group).toHaveTextContent("21,43%");
    expect(group).toHaveTextContent("soma no plano: 30%");
    expect(group).toHaveTextContent(/sobra R\$\s50,00/);
    expect(group).toHaveTextContent("1 categoria mantida, sem novos aportes: a barra a inclui, mas o traço de meta e o falta/sobra não");
  });

  it("a categoria toda mantida dentro do grupo diz que não recebe aportes e fica fora do falta/sobra", async () => {
    renderTab();
    await screen.findByText("Ações/ETF", { selector: "span" });

    const held = lineOf("Ações/ETF");
    expect(within(held).getByText("Mantida, sem novos aportes")).toBeInTheDocument();
    expect(held).not.toHaveTextContent(/falta|sobra/);
    expect(lineOf("FII")).toHaveTextContent(/sobra R\$\s50,00/);
  });

  it("o grupo abre e fecha as categorias (o <summary> nativo já responde a Enter e Espaço) e o subtotal fica à vista", async () => {
    renderTab();
    await screen.findByText("Renda variável", { selector: "span" });
    const group = boxOf("Renda variável");
    const toggle = lineOf("Renda variável");

    expect(group).not.toHaveAttribute("open");
    await userEvent.click(toggle);
    expect(group).toHaveAttribute("open");
    expect(within(screen.getByRole("list", { name: "Categorias de Renda variável" })).getByText("FII", { selector: "span" })).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(group).not.toHaveAttribute("open");
    // O grupo continua mostrando o subtotal enquanto fechado.
    expect(toggle).toHaveTextContent("50%");
  });

  it("a seta de cada nível responde só ao próprio <details>: a da categoria aninhada não gira com o grupo aberto", async () => {
    renderTab();
    await screen.findByText("Renda variável", { selector: "span" });
    // Tailwind: `group-open:` casa com QUALQUER ancestral aberto; só o grupo nomeado limita ao <details> certo.
    const chevron = (name: string) => lineOf(name).querySelector("svg")!.getAttribute("class") ?? "";

    expect(chevron("Renda variável")).toContain("group-open/grp:rotate-90");
    expect(chevron("FII")).toContain("group-open/cat:rotate-90");
    for (const name of ["Renda variável", "FII"]) expect(chevron(name)).not.toMatch(/group-open:/);
    expect(boxOf("Renda variável").className).toContain("group/grp");
    expect(boxOf("FII").className).toContain("group/cat");
  });

  it("explica que a meta do grupo é só a soma e que a categoria solta segue como antes", async () => {
    renderTab();
    await screen.findByText("Renda fixa", { selector: "span" });
    expect(screen.getByText(/A meta de um grupo é a soma das metas das categorias dele/)).toBeInTheDocument();
    expect(lineOf("Renda fixa")).toHaveTextContent("50% · meta 71,43%*");
  });

  it("sem o campo groups (API antiga), as categorias aparecem soltas e sem texto de grupo", async () => {
    renderTab({ ...comparison, groups: undefined });
    await screen.findByText("FII", { selector: "span" });
    expect(screen.queryByRole("list", { name: /Categorias de/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/A meta de um grupo/)).not.toBeInTheDocument();
  });
});
