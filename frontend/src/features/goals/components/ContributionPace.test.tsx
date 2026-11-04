import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PACE_DISMISSED_DEMO_KEY, PACE_DISMISSED_KEY } from "../lib/pace";
import type { ContributionPace as Pace, GoalSettings } from "../types";
import { ContributionPace } from "./ContributionPace";

const nb = (text: string | null) => (text ?? "").replace(/ /g, " ");

const settings: GoalSettings = {
  net_worth_goal_cents: 100_000_000,
  year_goal_cents: 5_000_000,
  monthly_cents: 150_000,
  horizon_years: 20,
  inflation_bps: 450,
  conservative_bps: 600,
  base_bps: 900,
  optimistic_bps: 1_200,
};

function pace(extra: Partial<Pace> = {}): Pace {
  return {
    reference_month: "2026-09",
    windows: [
      { months: 3, average_cents: 210_000, months_with_data: 3 },
      { months: 6, average_cents: 200_000, months_with_data: 5 },
      { months: 12, average_cents: 180_000, months_with_data: 1 },
    ],
    goal_cents: 150_000,
    suggestion: { window_months: 6, average_cents: 200_000, suggested_cents: 200_000 },
    ...extra,
  };
}

function mount(p: Pace, { demo = false } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/system/status")) return new Response(JSON.stringify({ demo }), { status: 200 });
      if (init?.method === "PUT") return new Response(init.body as string, { status: 200 });
      return new Response(JSON.stringify({}), { status: 404 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ContributionPace pace={p} settings={settings} />
    </QueryClientProvider>,
  );
  return calls;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("Seu ritmo de aportes", () => {
  it("mostra as médias de 3, 6 e 12 meses com quantos meses tiveram aporte", async () => {
    mount(pace());
    const section = screen.getByRole("region", { name: "Seu ritmo de aportes" });
    expect(within(section).getByText(/em meses completos até set\/2026 \(o mês atual fica de fora\)/)).toBeInTheDocument();
    const items = within(section).getAllByRole("term").map((t) => nb(t.parentElement!.textContent));
    expect(items).toEqual([
      "Últimos 3 mesesR$ 2.100,00 /mês(3 meses com aporte)",
      "Últimos 6 mesesR$ 2.000,00 /mês(5 meses com aporte)",
      "Últimos 12 mesesR$ 1.800,00 /mês(1 mês com aporte)",
    ]);
    expect(await screen.findByRole("button", { name: /^Aumentar meta para R\$\s2\.000,00$/ })).toBeInTheDocument();
  });

  it("a sugestão é discreta (não é alerta) e diz a média e a meta", async () => {
    mount(pace());
    await screen.findByRole("button", { name: /Aumentar meta/ });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(nb(screen.getByText(/Você tem aportado em média/).textContent)).toBe(
      "Você tem aportado em média R$ 2.000,00, acima da meta de R$ 1.500,00.",
    );
  });

  it("sem meses completos com aporte, diz isso em vez de mostrar zeros", () => {
    mount(
      pace({
        windows: [
          { months: 3, average_cents: null, months_with_data: 0 },
          { months: 6, average_cents: null, months_with_data: 0 },
          { months: 12, average_cents: null, months_with_data: 0 },
        ],
        suggestion: null,
      }),
    );
    expect(screen.getByText("Ainda sem meses completos com aporte.")).toBeInTheDocument();
    expect(screen.queryByRole("term")).not.toBeInTheDocument();
  });

  it("com a meta no automático (0), mostra as médias sem sugerir", async () => {
    mount(pace({ goal_cents: 0 }));
    expect(screen.getByText(/Meta de aporte mensal: automática/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("term")).toHaveLength(3));
    expect(screen.queryByRole("button", { name: /Aumentar meta/ })).not.toBeInTheDocument();
  });

  it("aumentar a meta salva só o aporte mensal, mantém o resto e confirma", async () => {
    const user = userEvent.setup();
    const calls = mount(pace());
    await user.click(await screen.findByRole("button", { name: /^Aumentar meta para R\$\s2\.000,00$/ }));

    await waitFor(() => expect(calls.some((c) => c.init?.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(put.url).toBe("/api/v1/goals/settings");
    expect(JSON.parse(String(put.init!.body))).toEqual({ ...settings, monthly_cents: 200_000 });
    const done = await screen.findByRole("status");
    expect(nb(done.textContent)).toBe("Meta de aporte mensal agora é R$ 2.000,00. A projeção já usa o novo valor.");
    expect(done).toHaveFocus();
    expect(screen.queryByRole("button", { name: /Aumentar meta/ })).not.toBeInTheDocument();
  });

  it("“Agora não” esconde a sugestão para aquele valor, sem salvar nada", async () => {
    const user = userEvent.setup();
    const calls = mount(pace());
    await user.click(await screen.findByRole("button", { name: "Agora não" }));
    expect(screen.queryByRole("button", { name: /Aumentar meta/ })).not.toBeInTheDocument();
    expect(localStorage.getItem(PACE_DISMISSED_KEY)).toBe("200000");
    expect(calls.some((c) => c.init?.method === "PUT")).toBe(false);
  });

  it("dispensada para outro valor, a sugestão nova volta a aparecer", async () => {
    localStorage.setItem(PACE_DISMISSED_KEY, "190000");
    mount(pace());
    expect(await screen.findByRole("button", { name: /Aumentar meta/ })).toBeInTheDocument();
  });

  it("dispensada para o mesmo valor, não aparece", async () => {
    localStorage.setItem(PACE_DISMISSED_KEY, "200000");
    const calls = mount(pace());
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/system/status"))).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: /Aumentar meta/ })).not.toBeInTheDocument();
  });

  it("na demonstração, lembra em outra chave", async () => {
    const user = userEvent.setup();
    localStorage.setItem(PACE_DISMISSED_KEY, "200000"); // dispensa real não vale para a demonstração
    mount(pace(), { demo: true });
    await user.click(await screen.findByRole("button", { name: "Agora não" }));
    expect(localStorage.getItem(PACE_DISMISSED_DEMO_KEY)).toBe("200000");
  });
});
