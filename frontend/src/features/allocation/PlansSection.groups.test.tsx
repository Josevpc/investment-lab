import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlansSection } from "./PlansSection";
import type { Plan } from "./types";

const target = (class_id: number, key: string, name: string, bps: number) => ({
  class_id,
  class_key: key,
  class_name: name,
  color: "#5aa88a",
  percent_bps: bps,
});

const plan: Plan = {
  id: 1,
  name: "Plano padrão",
  is_active: true,
  created_at: null,
  targets: [target(1, "rf", "Renda fixa", 7000), target(2, "fii", "FII", 1500), target(3, "acoes", "Ações/ETF", 1500)],
};

function mockApi(groups: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.endsWith("/allocation/plans")) return json([plan]);
      if (url.includes("/asset-groups")) return groups === null ? new Response(JSON.stringify({ detail: "não existe" }), { status: 404 }) : json(groups);
      if (url.endsWith("/allocation/comparison")) return json({ plan_id: 1, plan_name: "Plano padrão", total_cents: 0, base_cents: 0, items: [] });
      if (url.endsWith("/contributions")) return json([]);
      return new Response(JSON.stringify({}), { status: 404 });
    }),
  );
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

afterEach(() => vi.unstubAllGlobals());

const rendaVariavel = { id: 9, name: "Renda variável", color: "#8a6bbf", archived: false, class_ids: [2, 3] };

describe("Metas: categorias agrupadas", () => {
  it("mostra o subtotal do grupo como texto, sem campo para editá-lo, e as metas continuam nas categorias", async () => {
    mockApi([rendaVariavel]);
    renderSection();

    const group = await screen.findByRole("group", { name: "Grupo Renda variável" });
    expect(group).toHaveTextContent("30%");
    expect(group).toHaveTextContent("soma das metas das categorias");
    // Só as categorias têm campo; o grupo não.
    expect(within(group).getAllByRole("textbox").map((t) => t.getAttribute("aria-label"))).toEqual([
      "Meta de FII (%)",
      "Meta de Ações/ETF (%)",
    ]);
    expect(within(group).queryByRole("textbox", { name: /Grupo|Renda variável/ })).not.toBeInTheDocument();
    // A categoria fora do grupo continua solta.
    expect(within(group).queryByRole("textbox", { name: "Meta de Renda fixa (%)" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Meta de Renda fixa (%)" })).toBeEnabled();
  });

  it("o subtotal acompanha a edição de uma categoria", async () => {
    mockApi([rendaVariavel]);
    renderSection();

    const group = await screen.findByRole("group", { name: "Grupo Renda variável" });
    // Com Ações/ETF travada, os 10 p.p. a mais da FII saem da Renda fixa: o grupo passa de 30% para 40%.
    await userEvent.click(within(group).getByRole("button", { name: "Travar Ações/ETF" }));
    const fii = within(group).getByRole("textbox", { name: "Meta de FII (%)" });
    await userEvent.clear(fii);
    await userEvent.type(fii, "25{Enter}");

    expect(within(group).getByText(/soma das metas das categorias/).parentElement).toHaveTextContent("40%");
    expect(screen.getByRole("textbox", { name: "Meta de Renda fixa (%)" })).toHaveValue("60");
  });

  it("sem grupos (ou numa API sem a rota), a tela fica como era", async () => {
    mockApi(null);
    renderSection();

    expect(await screen.findByRole("textbox", { name: "Meta de FII (%)" })).toBeEnabled();
    expect(screen.queryByRole("group", { name: /Grupo/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/soma das metas das categorias/)).not.toBeInTheDocument();
  });
});
