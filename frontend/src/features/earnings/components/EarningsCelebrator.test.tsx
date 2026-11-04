import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onCelebrate, type ActiveCelebration } from "@/shared/lib/celebrate";
import { established, milestones } from "../testData";
// Saída real de GET /earnings gerada pelo back-end (banco em memória, hoje = 17/10/2026): setembro fechado
// com R$ 85,00 de rendimento, que conquista o primeiro salário e 1% do salário em set/2026.
import realShape from "../testData.realShape.json";
import type { Earnings } from "../types";
import { CELEBRATED_DEMO_KEY, CELEBRATED_KEY, forgetCelebratedInMemory } from "../lib/celebrated";
import { EarningsCelebrator } from "./EarningsCelebrator";

/** localStorage de mentira, para cada teste começar do zero (e poder falhar de propósito). */
function fakeStorage({ broken = false } = {}) {
  const store = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => {
      if (broken) throw new Error("bloqueado");
      return store.get(key) ?? null;
    }),
    setItem: vi.fn((key: string, value: string) => {
      if (broken) throw new Error("bloqueado");
      store.set(key, value);
    }),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(),
    length: 0,
  };
  vi.stubGlobal("localStorage", storage);
  return store;
}

function mount(body: Earnings, { demo = false } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/system/status")
        ? new Response(JSON.stringify({ demo }), { status: 200 })
        : new Response(JSON.stringify(body), { status: 200 }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <EarningsCelebrator />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

let celebrations: ActiveCelebration[] = [];
let stop: () => void = () => {};

beforeEach(() => {
  forgetCelebratedInMemory();
  celebrations = [];
  stop = onCelebrate((c) => celebrations.push(c));
});

afterEach(() => {
  stop();
  vi.unstubAllGlobals();
});

describe("Celebração dos marcos do salário do seu dinheiro", () => {
  it("na primeira carga, não celebra marcos antigos, mas os lembra como vistos", async () => {
    const store = fakeStorage();
    mount(established({ milestones: milestones({ first_salary: "2026-07", share_5: "2026-08" }) }));

    await waitFor(() => expect(store.get(CELEBRATED_KEY)).toBeDefined());
    expect(JSON.parse(store.get(CELEBRATED_KEY)!).sort()).toEqual(["first_salary", "share_5"]);
    expect(celebrations).toHaveLength(0);
  });

  it("celebra uma vez só o marco novo do mês, mesmo com os dados recarregando", async () => {
    const store = fakeStorage();
    store.set(CELEBRATED_KEY, JSON.stringify(["first_salary", "share_1", "share_5", "total_100"]));
    const { client } = mount(established());

    await waitFor(() => expect(celebrations).toHaveLength(1));
    expect(celebrations[0].title.replace(/\s/g, " ")).toBe("Seu dinheiro já rendeu R$ 1.000,00!");
    expect(celebrations[0].highlight).toBe("Próximo marco: 10% do seu salário");

    await client.invalidateQueries({ queryKey: ["earnings"] });
    await client.refetchQueries({ queryKey: ["earnings"] });
    expect(celebrations).toHaveLength(1);
    expect(JSON.parse(store.get(CELEBRATED_KEY)!)).toContain("total_1000");
  });

  it("no modo demonstração, lembra em outra chave", async () => {
    const store = fakeStorage();
    mount(established({ milestones: milestones({ share_1: "2026-07" }) }), { demo: true });

    await waitFor(() => expect(store.get(CELEBRATED_DEMO_KEY)).toBeDefined());
    expect(store.has(CELEBRATED_KEY)).toBe(false);
  });

  it("funciona sem localStorage: lembra na memória da aba e não repete", async () => {
    fakeStorage({ broken: true });
    const before = milestones({ first_salary: "2026-07", share_1: "2026-07", share_5: "2026-07", total_100: "2026-07" });
    const first = mount(established({ milestones: before })); // primeira carga: só marca como visto
    await new Promise((r) => setTimeout(r, 20));
    first.unmount();
    expect(celebrations).toHaveLength(0);

    const second = mount(established()); // chegou R$ 1.000 acumulados em outubro
    await waitFor(() => expect(celebrations).toHaveLength(1));
    second.unmount();

    mount(established());
    await new Promise((r) => setTimeout(r, 20));
    expect(celebrations).toHaveLength(1);
  });
});

describe("Contrato real do back-end", () => {
  const real = realShape as unknown as Earnings;

  it("o primeiro salário e o 1% chegam com o mês completo anterior, nunca no mês corrente", () => {
    const shares = real.milestones.filter((m) => m.kind !== "total_amount" && m.achieved_month);
    expect(shares.map((m) => [m.key, m.achieved_month])).toEqual([
      ["first_salary", "2026-09"],
      ["share_1", "2026-09"],
    ]);
    expect(real.current_month.month).toBe("2026-10");
  });

  it("na primeira carga, marca o que já existe como visto, sem confete", async () => {
    const store = fakeStorage();
    mount(real);
    await waitFor(() => expect(store.get(CELEBRATED_KEY)).toBeDefined());
    expect(JSON.parse(store.get(CELEBRATED_KEY)!).sort()).toEqual(["first_salary", "share_1"]);
    expect(celebrations).toHaveLength(0);
  });

  it("o primeiro salário de setembro, visto em outubro, é celebrado uma vez e não de novo", async () => {
    const store = fakeStorage();
    store.set(CELEBRATED_KEY, "[]"); // já havia carregado antes, ainda sem marcos
    const first = mount(real);

    await waitFor(() => expect(celebrations).toHaveLength(1));
    expect(celebrations[0].title).toBe("Primeiro salário do seu dinheiro!");
    expect(celebrations[0].text.replace(/\s/g, " ")).toBe(
      "Em setembro, seus investimentos renderam R$ 85,00 para você (1,7% do seu salário), sem contar os aportes.",
    );
    expect(celebrations[0].highlight).toBe("Próximo marco: 5% do seu salário");
    first.unmount();

    mount(real);
    await new Promise((r) => setTimeout(r, 20));
    expect(celebrations).toHaveLength(1);
    expect(JSON.parse(store.get(CELEBRATED_KEY)!).sort()).toEqual(["first_salary", "share_1"]);
  });
});
