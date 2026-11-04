import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Evolution } from "../types";
import { CompositionTab } from "./CompositionTab";

// O gráfico depende de medidas de tela que o jsdom não tem; as tabelas cobrem os mesmos números.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

const classes = [
  { id: 1, key: "renda_fixa", name: "Renda fixa", color: "#111111", archived: false },
  { id: 2, key: "fii", name: "FII", color: "#222222", archived: false },
  { id: 3, key: "acoes", name: "Ações/ETF", color: "#333333", archived: false },
];

const evolution: Evolution = {
  classes: classes.map(({ key, name, color, archived }) => ({ key, name, color, archived })),
  summary: null,
  points: [
    { date: "2026-08-31", total_cents: 100_000, invested_cents: 90_000, reserve_cents: 0, by_class: { renda_fixa: 60_000, fii: 25_000, acoes: 15_000 } },
    { date: "2026-09-30", total_cents: 110_000, invested_cents: 95_000, reserve_cents: 0, by_class: { renda_fixa: 55_000, fii: 30_000, acoes: 25_000 } },
  ],
};

function renderTab(groups: unknown, data: Evolution = evolution, classList: unknown = classes) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/asset-classes")) return new Response(JSON.stringify(classList), { status: 200 });
      if (url.includes("/asset-groups")) return new Response(JSON.stringify(groups), { status: 200 });
      return new Response(JSON.stringify({}), { status: 404 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CompositionTab range="all" data={data} loading={false} error={null} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

const rendaVariavel = { id: 9, name: "Renda variável", color: "#8a6bbf", archived: false, class_ids: [2, 3] };

describe("Histórico > Composição: por categoria ou por grupo", () => {
  it("sem grupos, não oferece a escolha e a tabela é por categoria", async () => {
    renderTab([]);

    expect(await screen.findByRole("heading", { name: "Participação por categoria" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Agrupar a composição por" })).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: /Participação percentual de cada categoria/ });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Data do saldo", "Renda fixa", "FII", "Ações/ETF"]);
  });

  it("por grupo, soma as categorias do grupo, mantém a tabela alternativa e avisa que usa o grupo atual", async () => {
    renderTab([rendaVariavel]);

    const choice = await screen.findByRole("group", { name: "Agrupar a composição por" });
    expect(within(choice).getByRole("button", { name: "Por categoria" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(choice).getByRole("button", { name: "Por grupo" }));

    expect(screen.getByRole("heading", { name: "Participação por grupo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Valor por grupo" })).toBeInTheDocument();
    expect(screen.getByText(/O agrupamento usa o grupo atual de cada categoria, inclusive nos meses passados/)).toBeInTheDocument();
    expect(screen.getByText(/Renda variável reúne FII e Ações\/ETF/)).toBeInTheDocument();

    const shares = screen.getByRole("table", { name: /Participação percentual de cada grupo/ });
    expect(within(shares).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Data do saldo", "Renda fixa", "Renda variável"]);
    // Em 31/08: renda fixa 600 de 1.000 (60%); FII 250 + Ações/ETF 150 = 400 (40%).
    const firstShare = within(shares).getByRole("row", { name: /31\/08\/2026/ });
    expect(within(firstShare).getAllByRole("cell").map((c) => c.textContent)).toEqual(["60%", "40%"]);

    const values = screen.getByRole("table", { name: /Valor de cada grupo/ });
    expect(within(within(values).getByRole("row", { name: /31\/08\/2026/ })).getAllByRole("cell")[1]).toHaveTextContent(/R\$\s400,00/);
  });

  it("categoria arquivada que continua no grupo é somada a ele (a lista de grupos só traz as ativas) e o total fecha", async () => {
    // Ações/ETF foi arquivada, mas guarda o group_id; o back-end só lista as categorias ativas em class_ids.
    const withArchived: Evolution = { ...evolution, classes: evolution.classes.map((c) => (c.key === "acoes" ? { ...c, archived: true } : c)) };
    const classList = classes.map((c) => ({ ...c, group_id: c.id === 1 ? null : 9, archived: c.id === 3 }));
    renderTab([{ ...rendaVariavel, class_ids: [2] }], withArchived, classList);

    await userEvent.click(within(await screen.findByRole("group", { name: "Agrupar a composição por" })).getByRole("button", { name: "Por grupo" }));

    const shares = screen.getByRole("table", { name: /Participação percentual de cada grupo/ });
    expect(within(shares).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Data do saldo", "Renda fixa", "Renda variável"]);
    expect(screen.queryByText(/arquivada/)).not.toBeInTheDocument();
    const row = within(shares).getByRole("row", { name: /31\/08\/2026/ });
    const parts = within(row).getAllByRole("cell").map((c) => Number.parseInt(c.textContent ?? "", 10));
    expect(parts).toEqual([60, 40]);
    expect(parts[0] + parts[1]).toBe(100);
  });

  it("volta para categorias ao desfazer a escolha", async () => {
    renderTab([rendaVariavel]);
    const choice = await screen.findByRole("group", { name: "Agrupar a composição por" });
    await userEvent.click(within(choice).getByRole("button", { name: "Por grupo" }));
    await userEvent.click(within(choice).getByRole("button", { name: "Por categoria" }));
    expect(screen.getByRole("heading", { name: "Participação por categoria" })).toBeInTheDocument();
    expect(screen.queryByText(/O agrupamento usa o grupo atual/)).not.toBeInTheDocument();
  });
});
