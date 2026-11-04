import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "../types";
import { AssetDistributionCard } from "./AssetDistributionCard";

// O gráfico depende de medidas de tela que o jsdom não tem; a legenda e a tabela cobrem os mesmos números.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

const asset = (id: number, name: string, current_cents: number, extra: Partial<Asset> = {}) =>
  ({
    id,
    name,
    institution_name: "Banco",
    class_name: "Renda Fixa",
    purpose: null,
    valuation_date: "2026-10-17",
    current_cents,
    ...extra,
  }) as Asset;

function renderCard(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AssetDistributionCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

const assets = [
  asset(1, "CDB Midway", 60_000, { institution_name: "Midway" }),
  asset(2, "Tesouro Reserva", 30_000, { purpose: "reserva", class_name: "Renda Fixa", institution_name: "Tesouro" }),
  asset(3, "VGHF11", 10_000, { class_name: "Renda Variável", institution_name: "XP" }),
];

describe("Distribuição da carteira por ativo", () => {
  it("tem título, diz que inclui a reserva e até que dia valem os saldos", async () => {
    renderCard(assets);

    expect(await screen.findByRole("heading", { name: "Distribuição da carteira por ativo" })).toBeInTheDocument();
    expect(screen.getByText(/Inclui a reserva de emergência/)).toBeInTheDocument();
    expect(await screen.findByText(/saldos até 17\/10/i)).toBeInTheDocument();
  });

  it("a legenda lista cada ativo com a participação e o valor, do maior para o menor", async () => {
    renderCard(assets);

    const legend = await screen.findByRole("list", { name: /Legenda/ });
    const items = within(legend).getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.replace(/\s+/g, " "))).toEqual([
      expect.stringMatching(/CDB Midway.*60%.*R\$ 600,00/),
      expect.stringMatching(/Tesouro Reserva.*reserva.*30%.*R\$ 300,00/),
      expect.stringMatching(/VGHF11.*10%.*R\$ 100,00/),
    ]);
  });

  it("descreve o gráfico em texto e mostra o total no centro", async () => {
    renderCard(assets);

    const chart = await screen.findByRole("img", { name: /Gráfico de pizza/ });
    expect(chart).toHaveAccessibleName(/CDB Midway 60%/);
    expect(chart).toHaveAccessibleName(/VGHF11 10%/);
    expect(screen.getByText("Total")).toBeInTheDocument();
    // O valor do total passa por <Money>: respeita "ocultar valores".
    const money = [...document.querySelectorAll(".money")].map((el) => el.textContent?.replace(/\s+/g, " "));
    expect(money).toContain("R$ 1.000,00");
  });

  it("a tabela mostra todos os ativos com instituição, categoria, valor e participação", async () => {
    renderCard(assets);

    const group = await screen.findByRole("group", { name: "Tabela da distribuição por ativo" });
    const table = within(group).getByRole("table");
    const row = within(table).getByRole("row", { name: /VGHF11/ });
    expect(row).toHaveTextContent("XP");
    expect(row).toHaveTextContent("Renda Variável");
    expect(row).toHaveTextContent("10%");
    expect(within(table).getByRole("row", { name: /Tesouro Reserva/ })).toHaveTextContent("reserva");
  });

  it("com muitos ativos, os menores viram \"Outros\" e a tabela continua listando cada um", async () => {
    const many = Array.from({ length: 9 }, (_, i) => asset(i + 1, `Ativo ${i + 1}`, 10_000 - i * 1_000));
    renderCard(many);

    const legend = await screen.findByRole("list", { name: /Legenda/ });
    expect(within(legend).getAllByRole("listitem")).toHaveLength(6);
    const others = within(legend).getByText(/Outros/).closest("li")!;
    expect(others).toHaveTextContent("4 ativos");
    const table = within(screen.getByRole("group", { name: "Tabela da distribuição por ativo" })).getByRole("table");
    expect(within(table).getByRole("row", { name: /Ativo 9/ })).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(10); // cabeçalho + 9
  });

  it("não mostra item de 0% na legenda nem no resumo do gráfico, mas a tabela lista o ativo", async () => {
    renderCard([asset(1, "Grande", 999_999), asset(2, "Migalha", 1)]);

    const legend = await screen.findByRole("list", { name: /Legenda/ });
    const items = within(legend).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(legend).not.toHaveTextContent("Migalha");
    expect(legend).not.toHaveTextContent(/(^|[^\d,])0%/);
    expect(screen.getByRole("img", { name: /Gráfico de pizza/ })).not.toHaveAccessibleName(/(^|[^\d,])0%/);
    const table = within(screen.getByRole("group", { name: "Tabela da distribuição por ativo" })).getByRole("table");
    expect(within(table).getByRole("row", { name: /Migalha/ })).toHaveTextContent("0%");
  });

  it("ativo fino demais aparece em \"Outros\" com o percentual real, igual na legenda e na tabela", async () => {
    renderCard([asset(1, "A", 60_000), asset(2, "B", 39_000), asset(3, "Pequeno", 1_000)]);

    const legend = await screen.findByRole("list", { name: /Legenda/ });
    const others = within(legend).getByText(/Outros/).closest("li")!;
    expect(others).toHaveTextContent("1 ativo menor: Pequeno");
    expect(others).toHaveTextContent("1%");
    const table = within(screen.getByRole("group", { name: "Tabela da distribuição por ativo" })).getByRole("table");
    expect(within(table).getByRole("row", { name: /Pequeno/ })).toHaveTextContent("1%");
  });

  it("o resumo do gráfico diz quais ativos \"Outros\" reúne", async () => {
    renderCard([asset(1, "A", 60_000), asset(2, "B", 39_000), asset(3, "Pequeno", 1_000)]);

    expect(await screen.findByRole("img", { name: /Gráfico de pizza/ })).toHaveAccessibleName(/Outros 1% \(Pequeno\)/);
  });

  it("sem ativos com saldo, orienta o próximo passo", async () => {
    renderCard([asset(1, "A", 0)]);

    expect(await screen.findByText(/Cadastre ativos e atualize os saldos/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atualizar saldos" })).toHaveAttribute("href", "/carteira/atualizar");
    expect(screen.queryByRole("img", { name: /Gráfico de pizza/ })).not.toBeInTheDocument();
  });

  it("mostra o carregamento e o erro", async () => {
    renderCard({ detail: "Falhou ao ler os ativos." }, 500);

    expect(screen.getByRole("status")).toHaveTextContent("Carregando");
    expect(await screen.findByRole("alert")).toHaveTextContent("Falhou ao ler os ativos.");
  });
});
