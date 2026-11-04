import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { established, month, starting } from "../testData";
import type { Earnings } from "../types";
import { EarningsCard } from "./EarningsCard";

function renderCard(body: Earnings | null, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body ?? { detail: "Falha ao calcular o rendimento." }), { status })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <EarningsCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

afterEach(() => vi.unstubAllGlobals());

describe("Cartão Salário do seu dinheiro: o mês corrente", () => {
  it("compara o mês em andamento com o salário e mostra o ritmo dele, além do último mês completo", async () => {
    renderCard(established());

    const current = await screen.findByText(/Em outubro, até 17\/10:.*do seu salário/);
    expect(norm(current.textContent)).toBe("Em outubro, até 17/10: 6% do seu salário · equivale a 13 h 12 min do seu trabalho");
    expect(norm(screen.getByText(/Em outubro, até 17\/10: ≈/).textContent)).toBe("Em outubro, até 17/10: ≈ R$ 17,65 por dia");
    // O mês completo continua ali, para comparar.
    expect(norm(screen.getByText(/Em setembro:/).textContent)).toBe("Em setembro: 9% do seu salário · equivale a 3 h 20 min do seu trabalho");
  });

  it("o título e a medida valem até o último saldo digitado, não até hoje", async () => {
    const e = established();
    renderCard({ ...e, current_month: { ...e.current_month, measured_through: "2026-10-13" } });

    expect(await screen.findByText("Salário de outubro (até 13/10)")).toBeInTheDocument();
    expect(norm(screen.getByText(/Em outubro, até 13\/10:.*do seu salário/).textContent)).toContain("Em outubro, até 13/10: 6% do seu salário");
  });

  it("sem atualização no mês, não inventa comparação nem ritmo do mês", async () => {
    renderCard(established({ current_month: month({ partial: true, through: "2026-10-17", has_update: false }) }));

    await screen.findByText("Ainda sem atualização de saldo");
    expect(screen.queryByText(/Em outubro, até/)).not.toBeInTheDocument();
  });

  it("mês em queda: sem comparação com o salário e sem ritmo positivo", async () => {
    const dip = month({ partial: true, through: "2026-10-17", measured_through: "2026-10-17", earned_cents: -12_000, salary_share_bps: -240, per_day_cents: -706 });
    renderCard(established({ current_month: dip }));

    await screen.findByText(/Mês de oscilação/);
    expect(screen.queryByText(/Em outubro, até 17\/10:.*do seu salário/)).not.toBeInTheDocument();
    expect(screen.getByText("Em outubro, até 17/10: oscilação, sem ganho médio por dia")).toBeInTheDocument();
  });

  it("sem salário registrado, o ritmo do mês aparece e a comparação não", async () => {
    renderCard(established({ salary: null, vs_salary: null }));

    await screen.findByRole("link", { name: "Registre o salário no aporte do mês" });
    expect(screen.queryByText(/do seu salário · equivale/)).not.toBeInTheDocument();
    expect(screen.getByText(/Em outubro, até 17\/10: ≈/)).toBeInTheDocument();
  });
});

describe("Cartão Salário do seu dinheiro", () => {
  it("mostra o carregamento enquanto busca", () => {
    renderCard(established());
    expect(screen.getByRole("status")).toHaveTextContent("Carregando");
  });

  it("no erro, diz o que houve e o que fazer", async () => {
    renderCard(null, 500);
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao calcular o rendimento.");
    expect(screen.getByText(/Recarregue a página/)).toBeInTheDocument();
  });

  it("sem ativos, não aparece", async () => {
    const { container } = renderCard(starting({ tracking_since: null }));
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("recém-cadastrado: diz que o dinheiro começou a trabalhar e leva a atualizar as posições", async () => {
    renderCard(starting());
    expect(await screen.findByText("Seu dinheiro começou a trabalhar.")).toBeInTheDocument();
    expect(screen.getByText(/No fim do mês, atualize os saldos para ver o primeiro salário dele/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atualizar saldos" })).toHaveAttribute("href", "/carteira/atualizar");
    expect(screen.queryByText(/R\$\s0,00/)).not.toBeInTheDocument();
  });

  it("mostra o salário do mês parcial, o último mês completo, o total, o ritmo e a comparação com o salário", async () => {
    const { container } = renderCard(established());

    expect(await screen.findByText("Salário de outubro (até 17/10)")).toBeInTheDocument();
    expect(screen.getByText("Quanto seus investimentos renderam para você, sem contar o que você aportou.")).toBeInTheDocument();
    expect(screen.getByText("Salário de setembro")).toBeInTheDocument();
    expect(screen.getByText("Já rendeu no total")).toBeInTheDocument();
    expect(screen.getByText(/que seus ativos já tinham rendido antes do cadastro/)).toBeInTheDocument();
    expect(norm(screen.getByText(/mesmo enquanto você dorme/).textContent)).toBe("≈ R$ 15,00 por dia, mesmo enquanto você dorme");
    expect(norm(screen.getByText(/Em setembro:/).textContent)).toBe("Em setembro: 9% do seu salário · equivale a 3 h 20 min do seu trabalho");
    expect(screen.getByRole("link", { name: "Ver o mês em detalhe" })).toHaveAttribute("href", "/metas#salario-do-dinheiro");

    // Todo valor em reais passa por <Money>, que respeita "ocultar valores".
    const money = [...container.querySelectorAll(".money")].map((el) => norm(el.textContent));
    expect(money).toEqual(expect.arrayContaining(["R$ 300,00", "R$ 450,00", "R$ 1.200,00", "R$ 200,00", "R$ 15,00", "R$ 17,65"]));
    const textOutsideMoney = norm(container.textContent).replace(/R\$ [\d.,]+/g, "");
    expect(textOutsideMoney).not.toContain("R$");
  });

  it("avisa em texto quando um mês vem depois de meses sem atualização, e que o ritmo usa só meses atualizados", async () => {
    renderCard(established());
    expect(await screen.findByText(/último mês completo; inclui meses sem atualização de saldo/)).toBeInTheDocument();
    expect(screen.getByText(/O ritmo usa só meses com atualização de saldo/)).toBeInTheDocument();
  });

  it("sem lacuna de atualização, não há aviso", async () => {
    const e = established();
    renderCard({ ...e, months: e.months.filter((m) => m.month !== "2026-08") });
    await screen.findByText("Salário de setembro");
    expect(screen.queryByText(/inclui meses sem atualização/)).not.toBeInTheDocument();
    expect(screen.queryByText(/O ritmo usa só meses/)).not.toBeInTheDocument();
  });

  it("mês com saldo igual (ganho zero) não fala em oscilação", async () => {
    renderCard(established({ vs_salary: { month: "2026-09", earned_cents: 0, share_bps: 0, work_minutes: null } }));
    expect(await screen.findByText("Em setembro seus saldos ficaram iguais; o rendimento aparece quando o saldo mudar.")).toBeInTheDocument();
    expect(screen.queryByText(/oscilação, então/)).not.toBeInTheDocument();
  });

  it("sem salário registrado, esconde a comparação e convida a registrar no aporte", async () => {
    renderCard(established({ salary: null, vs_salary: null }));
    expect(await screen.findByRole("link", { name: "Registre o salário no aporte do mês" })).toHaveAttribute("href", "/aporte");
    expect(screen.queryByText(/equivale a/)).not.toBeInTheDocument();
  });

  it("sem mês completo, esconde a média do ritmo e diz quando ela aparece", async () => {
    const current = month({ partial: true, through: "2026-10-17", has_update: false });
    renderCard(established({ pace: null, last_complete_month: null, vs_salary: null, current_month: current }));
    expect(await screen.findByText("O ritmo aparece depois do primeiro mês completo.")).toBeInTheDocument();
    expect(screen.queryByText(/por dia/)).not.toBeInTheDocument();
    expect(screen.queryByText("Salário de setembro")).not.toBeInTheDocument();
  });

  it("mês sem atualização de saldo não aparece como 'rendeu R$ 0,00'", async () => {
    renderCard(established({ current_month: month({ partial: true, through: "2026-10-17", has_update: false }) }));
    expect(await screen.findByText("Ainda sem atualização de saldo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atualizar saldos" })).toHaveAttribute("href", "/carteira/atualizar");
  });

  it("mês negativo: tom neutro, sinal escrito e o contexto do que já rendeu", async () => {
    const { container } = renderCard(
      established({ current_month: month({ partial: true, through: "2026-10-17", earned_cents: -12_345, appreciation_cents: -12_345 }) }),
    );
    const message = await screen.findByText(/Mês de oscilação/);
    expect(norm(message.textContent)).toBe(
      "Mês de oscilação: seus investimentos recuaram R$ 123,45. Faz parte; desde o início seu dinheiro já rendeu R$ 1.200,00.",
    );
    expect(screen.getByText("recuou")).toBeInTheDocument(); // sinal para leitores de tela, além do ▼
    expect(container.querySelector("[class*='text-red']")).toBeNull();
  });

  it("total abaixo do investido: explica sem alarme", async () => {
    renderCard(
      established({
        total: { earned_cents: -5_000, before_tracking_cents: 0, since_tracking_cents: -5_000, uncredited_proventos_cents: 0 },
        current_month: month({ partial: true, through: "2026-10-17", earned_cents: -2_000 }),
      }),
    );
    expect(await screen.findByText(/Por enquanto seus investimentos estão/)).toBeInTheDocument();
    expect(screen.getByText("abaixo do investido")).toBeInTheDocument();
  });
});
