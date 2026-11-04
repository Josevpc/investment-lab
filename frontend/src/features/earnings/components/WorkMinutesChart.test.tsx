import { render as plainRender, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { month } from "../testData";
import { WorkMinutesChart } from "./WorkMinutesChart";

// O gráfico depende de medidas de tela que o jsdom não tem; a tabela cobre os mesmos números.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

// O gráfico tem um link (registrar o salário): precisa de um roteador.
const render = (ui: React.ReactElement) => plainRender(<MemoryRouter>{ui}</MemoryRouter>);

const ok = { has_update: true, salary_share_bps: 900 };

const months = [
  month({ month: "2026-07", has_update: false, earned_cents: 0 }),
  month({ month: "2026-08", ...ok, earned_cents: 25_000, work_minutes: 110 }),
  month({ month: "2026-09", ...ok, earned_cents: 45_000, work_minutes: 224 }),
  month({ month: "2026-10", ...ok, earned_cents: 30_000, work_minutes: 792, partial: true, through: "2026-10-24", measured_through: "2026-10-20" }),
];

const open = () => within(screen.getByRole("group", { name: "Tabela dos minutos de trabalho por mês" }));

describe("Gráfico: minutos de trabalho por mês", () => {
  it("tem título, período e uma frase que explica a conta", () => {
    render(<WorkMinutesChart months={months} />);

    expect(screen.getByRole("heading", { name: "Minutos que seu dinheiro trabalhou por mês" })).toBeInTheDocument();
    expect(screen.getByText(/Últimos 4 meses/)).toBeInTheDocument();
    expect(screen.getByText(/jornada de 220 h por mês/)).toBeInTheDocument();
  });

  it("descreve o gráfico em texto para leitores de tela", () => {
    render(<WorkMinutesChart months={months} />);

    const chart = screen.getByRole("img", { name: /Gráfico de colunas/ });
    expect(chart).toHaveAccessibleName(/ago\/2026: 110 min/);
    expect(chart).toHaveAccessibleName(/set\/2026: 224 min/);
    expect(chart).toHaveAccessibleName(/out\/2026 \(até 20\/10\): 792 min/);
  });

  it("a tabela traz todos os meses: minutos, tempo por extenso, quanto rendeu e a situação", () => {
    render(<WorkMinutesChart months={months} />);

    const table = open().getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1); // sem o cabeçalho
    expect(rows).toHaveLength(4);
    const september = within(table).getByRole("row", { name: /set\/2026/ });
    expect(september).toHaveTextContent("224 min");
    expect(september).toHaveTextContent("3 h 44 min");
    expect(september).toHaveTextContent(/R\$\s*450,00/);
    expect(within(table).getByRole("row", { name: /out\/2026/ })).toHaveTextContent("792 min");
  });

  it("mês sem barra diz o motivo em vez de aparecer como zero", () => {
    render(<WorkMinutesChart months={months} />);

    const july = within(open().getByRole("table")).getByRole("row", { name: /jul\/2026/ });
    expect(july).toHaveTextContent("sem atualização de saldo");
    expect(july).not.toHaveTextContent("0 min");
  });

  it("explica a barra clara do mês em andamento, com o dia até onde vale", () => {
    render(<WorkMinutesChart months={months} />);
    expect(screen.getByText(/Barra clara: mês em andamento, até 20\/10/)).toBeInTheDocument();
  });

  it("avisa que os meses sem barra não puderam ser medidos, e onde ver o motivo", () => {
    render(<WorkMinutesChart months={months} />);
    expect(screen.getByText(/Meses sem barra não puderam ser medidos/)).toBeInTheDocument();
  });

  it("sem meses vazios, não há o que explicar", () => {
    render(<WorkMinutesChart months={months.filter((m) => m.has_update)} />);
    expect(screen.queryByText(/Meses sem barra/)).not.toBeInTheDocument();
  });

  it("diz a unidade do eixo vertical", () => {
    render(<WorkMinutesChart months={months} />);
    expect(screen.getByText("minutos de trabalho")).toBeInTheDocument();
  });

  it("sem nenhum mês com ganho e salário, orienta o que fazer e não desenha gráfico", () => {
    render(<WorkMinutesChart months={[month({ month: "2026-10", has_update: false, earned_cents: 0, partial: true })]} />);

    expect(screen.getByText(/Ainda não há mês com ganho para mostrar/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registrar o salário no aporte do mês" })).toHaveAttribute("href", "/aporte");
    expect(screen.queryByRole("img", { name: /Gráfico de colunas/ })).not.toBeInTheDocument();
  });

  it("sem meses, não aparece", () => {
    const { container } = render(<WorkMinutesChart months={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
