import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetGroup } from "@/features/groups";
import type { AssetClass } from "../types";
import { CategoriesCard } from "./CategoriesCard";

const cls = (id: number, key: string, name: string, group_id: number | null = null): AssetClass => ({
  id,
  key,
  name,
  color: "#5aa88a",
  archived: false,
  group_id,
});

const group = (id: number, name: string, class_ids: number[], archived = false): AssetGroup => ({ id, name, color: "#8a6bbf", archived, class_ids });

interface Call {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

/** API em memória: grava o que o app manda e responde com o estado novo. */
function mockApi(initial: { classes: AssetClass[]; groups: AssetGroup[]; createStatus?: number }) {
  const state = { classes: [...initial.classes], groups: [...initial.groups] };
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      calls.push({ method, url, body });
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

      if (url.includes("/asset-groups") && method === "GET") {
        const all = url.includes("include_archived=1");
        return json(state.groups.filter((g) => all || !g.archived));
      }
      if (url.endsWith("/asset-groups") && method === "POST") {
        if (initial.createStatus === 409) return json({ detail: "Já existe um grupo com esse nome." }, 409);
        const created = group(state.groups.length + 10, String(body?.name), []);
        state.groups.push(created);
        return json(created, 201);
      }
      const putGroup = url.match(/\/asset-groups\/(\d+)$/);
      if (putGroup && method === "PUT") {
        const found = state.groups.find((g) => g.id === Number(putGroup[1]))!;
        Object.assign(found, body);
        if (body?.archived === true) {
          state.classes = state.classes.map((c) => (c.group_id === found.id ? { ...c, group_id: null } : c));
          found.class_ids = [];
        }
        return json(found);
      }
      const putClass = url.match(/\/asset-classes\/(\d+)$/);
      if (putClass && method === "PUT") {
        const found = state.classes.find((c) => c.id === Number(putClass[1]))!;
        if (body && "group_id" in body) {
          found.group_id = body.group_id as number | null;
          state.groups.forEach((g) => {
            g.class_ids = state.classes.filter((c) => c.group_id === g.id).map((c) => c.id);
          });
        }
        return json(found);
      }
      if (url.includes("/asset-classes") && method === "GET") return json(state.classes);
      return json({ detail: "não usado" }, 404);
    }),
  );
  return calls;
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CategoriesCard />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

const categories = [cls(1, "renda_fixa", "Renda fixa"), cls(2, "fii", "FII"), cls(3, "acoes", "Ações/ETF")];

describe("Grupos de categorias: criar", () => {
  it("sem grupos, convida a criar e não mostra escolha de grupo nas categorias", async () => {
    mockApi({ classes: categories, groups: [] });
    renderCard();

    expect(await screen.findByText(/Nenhum grupo ainda/)).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Nome de FII" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Grupo de/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Um grupo junta categorias/)).toBeInTheDocument();
  });

  it("cria o grupo e diz o que foi feito e o que fazer em seguida; a escolha de grupo aparece nas categorias", async () => {
    const calls = mockApi({ classes: categories, groups: [] });
    renderCard();

    const field = await screen.findByRole("textbox", { name: "Nome do novo grupo" });
    const button = screen.getByRole("button", { name: "Criar grupo" });
    expect(button).toBeDisabled();

    await userEvent.type(field, "Renda variável");
    await userEvent.click(button);

    expect(await screen.findByRole("status")).toHaveTextContent("Grupo Renda variável criado. Agora escolha as categorias que fazem parte dele.");
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/asset-groups"))?.body).toEqual({ name: "Renda variável", color: "#5e8a57" });
    expect(field).toHaveValue("");
    // Com um grupo, cada categoria ganha a escolha de grupo (nenhum por padrão).
    expect(await screen.findByRole("combobox", { name: "Grupo de FII" })).toHaveValue("");
  });

  it("não deixa criar um grupo com nome repetido e diz o motivo", async () => {
    mockApi({ classes: categories, groups: [group(9, "Renda variável", [])] });
    renderCard();

    await screen.findByRole("textbox", { name: "Nome do grupo Renda variável" });
    const field = screen.getByRole("textbox", { name: "Nome do novo grupo" });
    await userEvent.type(field, " renda VARIÁVEL ");

    expect(screen.getByRole("button", { name: "Criar grupo" })).toBeDisabled();
    expect(field).toHaveAccessibleDescription(/Já existe um grupo com esse nome/);
  });

  it("nome de um grupo arquivado: explica e oferece Restaurar, que devolve o grupo", async () => {
    const calls = mockApi({ classes: categories, groups: [group(9, "Renda variável", [], true)] });
    renderCard();

    const field = await screen.findByRole("textbox", { name: "Nome do novo grupo" });
    await userEvent.type(field, "Renda variável");

    expect(screen.getByRole("button", { name: "Criar grupo" })).toBeDisabled();
    expect(field).toHaveAccessibleDescription(/já é de um grupo arquivado/);
    await userEvent.click(screen.getByRole("button", { name: "Restaurar o grupo Renda variável" }));

    expect(calls.find((c) => c.method === "PUT" && c.url.endsWith("/asset-groups/9"))?.body).toEqual({ archived: false });
    expect(await screen.findByRole("status")).toHaveTextContent("Grupo Renda variável restaurado, ainda sem categorias.");
    expect(field).toHaveValue("");
  });

  it("mostra o erro da API quando o nome repete no servidor", async () => {
    mockApi({ classes: categories, groups: [], createStatus: 409 });
    renderCard();

    await userEvent.type(await screen.findByRole("textbox", { name: "Nome do novo grupo" }), "Outro");
    await userEvent.click(screen.getByRole("button", { name: "Criar grupo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Já existe um grupo com esse nome.");
  });
});

describe("Grupos de categorias: escolher o grupo de cada categoria", () => {
  it("coloca a categoria no grupo, diz o efeito e permite tirar de novo", async () => {
    const calls = mockApi({ classes: categories, groups: [group(9, "Renda variável", [])] });
    renderCard();

    const select = await screen.findByRole("combobox", { name: "Grupo de FII" });
    expect(select).toHaveValue("");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Sem grupo", "Renda variável"]);

    await userEvent.selectOptions(select, "Renda variável");
    const put = calls.find((c) => c.method === "PUT" && c.url.endsWith("/asset-classes/2"));
    expect(put?.body).toEqual({ name: "FII", color: "#5aa88a", archived: false, group_id: 9 });
    expect(await screen.findByText(/FII agora faz parte de Renda variável/)).toBeInTheDocument();
    // A lista de membros do grupo acompanha.
    expect(await screen.findByText(/1 categoria: FII\./)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Grupo de FII" }), "Sem grupo");
    const removal = calls.filter((c) => c.method === "PUT" && c.url.endsWith("/asset-classes/2")).at(-1);
    expect(removal?.body).toMatchObject({ group_id: null });
    expect(await screen.findByText(/FII saiu do grupo Renda variável e volta a aparecer solta/)).toBeInTheDocument();

    // Uma nova ação limpa o aviso anterior.
    await userEvent.type(screen.getByRole("textbox", { name: "Nome da nova categoria" }), "Ouro{Enter}");
    expect(screen.queryByText(/FII saiu do grupo/)).not.toBeInTheDocument();
  });
});

describe("Grupos de categorias: arquivar", () => {
  const withMembers = () => ({
    classes: [cls(1, "renda_fixa", "Renda fixa"), cls(2, "fii", "FII", 9), cls(3, "acoes", "Ações/ETF", 9)],
    groups: [group(9, "Renda variável", [2, 3])],
  });

  it("pede confirmação que descreve o efeito e só arquiva depois", async () => {
    const calls = mockApi(withMembers());
    renderCard();

    await userEvent.click(await screen.findByRole("button", { name: "Arquivar o grupo Renda variável" }));
    const confirm = screen.getByRole("group", { name: "Confirmar o arquivamento de Renda variável" });
    expect(confirm).toHaveTextContent("FII, Ações/ETF ficam sem grupo");
    expect(confirm).toHaveTextContent("Nada some da carteira, dos saldos nem do histórico");
    expect(calls.some((c) => c.method === "PUT" && c.url.includes("/asset-groups/"))).toBe(false);

    await userEvent.click(within(confirm).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("group", { name: /Confirmar o arquivamento/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Arquivar o grupo Renda variável" }));
    await userEvent.click(within(screen.getByRole("group", { name: /Confirmar o arquivamento/ })).getByRole("button", { name: "Arquivar grupo" }));

    expect(calls.find((c) => c.method === "PUT" && c.url.endsWith("/asset-groups/9"))?.body).toEqual({ archived: true });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Grupo Renda variável arquivado. 2 categorias ficaram sem grupo; nada saiu da carteira nem do histórico.",
    );
    expect(await screen.findByText(/Arquivados \(1\)/)).toBeInTheDocument();
  });

  it("renomeia o grupo e confirma o que mudou", async () => {
    const calls = mockApi(withMembers());
    renderCard();

    const name = await screen.findByRole("textbox", { name: "Nome do grupo Renda variável" });
    expect(screen.queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();
    await userEvent.clear(name);
    await userEvent.type(name, "Bolsa");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(calls.find((c) => c.method === "PUT" && c.url.endsWith("/asset-groups/9"))?.body).toEqual({ name: "Bolsa", color: "#8a6bbf" });
    expect(await screen.findByRole("status")).toHaveTextContent("Grupo salvo como Bolsa.");
  });
});
