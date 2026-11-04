import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { YearProgress } from "../types";
import { YearGoalCard } from "./GoalProgressCards";

const year = (over: Partial<YearProgress> = {}): YearProgress => ({
  year: 2026,
  goal_cents: 5_000_000,
  status: "ok",
  baseline_date: "2025-12-31",
  last_date: "2026-09-30",
  accumulated_cents: 3_000_000,
  contributions_cents: 2_000_000,
  withdrawals_cents: 0,
  appreciation_cents: 1_000_000,
  remaining_cents: 2_000_000,
  progress_bps: 6_000,
  reached: false,
  contributions_source: "diario",
  estimated_months: [],
  ...over,
});

const nb = (text: string | null) => (text ?? "").replace(/\s/g, " ");

describe("Acumulado do ano: resgates", () => {
  it("sem resgate, não mostra a linha Resgates", () => {
    render(<YearGoalCard year={year()} />);
    expect(screen.queryByText("Resgates")).not.toBeInTheDocument();
    expect(screen.queryByText(/Resgates diminuem o acumulado/)).not.toBeInTheDocument();
  });

  it("com resgate, mostra a linha Resgates e explica que diminui o acumulado sem ser perda", () => {
    render(<YearGoalCard year={year({ withdrawals_cents: 120_000, accumulated_cents: 2_880_000 })} />);
    const row = screen.getByText("Resgates").closest("div")!;
    expect(nb(row.textContent)).toContain("− R$ 1.200,00");
    const note = screen.getByText(/Resgates diminuem o acumulado/).closest("p")!;
    expect(nb(note.textContent)).toContain("Você resgatou R$ 1.200,00 neste ano");
    expect(note).toHaveTextContent("Não é perda de valorização");
  });
});

describe("Acumulado do ano: ativos antigos trazidos para o app", () => {
  it("sem ativos novos (ou API antiga sem o campo), não mostra o aviso", () => {
    render(<YearGoalCard year={year()} />);
    expect(screen.queryByText(/ativos antigos trazidos para o app/)).not.toBeInTheDocument();
    render(<YearGoalCard year={year({ new_assets_cents: 0 })} />);
    expect(screen.queryByText(/ativos antigos trazidos para o app/)).not.toBeInTheDocument();
  });

  it("com ativos novos, explica que entram como aporte para não parecerem valorização", () => {
    render(<YearGoalCard year={year({ new_assets_cents: 150_000 })} />);
    const note = screen.getByText(/ativos antigos trazidos para o app/);
    expect(nb(note.textContent)).toContain("Inclui R$ 1.500,00 de ativos antigos trazidos para o app no período");
    expect(note).toHaveTextContent("para não parecerem valorização");
  });

  it("sem base para medir o ano, não mostra o aviso", () => {
    render(
      <MemoryRouter>
        <YearGoalCard year={year({ status: "sem_base", new_assets_cents: 150_000 })} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/ativos antigos trazidos para o app/)).not.toBeInTheDocument();
  });
});

describe("Acumulado do ano: ativos arquivados", () => {
  it("sem arquivados, não mostra a linha nem o aviso", () => {
    render(<YearGoalCard year={year()} />);
    expect(screen.queryByText("Ativos arquivados")).not.toBeInTheDocument();
  });

  it("com arquivados, mostra a saída e explica que diminui o acumulado sem ser perda", () => {
    render(<YearGoalCard year={year({ archived_out_cents: 80_000, accumulated_cents: 2_920_000 })} />);
    const row = screen.getByText("Ativos arquivados").closest("div")!;
    expect(nb(row.textContent)).toContain("− R$ 800,00");
    const note = screen.getByText(/Ativos arquivados diminuem o acumulado/).closest("p")!;
    expect(nb(note.textContent)).toContain("R$ 800,00 saíram da carteira ao serem arquivados");
    expect(note).toHaveTextContent("Não é perda");
  });
});
