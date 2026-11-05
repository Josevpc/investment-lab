import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentMonth } from "@/shared/lib/format";
import { unprotectedMoney } from "@/test/privacy";
import { ContributionPage } from "./ContributionPage";

// O banner de próximo passo repetiria o "Ainda falta aportar" desta tela: a página não pode montá-lo.
vi.mock("@/features/overview", () => ({ NextStepBanner: () => <aside aria-label="Próximo passo">banner</aside> }));

const ALL_HELD = "Todos os ativos de todas as categorias estão em 'manter posição'. Desmarque algum ativo para dividir o aporte.";

afterEach(() => {
  vi.unstubAllGlobals();
});

const salaryField = () => screen.getByRole("textbox", { name: /^Salário mensal \(R\$\)/ });

function renderPage(routes: Record<string, () => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const match = Object.keys(routes).find((path) => url.includes(path));
      return match ? routes[match]() : new Response(JSON.stringify({ detail: "não usado" }), { status: 404 });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ContributionPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

const earlier = {
  id: 1,
  month: "2000-01",
  salary_cents: 650_000,
  percent_bps: 1_000,
  calculated_cents: 65_000,
  final_cents: 65_000,
  overridden: false,
  reserve_cents: 0,
  mode: "rebalance",
  plan_name: "Plano padrão",
  plan: [],
  created_at: null,
};

const reserve = {
  goal_cents: 1_000_000,
  months: 6,
  monthly_cents: 0,
  balance_cents: 900_000,
  remaining_cents: 100_000,
  progress_bps: 9_000,
  reached: false,
  average_salary_cents: null,
  salaries_considered: 0,
  suggested_goal_cents: null,
  coverage_months: null,
  assets: [],
  monthly_mode: "fixed",
  percent_bps: 0,
};

describe("ContributionPage: tudo em manter posição", () => {
  it("explica que não há onde aplicar o aporte e leva aos ativos da Carteira", async () => {
    renderPage({
      "/allocation/split": json({ detail: ALL_HELD, code: "all_held" }, 422),
      "/contributions": json([]),
    });

    const alert = await screen.findByText(/Não há onde aplicar o aporte/);
    const box = alert.closest("[role=alert]") as HTMLElement;
    expect(box).toHaveTextContent(/desligue "Manter posição"/);
    expect(within(box).getByRole("link", { name: "Ir para os ativos na Carteira" })).toHaveAttribute("href", "/carteira/ativos");
    expect(box).not.toHaveTextContent(/continuam valendo/);

    // Com valor para investir, o Salvar fica desligado e diz por quê.
    await userEvent.type(salaryField(), "6500");
    const save = screen.getByRole("button", { name: "Salvar aporte" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription(
      "Todos os ativos estão em \"Manter posição\"; desmarque algum ou destine o valor à reserva.",
    );
  });
});

describe("ContributionPage: quanto investir", () => {
  it("sem salário, o Salvar fica desligado e diz o que falta", async () => {
    renderPage({ "/contributions": json([]) });

    const save = await screen.findByRole("button", { name: "Salvar aporte" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("Digite o salário para salvar.");
    expect(screen.getByText("Digite o salário para calcular o aporte.")).toBeInTheDocument();
  });

  it("num mês novo, o salário e o percentual vêm do último aporte, e a conta aparece explicada", async () => {
    renderPage({ "/contributions": json([earlier]) });

    expect(await screen.findByDisplayValue("6500,00")).toBe(salaryField());
    expect(screen.getByLabelText("Percentual (%)")).toHaveValue("10");
    expect(screen.getByText(/Preenchido com o mês anterior \(jan\/2000\)/)).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "Quanto do salário investir" });
    expect(slider).toHaveValue("1000");
    expect(slider).toHaveAttribute("aria-valuetext", "10% do salário");
    expect(document.body).toHaveTextContent(/10% de R\$\s6\.500,00/);
    expect(screen.getByRole("button", { name: "Salvar aporte" })).toBeEnabled();
  });

  it("os atalhos de percentual mudam o aporte e dizem qual está ativo", async () => {
    const user = userEvent.setup();
    renderPage({ "/contributions": json([earlier]) });

    await screen.findByDisplayValue("6500,00");
    const group = screen.getByRole("group", { name: "Atalhos de percentual" });
    expect(within(group).getByRole("button", { name: "10%" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(group).getByRole("button", { name: "20%" }));
    expect(within(group).getByRole("button", { name: "20%" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "10%" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Percentual (%)")).toHaveValue("20");
    expect(document.body).toHaveTextContent(/20% de R\$\s6\.500,00/);
  });

  it("a parte da reserva aceita % do aporte, respeita o que falta para a meta e explica a conta", async () => {
    const user = userEvent.setup();
    renderPage({ "/contributions": json([earlier]), "/reserve": json(reserve) });

    const field = await screen.findByRole("textbox", { name: /^Parte para a reserva de emergência/ });
    // 10% de R$ 6.500,00 = R$ 650,00 de aporte; a reserva só precisa de mais R$ 1.000,00.
    await user.type(field, "50%");
    expect(document.body).toHaveTextContent(/Faltam\s+R\$\s1\.000,00\s+para a meta da reserva/);
    expect(screen.getByText(/A parte da reserva não entra no rebalanceamento/)).toBeInTheDocument();
    expect(document.body).toHaveTextContent(/Sobram\s+R\$\s325,00\s+para investir/);

    await user.clear(field);
    await user.type(field, "abc");
    expect(screen.getByText(/Digite um valor como 500,00 ou uma porcentagem/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Salvar aporte" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("Corrija a parte da reserva para salvar.");
  });
});

describe("ContributionPage: reserva acima do possível", () => {
  it("avisa por escrito que 150% foi limitado ao aporte inteiro e a quanto", async () => {
    const user = userEvent.setup();
    renderPage({ "/contributions": json([earlier]), "/reserve": json({ ...reserve, goal_cents: 0, remaining_cents: 0 }) });

    const field = await screen.findByRole("textbox", { name: /^Parte para a reserva de emergência/ });
    await user.type(field, "150%");
    expect(await screen.findByRole("status")).toHaveTextContent(/foi limitado/);
    expect(document.body).toHaveTextContent(/mais do que o aporte do mês: o valor foi limitado a R\$\s650,00, o aporte inteiro/);
  });

  it("acima do que falta para a meta, diz que limitou ao que falta", async () => {
    const user = userEvent.setup();
    renderPage({ "/contributions": json([earlier]), "/reserve": json({ ...reserve, remaining_cents: 20_000 }) });

    const field = await screen.findByRole("textbox", { name: /^Parte para a reserva de emergência/ });
    await user.type(field, "50%"); // R$ 325,00, mas só faltam R$ 200,00
    expect(document.body).toHaveTextContent(/mais do que falta para a meta da reserva: o valor foi limitado a R\$\s200,00/);
  });

  describe("com reserva já registrada no mês", () => {
    // Faltam R$ 200,00 para a meta; o que já foi para a reserva neste mês volta ao limite, mas só a parte que conta na meta.
    const monthSummary = (reserveCents: number, reserveGoalCents: number) => ({
      month: currentMonth(),
      by_class: [{ class_key: "cripto", class_name: "Criptomoedas", color: "#222", amount_cents: 0, goal_cents: 0 }],
      reserve_cents: reserveCents,
      reserve_goal_cents: reserveGoalCents,
      off_goal_cents: reserveCents - reserveGoalCents,
      total_cents: reserveCents,
      proventos_cents: 0,
      redemptions_cents: 0,
      registered_cents: reserveCents,
      new_assets_cents: 0,
      new_assets: [],
    });

    it("a reserva marcada como fora da meta não volta ao limite", async () => {
      const user = userEvent.setup();
      renderPage({
        "/contributions": json([earlier]),
        "/reserve": json({ ...reserve, remaining_cents: 20_000 }),
        "/portfolio/month-summary": json(monthSummary(20_000, 0)),
      });

      const field = await screen.findByRole("textbox", { name: /^Parte para a reserva de emergência/ });
      await user.type(field, "100%"); // R$ 650,00; o limite continua os R$ 200,00 que faltam
      await waitFor(() =>
        expect(document.body).toHaveTextContent(/mais do que falta para a meta da reserva: o valor foi limitado a R\$\s200,00/),
      );
    });

    it("a reserva que conta na meta volta ao limite", async () => {
      const user = userEvent.setup();
      renderPage({
        "/contributions": json([earlier]),
        "/reserve": json({ ...reserve, remaining_cents: 20_000 }),
        "/portfolio/month-summary": json(monthSummary(20_000, 20_000)),
      });

      const field = await screen.findByRole("textbox", { name: /^Parte para a reserva de emergência/ });
      await user.type(field, "100%"); // R$ 650,00; o limite sobe para R$ 400,00 (R$ 200,00 que faltam + R$ 200,00 já na meta)
      await waitFor(() =>
        expect(document.body).toHaveTextContent(/mais do que falta para a meta da reserva: o valor foi limitado a R\$\s400,00/),
      );
    });
  });

  it("dentro do limite, não avisa nada", async () => {
    const user = userEvent.setup();
    renderPage({ "/contributions": json([earlier]), "/reserve": json(reserve) });

    const field = await screen.findByRole("textbox", { name: /^Parte para a reserva de emergência/ });
    await user.type(field, "10%");
    expect(document.body).not.toHaveTextContent(/foi limitado a/);
  });
});

describe("ContributionPage: aporte já registrado", () => {
  const month = currentMonth();
  const saved = { ...earlier, id: 2, month, salary_cents: 800_000, percent_bps: 1_000, calculated_cents: 80_000, final_cents: 80_000, reserve_cents: 20_000 };

  /** Back-end falso com estado: o PUT grava o aporte do mês e a lista passa a trazê-lo. */
  function renderStateful() {
    let list: unknown[] = [earlier];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/contributions/") && init?.method === "PUT") {
          list = [saved, earlier];
          return new Response(JSON.stringify(saved), { status: 200 });
        }
        if (url.endsWith("/contributions")) return new Response(JSON.stringify(list), { status: 200 });
        if (url.includes("/reserve")) return new Response(JSON.stringify({ ...reserve, goal_cents: 0, remaining_cents: 0 }), { status: 200 });
        return new Response(JSON.stringify({ detail: "não usado" }), { status: 404 });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ContributionPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("ao salvar, o foco vai para o aviso de sucesso, que diz o que foi feito sem expor valores fora de <Money>", async () => {
    const user = userEvent.setup();
    renderStateful();
    await screen.findByDisplayValue("6500,00");
    await user.clear(salaryField());
    await user.type(salaryField(), "8000");
    await user.click(screen.getByRole("button", { name: "Salvar aporte" }));

    const notice = await screen.findByText(/Próximo passo: faça o aporte nas instituições/);
    const status = notice.closest("[role=status]") as HTMLElement;
    expect(status).toHaveTextContent(/registrado: R\$\s800,00 \(R\$\s600,00 para investir e R\$\s200,00 para a reserva\)/);
    expect(unprotectedMoney(status)).toEqual([]);
    await waitFor(() => expect(status.parentElement).toHaveFocus());
  });

  it("'Alterar aporte' leva o foco para o campo Salário", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/contributions")
          ? new Response(JSON.stringify([saved, earlier]), { status: 200 })
          : new Response(JSON.stringify({ detail: "não usado" }), { status: 404 }),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ContributionPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "Alterar aporte" }));
    await waitFor(() => expect(salaryField()).toHaveFocus());
  });

  it("não mostra o banner de próximo passo: o botão da própria tela já é a ação principal", async () => {
    renderStateful();
    await screen.findByDisplayValue("6500,00");
    expect(screen.queryByText("banner")).not.toBeInTheDocument();
  });
});
