import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { PreferencesProvider } from "@/shared/lib/preferences";
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

type SplitBody = { amount_cents: number; mode: string; plan_id: unknown; month: unknown };
let splitHandler: ((body: SplitBody) => Response) | null = null;
const splitCalls: SplitBody[] = [];

function renderWith(
  items: ReturnType<typeof comparisonItem>[],
  c: Contribution = contribution,
  executed: { class_key: string; amount_cents: number; reserved_cents?: number; from_reserved_cents?: number }[] = [],
  failComparison = false,
  investedDetail: MoneyTextPart[] | null = null,
  offGoalCents = 0,
) {
  const comparison = { plan_id: 1, plan_name: "Plano padrão", total_cents: 2000, base_cents: 1000, items };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/allocation/split") && splitHandler) {
        const body = JSON.parse(String(init?.body)) as SplitBody;
        splitCalls.push(body);
        return splitHandler(body);
      }
      return url.endsWith("/allocation/comparison")
        ? failComparison
          ? new Response(JSON.stringify({ detail: "falhou" }), { status: 500 })
          : new Response(JSON.stringify(comparison), { status: 200 })
        : new Response(JSON.stringify({}), { status: 404 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <PreferencesProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PlanTracking contribution={c} executed={{ byClass: executed, reserveCents: 0, offGoalCents }} investedDetail={investedDetail} />
        </MemoryRouter>
      </QueryClientProvider>
    </PreferencesProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  splitHandler = null;
  splitCalls.length = 0;
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
    // "R$" solto no rótulo "Valor extra (R$)" é unidade, não valor: só conta "R$" seguido de número.
    expect(textOutsideMoney(card)).not.toMatch(/R\$\s*\d/);
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

  it("com aporte fora da meta, mostra o total à parte, sem contá-lo no plano nem no extra", async () => {
    // Plano de R$ 1.000; R$ 600 contam na meta e R$ 90 foram para a reserva, fora da meta.
    renderWith([comparisonItem("rf", "Renda fixa", "none", [])], contribution, [{ class_key: "rf", amount_cents: 60_000 }], false, null, 9_000);
    const invested = (await screen.findByText("Investido no mês")).parentElement!;
    const text = invested.textContent?.replace(/ /g, " ");
    expect(text).toContain("R$ 690,00");
    expect(text).toContain("Fora da meta: R$ 90,00 (não conta no plano)");
    expect(textOutsideMoney(invested)).not.toMatch(/R\$/);
    // O "falta" só aparece quando a situação das categorias mantidas chega.
    await waitFor(() => expect(screen.getByText("Ainda falta aportar").nextElementSibling).toHaveTextContent(/R\$\s400,00/));
    expect(screen.queryByText("Extra do mês")).not.toBeInTheDocument();
  });

  it("sem aporte fora da meta, a linha não aparece", async () => {
    renderWith([comparisonItem("rf", "Renda fixa", "none", [])]);
    await screen.findByText("Investido no mês");
    expect(screen.queryByText(/Fora da meta/)).not.toBeInTheDocument();
  });
});

describe("PlanTracking com dinheiro separado", () => {
  const nb = (text: string | null) => (text ?? "").replace(/\s+/g, " ");
  const rf = comparisonItem("rf", "Renda fixa", "none", []);

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-privacy");
  });

  it("sem separado, a linha fica como sempre: sem trecho hachurado, sem texto de separado e sem valuetext", async () => {
    renderWith([rf], contribution, [{ class_key: "rf", amount_cents: 60_000, reserved_cents: 0, from_reserved_cents: 0 }]);
    const bar = await screen.findByRole("progressbar", { name: "Renda fixa: 60% do planejado já foi aportado" });
    expect(bar).not.toHaveAttribute("aria-valuetext");
    expect(bar.querySelector("[data-separated]")).toBeNull();
    expect(screen.queryByText(/separado/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Compra de/)).not.toBeInTheDocument();
  });

  it("separado e comprado ficam lado a lado e a frase diz os dois valores", async () => {
    // Plano de R$ 1.000: R$ 300 comprados e R$ 400 separados neste mês (o feito da meta é R$ 700).
    renderWith([rf], contribution, [{ class_key: "rf", amount_cents: 70_000, reserved_cents: 40_000 }]);
    const bar = await screen.findByRole("progressbar", { name: "Renda fixa: 70% do planejado coberto" });
    expect(bar).toHaveAttribute("aria-valuenow", "70");
    expect(nb(bar.getAttribute("aria-valuetext"))).toBe("R$ 300,00 comprado e R$ 400,00 separado, de R$ 1.000,00 planejado");
    expect((bar.querySelector("[data-fill]") as HTMLElement).style.width).toBe("30%");
    expect((bar.querySelector("[data-separated]") as SVGElement).style.width).toBe("40%");
    const row = bar.closest("li")!;
    expect(nb(row.textContent)).toContain("R$ 300,00 comprado + R$ 400,00 separado de R$ 1.000,00 planejado");
    expect(row).toHaveTextContent("faltam R$ 300,00");
    expect(row).not.toHaveTextContent("Cumprido");
    expect(textOutsideMoney(row)).not.toMatch(/R\$/);
  });

  it("comprado + separado cobrindo a meta diz Cumprido por escrito", async () => {
    renderWith([rf], contribution, [{ class_key: "rf", amount_cents: 100_000, reserved_cents: 40_000 }]);
    const bar = await screen.findByRole("progressbar", { name: "Renda fixa: 100% do planejado coberto" });
    const row = bar.closest("li")!;
    expect(row).toHaveTextContent("100% · Cumprido");
    expect(row).not.toHaveTextContent(/faltam/);
    expect(nb(row.textContent)).toContain("R$ 600,00 comprado + R$ 400,00 separado de R$ 1.000,00 planejado");
    // O plano todo também fecha: o separado conta como feito.
    await waitFor(() => expect(screen.getByText("Plano cumprido")).toBeInTheDocument());
  });

  it("só separado, sem nenhuma compra no mês: a barra tem só o trecho hachurado", async () => {
    renderWith([rf], contribution, [{ class_key: "rf", amount_cents: 40_000, reserved_cents: 40_000 }]);
    const bar = await screen.findByRole("progressbar", { name: "Renda fixa: 40% do planejado coberto" });
    expect(bar.querySelector("[data-fill]")).toBeNull();
    expect(bar.querySelector("[data-separated]")).not.toBeNull();
    expect(nb(bar.getAttribute("aria-valuetext"))).toBe("R$ 0,00 comprado e R$ 400,00 separado, de R$ 1.000,00 planejado");
  });

  it("o total do mês avisa quanto do investido ainda está separado", async () => {
    renderWith([rf], contribution, [{ class_key: "rf", amount_cents: 70_000, reserved_cents: 40_000 }]);
    const invested = (await screen.findByText("Investido no mês")).parentElement!;
    expect(nb(invested.textContent)).toContain("Inclui R$ 400,00 separados (ainda não investidos)");
    expect(textOutsideMoney(invested)).not.toMatch(/R\$/);
  });

  it("no mês seguinte, a compra paga com o separado aparece só como informação e não soma ao feito", async () => {
    // Outubro separou R$ 400; em novembro a compra de R$ 1.000 usou R$ 400 do separado: sobram R$ 600 no feito de novembro.
    renderWith([rf], { ...contribution, month: "2026-11" }, [{ class_key: "rf", amount_cents: 60_000, reserved_cents: 0, from_reserved_cents: 40_000 }]);
    const bar = await screen.findByRole("progressbar", { name: "Renda fixa: 60% do planejado já foi aportado" });
    const row = bar.closest("li")!;
    expect(nb(row.textContent)).toContain("Compra de R$ 400,00 usando o separado (já contada no mês em que foi separado)");
    expect(bar.querySelector("[data-separated]")).toBeNull();
    expect(row).toHaveTextContent("faltam R$ 400,00");
    expect(textOutsideMoney(row)).not.toMatch(/R\$/);
  });

  it("com ocultar valores, o aria-valuetext não carrega valores em reais", async () => {
    localStorage.setItem("il-privacy", "hidden");
    renderWith([rf], contribution, [{ class_key: "rf", amount_cents: 70_000, reserved_cents: 40_000 }]);
    const bar = await screen.findByRole("progressbar", { name: "Renda fixa: 70% do planejado coberto" });
    expect(bar.getAttribute("aria-valuetext")).toBe("70% do planejado coberto, entre comprado e separado");
  });
});

describe("PlanTracking: aportar um valor extra", () => {
  const rf = comparisonItem("rf", "Renda fixa", "none", []);
  const cripto = comparisonItem("cripto", "Cripto", "none", []);

  /** Divide em 60% renda fixa e o resto em cripto, sem perder centavo. */
  const splitIn60And40 = ({ amount_cents }: SplitBody) => {
    const first = Math.round(amount_cents * 0.6);
    const items = [
      { class_key: "rf", class_name: "Renda fixa", color: "#5aa88a", amount_cents: first },
      { class_key: "cripto", class_name: "Cripto", color: "#e5a05a", amount_cents: amount_cents - first },
    ];
    return new Response(JSON.stringify({ plan_id: 1, plan_name: "Plano padrão", mode: "rebalance", amount_cents, items }), { status: 200 });
  };

  const field = () => screen.getByRole("textbox", { name: "Valor extra (R$)" });
  const suggestion = () => screen.queryByRole("list", { name: "Sugestão de divisão do valor extra" });
  const pause = () => new Promise((resolve) => setTimeout(resolve, 400));

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-privacy");
  });

  it("com excesso já aportado, mostra o extra como fato e não sugere nada sozinho", async () => {
    splitHandler = splitIn60And40;
    renderWith([rf, cripto], contribution, [{ class_key: "rf", amount_cents: 150_000 }]);
    const extra = (await screen.findByText("Extra do mês")).parentElement!;
    expect(extra).toHaveTextContent(/\+\s*R\$\s*500,00/);
    expect(extra).toHaveTextContent("já aportado além do planejado");
    expect(screen.queryByText(/Onde colocar o extra/)).not.toBeInTheDocument();
    await pause();
    expect(splitCalls).toEqual([]);
    expect(suggestion()).not.toBeInTheDocument();
  });

  it("com o campo vazio, explica o que fazer e não mostra sugestão", async () => {
    splitHandler = splitIn60And40;
    renderWith([rf, cripto]);
    await screen.findByText("Investido no mês");
    expect(screen.getByRole("heading", { name: "Aportar um valor extra" })).toBeInTheDocument();
    expect(field()).toHaveAccessibleDescription("Digite quanto quer aportar a mais para ver onde colocar");
    await pause();
    expect(suggestion()).not.toBeInTheDocument();
    expect(splitCalls).toEqual([]);
  });

  it("valor digitado gera a divisão pela carteira de hoje, com o total igual ao digitado", async () => {
    splitHandler = splitIn60And40;
    const user = userEvent.setup();
    renderWith([rf, cripto]);
    await screen.findByText("Investido no mês");
    await user.type(field(), "500,01");

    const list = await screen.findByRole("list", { name: "Sugestão de divisão do valor extra" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(/Renda fixa\s*R\$\s*300,01/);
    expect(rows[1]).toHaveTextContent(/Cripto\s*R\$\s*200,00/);
    expect(rows[2]).toHaveTextContent(/Total sugerido\s*R\$\s*500,01/);
    expect(screen.getByText("A soma confere com o valor digitado.")).toBeInTheDocument();
    // Simulação sobre a carteira de hoje: sem `month`, e só consultas do valor final (o debounce poupa as parciais).
    expect(splitCalls.at(-1)).toEqual({ amount_cents: 50_001, mode: "rebalance", plan_id: null, month: null });
    expect(splitCalls.every((c) => c.amount_cents === 50_001)).toBe(true);
    // O resultado é anunciado a leitor de tela; o botão principal continua o mesmo e o atalho leva ao mesmo lugar.
    expect(list.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("link", { name: "Registrar aportes" })).toHaveAttribute("href", "/carteira/movimentacoes?novo=aporte");
    expect(screen.getByRole("link", { name: "Registrar aportes na Carteira" })).toHaveAttribute("href", "/carteira/movimentacoes?novo=aporte");
    // Não guarda o digitado em lugar nenhum.
    expect(localStorage.length).toBe(0);
  });

  it("valor inválido ou zero diz como digitar e não consulta", async () => {
    splitHandler = splitIn60And40;
    const user = userEvent.setup();
    renderWith([rf, cripto]);
    await screen.findByText("Investido no mês");
    await user.type(field(), "abc");
    expect(field()).toBeInvalid();
    expect(field()).toHaveAccessibleDescription("Digite um valor como 500,00");
    await user.clear(field());
    await user.type(field(), "0");
    expect(field()).toHaveAccessibleDescription("Digite um valor como 500,00");
    await pause();
    expect(splitCalls).toEqual([]);
  });

  it("avisa que o plano ainda tem valor pendente e que a sugestão parte da carteira de hoje", async () => {
    renderWith([rf, cripto], contribution, [{ class_key: "rf", amount_cents: 60_000 }]);
    const warning = await screen.findByText(/O plano ainda tem/);
    expect(warning).toHaveTextContent(/R\$\s*400,00 pendentes; a sugestão do extra parte da carteira de hoje\./);
  });

  it("com o plano cumprido, o aviso de pendente não aparece", async () => {
    renderWith([rf, cripto], contribution, [{ class_key: "rf", amount_cents: 100_000 }]);
    await screen.findByText("Plano cumprido");
    expect(screen.queryByText(/O plano ainda tem/)).not.toBeInTheDocument();
  });

  it("erro da API aparece com a causa, sem sugestão", async () => {
    splitHandler = () => new Response(JSON.stringify({ detail: "Carteira indisponível" }), { status: 500 });
    const user = userEvent.setup();
    renderWith([rf, cripto]);
    await screen.findByText("Investido no mês");
    await user.type(field(), "500");
    expect(await screen.findByRole("alert")).toHaveTextContent("Carteira indisponível");
    expect(suggestion()).not.toBeInTheDocument();
  });

  it("com todos os ativos mantidos, explica o motivo e o que fazer", async () => {
    splitHandler = () => new Response(JSON.stringify({ detail: "Todos os ativos em manter posição", code: "all_held" }), { status: 422 });
    const user = userEvent.setup();
    renderWith([rf, cripto]);
    await screen.findByText("Investido no mês");
    await user.type(field(), "500");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent('todos os ativos estão em "Manter posição"');
    expect(alert).toHaveTextContent("Editar cadastro");
  });

  it("com ocultar valores, a sugestão sai toda em <Money>", async () => {
    localStorage.setItem("il-privacy", "hidden");
    splitHandler = splitIn60And40;
    const user = userEvent.setup();
    renderWith([rf, cripto], contribution, [{ class_key: "rf", amount_cents: 60_000 }]);
    await screen.findByText("Investido no mês");
    await user.type(field(), "500");
    const list = await screen.findByRole("list", { name: "Sugestão de divisão do valor extra" });
    expect(unprotectedMoney(list.closest("section")!)).toEqual([]);
  });
});
