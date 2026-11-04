import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlansSection } from "./PlansSection";
import type { Comparison, ComparisonItem, HoldStatus, Plan } from "./types";

const target = (key: string, name: string, bps: number) => ({
  class_id: key.length,
  class_key: key,
  class_name: name,
  color: "#5aa88a",
  percent_bps: bps,
});

const plan = (targets: ReturnType<typeof target>[]): Plan => ({
  id: 1,
  name: "Plano padrão",
  is_active: true,
  created_at: null,
  targets,
});

const compItem = (key: string, name: string, hold_status: HoldStatus, held: string[] = []): ComparisonItem => ({
  class_id: key.length,
  class_key: key,
  class_name: name,
  color: "#5aa88a",
  current_cents: 1000,
  current_bps: 3333,
  target_bps: 3333,
  effective_target_bps: 3333,
  hold_status,
  diff_cents: hold_status === "all" ? null : 0,
  held_assets: held.map((n, i) => ({ asset_id: i + 1, name: n, current_cents: 500 })),
});

function mockApi(initial: Plan, comparisonItems: ComparisonItem[] = []) {
  let current = initial;
  const puts: unknown[] = [];
  const comparison: Comparison = { plan_id: 1, plan_name: "Plano padrão", total_cents: 3000, base_cents: 3000, items: comparisonItems };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/allocation/plans/1") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { targets: { class_key: string; percent_bps: number }[] };
        puts.push(body);
        current = {
          ...current,
          targets: current.targets.map((t) => ({ ...t, percent_bps: body.targets.find((b) => b.class_key === t.class_key)!.percent_bps })),
        };
        return new Response(JSON.stringify(current), { status: 200 });
      }
      if (url.endsWith("/allocation/plans")) return new Response(JSON.stringify([current]), { status: 200 });
      if (url.endsWith("/allocation/comparison")) return new Response(JSON.stringify(comparison), { status: 200 });
      if (url.endsWith("/contributions")) return new Response(JSON.stringify([]), { status: 200 });
      return new Response(JSON.stringify({}), { status: 404 });
    }),
  );
  return puts;
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PlansSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Planos: metas de todas as categorias", () => {
  it("não tem mais o interruptor de manter posição por categoria e salva só as metas", async () => {
    const puts = mockApi(plan([target("rf", "Renda fixa", 6000), target("acoes", "Ações", 3000), target("cripto", "Cripto", 1000)]));
    renderSection();

    const input = await screen.findByRole("textbox", { name: "Meta de Cripto (%)" });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(input).toBeEnabled();

    await userEvent.clear(input);
    await userEvent.type(input, "20{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Metas salvas. A divisão do próximo aporte já segue este plano.");
    const sent = puts[0] as { targets: { class_key: string; percent_bps: number }[] };
    expect(sent.targets.reduce((sum, t) => sum + t.percent_bps, 0)).toBe(10000);
    expect(sent.targets.find((t) => t.class_key === "cripto")).toEqual({ class_key: "cripto", percent_bps: 2000 });
    expect(sent.targets.every((t) => !("hold_only" in t))).toBe(true);
  });

  it("lista as categorias com ativos mantidos, diferencia toda mantida de parcial e aponta para a Carteira", async () => {
    mockApi(plan([target("rf", "Renda fixa", 5000), target("rv", "Renda variável", 3000), target("cripto", "Cripto", 2000)]), [
      compItem("rf", "Renda fixa", "none"),
      compItem("rv", "Renda variável", "all", ["PETR4", "VALE3"]),
      compItem("cripto", "Cripto", "partial", ["ETH"]),
    ]);
    renderSection();

    const notice = (await screen.findByRole("heading", { name: /Ativos mantidos/ })).closest("section")!;
    expect(within(notice).getByText(/todos os ativos mantidos \(PETR4 e VALE3\)/)).toBeInTheDocument();
    expect(within(notice).getByText(/Mantida: meta suspensa/)).toBeInTheDocument();
    expect(within(notice).getByText(/ETH mantido\. A meta continua valendo/)).toBeInTheDocument();
    expect(within(notice).queryByText(/Renda fixa/)).not.toBeInTheDocument();
    expect(within(notice).getByRole("link", { name: "Ver ativos de Cripto na Carteira" })).toHaveAttribute(
      "href",
      "/carteira/ativos?categoria=cripto",
    );

    // A meta da categoria toda mantida continua editável (vale de novo quando ela voltar a receber).
    expect(screen.getByRole("textbox", { name: "Meta de Renda variável (%)" })).toBeEnabled();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("com tudo mantido, a prévia não quebra e diz o que fazer", async () => {
    mockApi(plan([target("rf", "Renda fixa", 6000), target("cripto", "Cripto", 4000)]), [
      compItem("rf", "Renda fixa", "all", ["CDB"]),
      compItem("cripto", "Cripto", "all", ["BTC"]),
    ]);
    renderSection();
    expect(await screen.findByText(/Todos os ativos estão em "Manter posição"/)).toBeInTheDocument();
    expect(screen.getAllByText("sem aporte")).toHaveLength(2);
    // "Total simulado" em <Money>, para o modo ocultar valores esconder.
    const total = screen.getByText(/Total simulado/);
    const copy = total.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".money").forEach((m) => m.remove());
    expect(copy.textContent).not.toMatch(/R\$/);
  });

  it("recusa salvar metas que não somam 100% e diz por quê", async () => {
    mockApi(plan([target("rf", "Renda fixa", 6000), target("acoes", "Ações", 3000)]));
    renderSection();
    expect(await screen.findByRole("alert")).toHaveTextContent("As metas das categorias devem somar 100%, mas somam 90%.");
  });
});
