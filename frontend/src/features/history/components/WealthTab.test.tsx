import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { unprotectedMoney } from "@/test/privacy";
import type { Evolution, EvolutionSummary } from "../types";
import { WealthTab } from "./WealthTab";

// O gráfico depende de medidas de tela que o jsdom não tem.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

// O card de aportes por mês busca os próprios dados e tem teste próprio.
vi.mock("./ContributionsByMonthCard", () => ({ ContributionsByMonthCard: () => null }));

// O Intl usa espaço não separável entre "R$" e o número.
const normalize = (text: string | null) => (text ?? "").replace(/ /g, " ");

function evolution(overrides: Partial<EvolutionSummary> = {}): Evolution {
  return {
    classes: [],
    points: [
      { date: "2026-01-31", total_cents: 1_000_000, invested_cents: 900_000, by_class: {}, reserve_cents: 0 },
      { date: "2026-04-30", total_cents: 1_400_000, invested_cents: 1_200_000, by_class: {}, reserve_cents: 0 },
    ],
    summary: {
      start_date: "2026-01-31",
      end_date: "2026-04-30",
      start_total_cents: 1_000_000,
      end_total_cents: 1_400_000,
      change_cents: 400_000,
      contributions_cents: 300_000,
      withdrawals_cents: 0,
      appreciation_cents: 100_000,
      contributions_source: "diario",
      estimated_months: [],
      new_assets_cents: 0,
      ...overrides,
    },
  };
}

function renderTab(data: Evolution) {
  return render(<WealthTab range="12m" data={data} loading={false} error={null} />);
}

describe("WealthTab: origem dos aportes", () => {
  it("quando os aportes vêm todos dos ativos, diz que são lançados e não mostra aviso de estimativa", () => {
    renderTab(evolution());
    expect(screen.getByText("Lançados nos ativos")).toBeInTheDocument();
    expect(screen.getByText("Variação menos aportes")).toBeInTheDocument();
    expect(screen.queryByText(/aportes estimados/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ativos antigos trazidos para o app/i)).not.toBeInTheDocument();
  });

  it("quando parte é estimada, avisa em texto quais meses usaram o aporte planejado", () => {
    renderTab(evolution({ contributions_source: "misto", estimated_months: ["2026-01", "2026-02", "2026-03"] }));
    expect(screen.getByText("Parte estimada pelo aporte planejado")).toBeInTheDocument();
    expect(screen.getByText("Variação menos aportes (estimada)")).toBeInTheDocument();
    const notice = screen.getByText("Aportes estimados.").closest("p");
    expect(notice).toHaveTextContent(
      "Em 3 meses sem aportes lançados nos ativos (jan/2026 a mar/2026), usamos o aporte planejado.",
    );
  });

  it("quando tudo é estimado, diz que nenhum aporte foi lançado", () => {
    renderTab(evolution({ contributions_source: "planejado", estimated_months: ["2026-02", "2026-04"] }));
    expect(screen.getByText("Estimado pelo aporte planejado")).toBeInTheDocument();
    const notice = screen.getByText("Aportes estimados.").closest("p");
    expect(notice).toHaveTextContent("Nenhum aporte foi lançado nos ativos no período (fev/2026 e abr/2026)");
  });

  it("mostra quanto dos aportes veio de ativos antigos trazidos para o app no período", () => {
    renderTab(evolution({ new_assets_cents: 150_000 }));
    const line = screen.getByText(/ativos antigos trazidos para o app/i);
    expect(normalize(line.textContent)).toContain("Inclui R$ 1.500,00 de ativos antigos trazidos para o app no período");
  });
});

describe("WealthTab: resgates", () => {
  it("sem resgate, não mostra a linha nem a explicação", () => {
    renderTab(evolution());
    expect(screen.queryByText("Resgates")).not.toBeInTheDocument();
    expect(screen.queryByText(/foram resgatados/)).not.toBeInTheDocument();
  });

  it("com resgate, mostra a linha Resgates com sinal e explica que não é perda", () => {
    renderTab(evolution({ withdrawals_cents: 50_000, change_cents: 350_000, appreciation_cents: 100_000 }));
    const stat = screen.getByText("Resgates").closest("div")!;
    expect(normalize(stat.textContent)).toContain("− R$ 500,00");
    expect(stat).toHaveTextContent("Dinheiro que saiu da carteira para uso");
    expect(screen.getByText("Variação menos aportes, mais resgates")).toBeInTheDocument();
    const note = screen.getByText(/foram resgatados/);
    expect(normalize(note.textContent)).toContain("R$ 500,00 foram resgatados");
    expect(note).toHaveTextContent("não são perda");
  });
});

describe("WealthTab: poucas datas com saldo", () => {
  it("com uma data só, pede mais uma e leva para Atualizar saldos", () => {
    const data = evolution();
    render(
      <MemoryRouter>
        <WealthTab range="12m" data={{ ...data, points: data.points.slice(0, 1) }} loading={false} error={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Atualize os saldos em mais uma data para ver a evolução/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atualizar saldos" })).toHaveAttribute("href", "/carteira/atualizar");
  });
});

describe("WealthTab: ativos arquivados", () => {
  it("sem arquivados (ou API antiga sem o campo), não mostra a linha", () => {
    renderTab(evolution());
    expect(screen.queryByText("Ativos arquivados")).not.toBeInTheDocument();
    expect(screen.queryByText(/ao serem arquivados/)).not.toBeInTheDocument();
  });

  it("com arquivados, mostra a saída com sinal, explica que não é perda e atualiza a dica da valorização", () => {
    renderTab(evolution({ archived_out_cents: 80_000, change_cents: 320_000, appreciation_cents: 100_000 }));
    const stat = screen.getByText("Ativos arquivados").closest("div")!;
    expect(normalize(stat.textContent)).toContain("− R$ 800,00");
    expect(stat).toHaveTextContent("Saíram da carteira ao serem arquivados");
    const note = screen.getByText(/saíram da carteira ao serem arquivados \(sem resgate registrado\)/);
    expect(note).toHaveTextContent("não são perda");
    expect(screen.getByText("Variação menos aportes, mais ativos arquivados")).toBeInTheDocument();
  });

  it("com resgates e arquivados juntos, a dica cita os dois", () => {
    renderTab(evolution({ withdrawals_cents: 50_000, archived_out_cents: 80_000 }));
    expect(screen.getByText("Variação menos aportes, mais resgates, mais ativos arquivados")).toBeInTheDocument();
  });
});

describe("WealthTab: dinheiro separado para comprar", () => {
  function withSeparated(summary: Partial<EvolutionSummary> = {}): Evolution {
    const base = evolution(summary);
    return {
      ...base,
      points: [
        { ...base.points[0], reserved_cents: 0, net_worth_cents: 1_000_000 },
        { ...base.points[1], reserved_cents: 80_000, net_worth_cents: 1_480_000 },
      ],
    };
  }

  it("sem separado (ou numa API anterior), não aparece legenda, coluna nem menção à faixa", () => {
    renderTab(evolution());
    expect(screen.queryByText("Separado (ainda não investido)")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Separado" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Gráfico de linhas do patrimônio/ }).getAttribute("aria-label")).not.toMatch(/Separado/);
    expect(screen.getByText("Patrimônio atual")).toBeInTheDocument();
    expect(screen.queryByText(/inclui .* separado/)).not.toBeInTheDocument();
  });

  it("com separado, a legenda traz o item hachurado escrito por extenso", () => {
    renderTab(withSeparated());
    const legend = screen.getByRole("list", { name: "Legenda do gráfico" });
    expect(Array.from(legend.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "Patrimônio",
      "Investido",
      "Separado (ainda não investido)",
    ]);
    expect(legend.querySelector("pattern")).not.toBeNull();
  });

  it("o nome acessível do gráfico cita a faixa e não carrega valores", () => {
    const { container } = renderTab(withSeparated());
    const chart = screen.getByRole("img", { name: /Gráfico de linhas do patrimônio/ });
    expect(chart).toHaveAccessibleName(/faixa hachurada "Separado \(ainda não investido\)" por cima do patrimônio/);
    expect(container.querySelector("[aria-label*='R$']")).toBeNull();
  });

  it("o total vira Patrimônio total e diz quanto do valor está separado", () => {
    renderTab(withSeparated({ end_total_cents: 1_480_000 }));
    const stat = screen.getByText("Patrimônio total").closest("div")!;
    expect(normalize(stat.textContent)).toContain("R$ 14.800,00");
    expect(normalize(stat.textContent)).toContain("inclui R$ 800,00 separado, ainda não investido");
  });

  it("a tabela alternativa ganha a coluna Separado, com cada valor em <Money>", () => {
    const { container } = renderTab(withSeparated());
    const table = screen.getByRole("table", { name: /dinheiro separado/ });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Data do saldo",
      "Patrimônio",
      "Investido",
      "Separado",
    ]);
    const last = within(table).getByRole("row", { name: /30\/04\/2026/ });
    expect(normalize(within(last).getAllByRole("cell").at(-1)!.textContent)).toBe("R$ 800,00");
    expect(unprotectedMoney(container)).toEqual([]);
  });

  it("separado liberado vira linha de saída, com a explicação de que não é perda", () => {
    renderTab(withSeparated({ released_cents: 20_000 }));
    const stat = screen.getByText("Separado liberado").closest("div")!;
    expect(normalize(stat.textContent)).toContain("− R$ 200,00");
    expect(stat).toHaveTextContent("Voltou para o caixa livre sem comprar");
    expect(screen.getByText("Variação menos aportes, mais separado liberado")).toBeInTheDocument();
    expect(screen.getByText(/separados voltaram para o caixa livre/)).toHaveTextContent("não são perda");
  });
});
