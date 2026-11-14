import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement, type ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unprotectedMoney } from "@/test/privacy";
import type { ContributionsByMonth, ContributionsMonth } from "../types";
import { ContributionsByMonthCard } from "./ContributionsByMonthCard";

// O jsdom não mede a tela: dá ao gráfico um tamanho fixo para ele desenhar eixos e colunas.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 640, height: 288 }),
  };
});

// O Intl usa espaço não separável entre "R$" e o número.
const normalize = (text: string | null) => (text ?? "").replace(/ /g, " ");

function month(m: string, contributed: number, overrides: Partial<ContributionsMonth> = {}): ContributionsMonth {
  return {
    month: m,
    contributed_cents: contributed,
    goal_cents: contributed,
    off_goal_cents: 0,
    carried_in_cents: 0,
    planned_cents: null,
    in_progress: false,
    ...overrides,
  };
}

// Hoje é 14/11/2026: setembro e outubro fechados, novembro em andamento.
function data(months: ContributionsMonth[]): ContributionsByMonth {
  return { from_month: months[0]?.month ?? "", to_month: "2026-11", current_month: "2026-11", months };
}

const complete = data([
  month("2026-08", 0),
  month("2026-09", 80_000, { planned_cents: 90_000 }),
  month("2026-10", 120_000, { goal_cents: 100_000, off_goal_cents: 20_000, planned_cents: 90_000, carried_in_cents: 30_000 }),
  month("2026-11", 40_000, { planned_cents: 90_000, in_progress: true }),
]);

type Response422 = { status: number; detail: string };

function renderCard(response: ContributionsByMonth | Response422 | "pending", range: "6m" | "12m" | "all" = "12m") {
  const fetchMock = vi.fn((_url: string) => {
    if (response === "pending") return new Promise<Response>(() => {});
    if ("status" in response) return Promise.resolve(new Response(JSON.stringify({ detail: response.detail }), { status: response.status }));
    return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ContributionsByMonthCard range={range} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, fetchMock };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 14));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-privacy");
});

const TOGGLE = "Ver os mesmos dados em tabela";

describe("Aportes por mês: dados completos", () => {
  it("mostra título, período, legenda com as três séries e o mês em andamento", async () => {
    renderCard(complete);
    expect(await screen.findByRole("heading", { name: "Aportes por mês" })).toBeInTheDocument();
    expect(screen.getByText("Últimos 12 meses")).toBeInTheDocument();
    const legend = await screen.findByRole("list", { name: "Legenda do gráfico" });
    expect(within(legend).getByText("Aporte")).toBeInTheDocument();
    expect(within(legend).getByText("Saldo trazido")).toBeInTheDocument();
    expect(within(legend).getByText("Planejado")).toBeInTheDocument();
    expect(within(legend).getByText("Mês em andamento")).toBeInTheDocument();
  });

  it("o gráfico tem descrição em texto, sem valores, e o eixo escreve 'em andamento' no mês atual", async () => {
    const { container } = renderCard(complete);
    const chart = await screen.findByRole("img", { name: /Gráfico de colunas com o aporte de cada mês, de ago\/2026 a nov\/2026/ });
    expect(chart).toHaveAccessibleName(/saldo trazido de ativos antigos hachurado/);
    expect(chart).toHaveAccessibleName(/linha tracejada com o valor planejado/);
    expect(chart).toHaveAccessibleName(/O mês de nov\/2026 está em andamento/);
    expect(chart.getAttribute("aria-label")).not.toMatch(/R\$/);
    await waitFor(() => expect(container.querySelector(".recharts-wrapper")).toHaveTextContent("em andamento"));
  });

  it("a linha-resumo traz a média só dos meses fechados (a partir do primeiro aporte) e o mês até agora", async () => {
    renderCard(complete);
    // Ago/2026 (zero, antes do primeiro aporte) e nov/2026 (em andamento) ficam de fora: (800 + 1.200) / 2.
    const average = (await screen.findByText(/Média dos meses completos/)).closest("p")!;
    expect(normalize(average.textContent)).toContain("Média dos meses completos: R$ 1.000,00 (2 meses, desde set/2026)");
    const now = screen.getByText(/Neste mês até agora/).closest("p")!;
    expect(normalize(now.textContent)).toContain("Neste mês até agora: R$ 400,00 (de R$ 900,00 planejados)");
  });

  it("busca do primeiro mês do período até o mês atual: 12 meses são 12 colunas", async () => {
    const { fetchMock } = renderCard(complete, "12m");
    await screen.findByRole("heading", { name: "Aportes por mês" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/history/contributions-by-month?from=2025-12");
  });

  it("com 'todo o período' não manda início: a API escolhe pelos dados", async () => {
    const { fetchMock } = renderCard(complete, "all");
    await screen.findByRole("heading", { name: "Aportes por mês" });
    expect(String(fetchMock.mock.calls[0][0]).endsWith("/history/contributions-by-month")).toBe(true);
  });
});

describe("Aportes por mês: tabela", () => {
  it("fica fechada até pedir, e abre com os mesmos dados e a diferença para o plano", async () => {
    const user = userEvent.setup();
    renderCard(complete);
    const toggle = await screen.findByRole("button", { name: TOGGLE });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const table = screen.getByRole("table", { name: /Aporte, saldo trazido e planejado por mês/ });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Mês",
      "Aporte",
      "Fora da meta",
      "Saldo trazido",
      "Planejado",
      "Diferença",
    ]);

    const october = normalize(within(table).getByRole("row", { name: /out\/2026/ }).textContent);
    expect(october).toContain("R$ 1.200,00"); // aporte
    expect(october).toContain("R$ 200,00"); // fora da meta
    expect(october).toContain("R$ 300,00"); // saldo trazido
    expect(october).toContain("R$ 900,00"); // planejado
    expect(october).toContain("+ R$ 300,00"); // 1.200 - 900, com sinal

    const september = within(table).getByRole("row", { name: /set\/2026/ });
    expect(normalize(september.textContent)).toContain("− R$ 100,00"); // 800 - 900

    const november = within(table).getByRole("row", { name: /nov\/2026/ });
    expect(november).toHaveTextContent("em andamento");
    expect(normalize(november.textContent)).toContain("− R$ 500,00");
    // A diferença do mês em andamento é parcial: diz "até agora" em texto; os meses fechados não.
    expect(november).toHaveTextContent("até agora");
    expect(within(table).getByRole("row", { name: /out\/2026/ })).not.toHaveTextContent("até agora");
    expect(within(table).getByRole("row", { name: /set\/2026/ })).not.toHaveTextContent("até agora");
  });

  it("mês sem plano diz 'Sem plano' e não inventa diferença", async () => {
    const user = userEvent.setup();
    renderCard(complete);
    await user.click(await screen.findByRole("button", { name: TOGGLE }));
    const august = within(screen.getByRole("table")).getByRole("row", { name: /ago\/2026/ });
    expect(august).toHaveTextContent("Sem plano");
    expect(normalize(august.textContent)).not.toMatch(/[+−] R\$/);
  });

  it("plano de R$ 0,00 conta como plano: a diferença é o aporte inteiro", async () => {
    const user = userEvent.setup();
    renderCard(data([month("2026-10", 50_000, { planned_cents: 0 }), month("2026-11", 0, { in_progress: true })]));
    await user.click(await screen.findByRole("button", { name: TOGGLE }));
    const october = within(screen.getByRole("table")).getByRole("row", { name: /out\/2026/ });
    expect(normalize(october.textContent)).toContain("+ R$ 500,00");
    expect(october).not.toHaveTextContent("Sem plano");
  });
});

describe("Aportes por mês: dados parciais", () => {
  it("sem plano nem saldo trazido, a legenda e a descrição não prometem linha nem hachura", async () => {
    renderCard(data([month("2026-10", 100_000), month("2026-11", 20_000, { in_progress: true })]));
    const chart = await screen.findByRole("img", { name: /Gráfico de colunas/ });
    expect(chart.getAttribute("aria-label")).not.toMatch(/linha tracejada|hachurado/);
    const legend = screen.getByRole("list", { name: "Legenda do gráfico" });
    expect(within(legend).queryByText("Saldo trazido")).not.toBeInTheDocument();
  });

  it("saldo trazido muito maior que os aportes é cortado no gráfico e o aviso aponta o mês e a tabela", async () => {
    renderCard(data([month("2026-09", 0, { carried_in_cents: 19_900_000 }), month("2026-10", 50_000), month("2026-11", 0, { in_progress: true })]));
    expect(await screen.findByText(/O saldo trazido de set\/2026 é maior que a escala do gráfico/)).toHaveTextContent("O valor inteiro está na tabela");
  });

  it("sem mês fechado com aporte, a média some e diz o motivo", async () => {
    renderCard(data([month("2026-11", 20_000, { in_progress: true })]));
    expect(await screen.findByText(/ainda não há mês fechado com aporte/)).toBeInTheDocument();
    expect(screen.getByText(/Neste mês até agora/)).toBeInTheDocument();
  });

  it("período sem o mês atual não mostra 'até agora' nem o item de mês em andamento", async () => {
    renderCard(data([month("2026-09", 80_000), month("2026-10", 100_000)]));
    await screen.findByText(/Média dos meses completos/);
    expect(screen.queryByText(/Neste mês até agora/)).not.toBeInTheDocument();
    expect(screen.queryByText("Mês em andamento")).not.toBeInTheDocument();
  });
});

describe("Aportes por mês: estados", () => {
  it("carregando", () => {
    renderCard("pending");
    expect(screen.getByRole("status")).toHaveTextContent("Carregando");
  });

  it("erro: mostra a mensagem em português que a API mandou", async () => {
    renderCard({ status: 422, detail: "O período não pode ter mais de 120 meses." });
    expect(await screen.findByRole("alert")).toHaveTextContent("O período não pode ter mais de 120 meses.");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("vazio (sem meses): convida a registrar um aporte, com link para a tela", async () => {
    renderCard(data([]));
    expect(await screen.findByText(/Nenhum aporte no período/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aporte do mês" })).toHaveAttribute("href", "/aporte");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /tabela/ })).not.toBeInTheDocument();
  });

  it("vazio (meses zerados, mesmo com plano): também é 'nenhum aporte'", async () => {
    renderCard(data([month("2026-10", 0, { planned_cents: 90_000 }), month("2026-11", 0, { in_progress: true })]));
    expect(await screen.findByText(/Nenhum aporte no período/)).toBeInTheDocument();
  });

  it("só saldo trazido já é dado: mostra o gráfico", async () => {
    renderCard(data([month("2026-10", 0, { carried_in_cents: 500_000 }), month("2026-11", 0, { in_progress: true })]));
    expect(await screen.findByRole("img", { name: /Gráfico de colunas/ })).toBeInTheDocument();
  });
});

describe("Aportes por mês: ocultar valores", () => {
  it("nenhum valor fica fora de <Money> (resumo, tabela e nomes acessíveis), que o modo desfoca", async () => {
    document.documentElement.dataset.privacy = "hidden";
    const user = userEvent.setup();
    const { container } = renderCard(complete);
    await user.click(await screen.findByRole("button", { name: TOGGLE }));
    expect(container.querySelectorAll(".money").length).toBeGreaterThan(10);
    // Os rótulos do eixo de valores ficam dentro do gráfico, que o CSS do modo desfoca por inteiro.
    container.querySelector(".recharts-wrapper")?.remove();
    expect(unprotectedMoney(container)).toEqual([]);
  });
});
