import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { established, starting } from "../testData";
import type { Earnings } from "../types";
import { EarningsSection } from "./EarningsSection";

function renderSection(body: Earnings, path = "/metas") {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <EarningsSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

afterEach(() => vi.unstubAllGlobals());

describe("Seção Salário do seu dinheiro (Metas)", () => {
  it("diz em texto quais marcos foram conquistados e quando", async () => {
    renderSection(established());
    const first = (await screen.findByText("Primeiro salário do seu dinheiro")).closest("li")!;
    expect(first).toHaveTextContent("✓");
    expect(first).toHaveTextContent("Conquistado em jul/2026");
    expect(screen.getByText("5 de 11 marcos conquistados.")).toBeInTheDocument();
    const share25 = screen.getByText("25% do seu salário em um mês").closest("li")!;
    expect(share25).toHaveTextContent("A conquistar");
  });

  it("o próximo marco tem barra, quanto do caminho já foi e quanto falta em reais", async () => {
    renderSection(established());
    const bar = await screen.findByRole("progressbar", { name: "Caminho até o próximo marco" });
    expect(bar).toHaveAttribute("aria-valuenow", "60");
    const item = bar.closest("li")!;
    expect(item).toHaveTextContent("10% do seu salário em um mês");
    expect(item).toHaveTextContent("Próximo marco");
    expect(norm(item.textContent)).toContain("60% do caminho · seu melhor mês até agora chegou a 9% do seu salário; a meta é 10%.");
    expect(item).toHaveTextContent("Outubro até agora: 6% do seu salário (conta quando o mês fechar).");
    expect(item).not.toHaveTextContent("faltam");
  });

  it("a tabela tem legenda e cabeçalhos, mês mais novo primeiro, e diz quando o saldo não foi atualizado", async () => {
    renderSection(established());
    const table = await screen.findByRole("table", { name: /Mês a mês/ });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(["Mês", "Rendeu", "Valorização", "Proventos", "% do salário"]);

    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("rowheader").textContent)).toEqual([
      "out/2026 (até 17/10)",
      "set/2026",
      "ago/2026",
      "jul/2026",
    ]);
    expect(rows[2]).toHaveTextContent("sem atualização de saldo");
    expect(rows[2]).not.toHaveTextContent("R$");
    expect(norm(rows[1].textContent)).toContain("▲ rendeu R$ 450,00");
    expect(rows[1]).toHaveTextContent("9%");
    // Setembro vem depois de agosto sem atualização: concentra o rendimento dos dois.
    expect(rows[1]).toHaveTextContent("inclui meses sem atualização de saldo");
    expect(rows[0]).not.toHaveTextContent("inclui meses sem atualização de saldo");
  });

  it("valores negativos na tabela têm o sinal escrito", async () => {
    const e = established();
    e.months[3] = { ...e.months[3], earned_cents: -1_000, appreciation_cents: -1_000 };
    renderSection(e);
    const table = await screen.findByRole("table", { name: /Mês a mês/ });
    expect(norm(within(table).getAllByRole("row")[1].textContent)).toContain("▼ recuou R$ 10,00");
  });

  it("sem ativos, convida a começar", async () => {
    renderSection(starting({ tracking_since: null }));
    expect(await screen.findByRole("link", { name: "Cadastrar ativo" })).toBeInTheDocument();
  });

  it("chegando pelo link de conquistas, rola até a seção", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderSection(established(), "/metas#salario-do-dinheiro");
    await screen.findByRole("table", { name: /Mês a mês/ });
    expect(scroll).toHaveBeenCalled();
  });
});
