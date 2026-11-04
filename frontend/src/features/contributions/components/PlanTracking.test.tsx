import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { unprotectedMoney } from "@/test/privacy";
import type { Contribution } from "../types";
import { PlanTracking } from "./PlanTracking";

const contribution: Contribution = {
  id: 1,
  month: "2026-10",
  salary_cents: 1_000_000,
  percent_bps: 1000,
  calculated_cents: 100_000,
  final_cents: 100_000,
  overridden: false,
  reserve_cents: 0,
  mode: "rebalance",
  plan_name: "Plano padrão",
  plan: [
    { class_key: "rf", class_name: "Renda fixa", color: "#5aa88a", amount_cents: 100_000 },
    { class_key: "cripto", class_name: "Cripto", color: "#e5a05a", amount_cents: 0 },
  ],
  created_at: null,
};

const comparisonItem = (key: string, name: string, hold_status: string, held: string[]) => ({
  class_id: key.length,
  class_key: key,
  class_name: name,
  color: "#5aa88a",
  current_cents: 1000,
  current_bps: 5000,
  target_bps: 5000,
  effective_target_bps: hold_status === "all" ? 0 : 10_000,
  hold_status,
  diff_cents: hold_status === "all" ? null : 0,
  held_assets: held.map((n, i) => ({ asset_id: i + 1, name: n, current_cents: 500 })),
});

/** Texto visível fora de <Money>: com "ocultar valores" ligado, só o que está em .money é escondido. */
function textOutsideMoney(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(".money").forEach((m) => m.remove());
  return copy.textContent ?? "";
}

function renderWith(
  items: ReturnType<typeof comparisonItem>[],
  c: Contribution = contribution,
  executed: { class_key: string; amount_cents: number }[] = [],
  failComparison = false,
  investedDetail: MoneyTextPart[] | null = null,
) {
  const comparison = { plan_id: 1, plan_name: "Plano padrão", total_cents: 2000, base_cents: 1000, items };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/allocation/comparison")
        ? failComparison
          ? new Response(JSON.stringify({ detail: "falhou" }), { status: 500 })
          : new Response(JSON.stringify(comparison), { status: 200 })
        : new Response(JSON.stringify({}), { status: 404 }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PlanTracking contribution={c} executed={{ byClass: executed, reserveCents: 0 }} investedDetail={investedDetail} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PlanTracking", () => {
  it("mostra a categoria toda mantida numa linha à parte, sem aporte previsto em reais", async () => {
    renderWith([comparisonItem("rf", "Renda fixa", "none", []), comparisonItem("cripto", "Cripto", "all", ["BTC"])]);

    const heldSection = (await screen.findByRole("heading", { name: "Mantidas, sem novos aportes" })).parentElement!;
    expect(within(heldSection).getByText("Cripto")).toBeInTheDocument();
    expect(within(heldSection).getByText("Toda mantida")).toBeInTheDocument();
    expect(within(heldSection).queryByText(/R\$/)).not.toBeInTheDocument();
    // Ela não ganha barra de progresso ("R$ 0,00 de R$ 0,00"); só a categoria que recebe aporte ganha.
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    expect(screen.getByRole("progressbar", { name: /^Renda fixa/ })).toBeInTheDocument();
  });

  it("categoria toda mantida com valor previsto sai do que falta e diz que não será aportada", async () => {
    const withCripto: Contribution = {
      ...contribution,
      plan: [
        { class_key: "rf", class_name: "Renda fixa", color: "#5aa88a", amount_cents: 100_000 },
        { class_key: "cripto", class_name: "Cripto", color: "#e5a05a", amount_cents: 20_000 },
      ],
    };
    renderWith([comparisonItem("rf", "Renda fixa", "none", []), comparisonItem("cripto", "Cripto", "all", ["BTC"])], withCripto);

    const heldSection = (await screen.findByRole("heading", { name: "Mantidas, sem novos aportes" })).parentElement!;
    expect(heldSection).toHaveTextContent(/previsto R\$\s200,00 no plano; não será aportado enquanto estiver mantida/);
    const remaining = screen.getByText("Ainda falta aportar").nextElementSibling!;
    expect(remaining).toHaveTextContent(/R\$\s1\.000,00/);
  });

  it("sem saber o que está mantido, não mostra um valor que pode estar errado", async () => {
    renderWith([], contribution, [], true);
    expect(await screen.findByText("Não foi possível conferir as categorias mantidas.")).toBeInTheDocument();
    const remaining = screen.getByText("Ainda falta aportar").nextElementSibling!;
    expect(remaining).toHaveTextContent("—");
    expect(remaining).not.toHaveTextContent(/R\$/);
  });

  it("com ocultar valores, nenhum valor das frases fica fora de <Money>", async () => {
    const card = (() => {
      renderWith(
        [comparisonItem("rf", "Renda fixa", "none", []), comparisonItem("cripto", "Cripto", "none", [])],
        contribution,
        [{ class_key: "cripto", amount_cents: 5_000 }],
      );
      return screen.getByRole("heading", { name: /^Plano de/ }).closest("section")!;
    })();
    expect(await screen.findByText(/faltam/)).toBeInTheDocument();
    expect(screen.getByText(/acima do plano em/)).toBeInTheDocument();
    expect(textOutsideMoney(card)).not.toMatch(/R\$/);
    // Nem nos nomes acessíveis (barra de progresso): leitor de tela e dica leriam o valor.
    expect(unprotectedMoney(card)).toEqual([]);
    expect(screen.getByRole("progressbar", { name: /^Renda fixa: .*%/ })).toBeInTheDocument();
  });

  it("valor planejado zero não faz a categoria virar mantida; parcial lista os ativos mantidos", async () => {
    renderWith([comparisonItem("rf", "Renda fixa", "partial", ["CDB antigo"]), comparisonItem("cripto", "Cripto", "none", [])]);

    expect(await screen.findByText(/CDB antigo mantido: o aporte vai para os outros ativos/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Mantidas, sem novos aportes" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
  });

  it("o investido no mês separa aportes de ativos novos, com os valores em <Money>", async () => {
    renderWith([comparisonItem("rf", "Renda fixa", "none", [])], contribution, [{ class_key: "rf", amount_cents: 60_000 }], false, [
      { cents: 10_000 },
      " em aportes + ",
      { cents: 50_000 },
      " em ativo novo (CDB X)",
    ]);
    const label = await screen.findByText("Investido no mês");
    const detail = label.parentElement!;
    expect(detail.textContent?.replace(/ /g, " ")).toContain("R$ 600,00R$ 100,00 em aportes + R$ 500,00 em ativo novo (CDB X)");
    expect(textOutsideMoney(detail)).not.toMatch(/R\$/);
  });
});
