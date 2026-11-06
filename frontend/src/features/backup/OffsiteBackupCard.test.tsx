import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OffsiteBackupCard } from "./OffsiteBackupCard";
import type { OffsiteCopyResult, OffsiteStatus } from "./types";

const FOLDER = "G:\\Meu Drive\\Investment Lab Backup";

const status = (overrides: Partial<OffsiteStatus> = {}): OffsiteStatus => ({
  folder: FOLDER,
  folder_available: true,
  same_drive: false,
  last_copy_at: "2026-11-03T14:30:00",
  last_copy_file: "investment-2026-11-03.db",
  days_since_last_copy: 2,
  stale: false,
  ...overrides,
});

const NO_FOLDER = status({ folder: null, last_copy_at: null, last_copy_file: null, days_since_last_copy: null, stale: true });

const copyResult: OffsiteCopyResult = {
  file: `${FOLDER}\\investment-2026-11-05.db`,
  size_bytes: 40960,
  copied_at: "2026-11-05T09:10:00",
  kept: 4,
};

const json = (body: unknown, httpStatus = 200) => new Response(JSON.stringify(body), { status: httpStatus });

interface Server {
  current: OffsiteStatus;
  /** Resposta do POST /backup/offsite/copy; por padrão, sucesso. */
  copy?: () => Promise<Response>;
  /** Resposta do PUT /backup/offsite; por padrão, aceita e grava a pasta. */
  put?: (folder: string | null) => Promise<Response>;
  statusError?: boolean;
  calls: { url: string; method: string; body?: unknown }[];
}

function mockApi(initial: OffsiteStatus, extra: Partial<Server> = {}): Server {
  const server: Server = { current: initial, calls: [], ...extra };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      server.calls.push({ url, method, body });
      if (!url.endsWith("/backup/offsite") && !url.endsWith("/backup/offsite/copy")) return json({}, 404);
      if (url.endsWith("/backup/offsite/copy")) return server.copy ? server.copy() : json(copyResult);
      if (method === "PUT") {
        if (server.put) return server.put(body.folder);
        server.current = { ...server.current, folder: body.folder, folder_available: true };
        return json(server.current);
      }
      if (server.statusError) return json({ detail: "Falhou." }, 500);
      return json(server.current);
    }),
  );
  return server;
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OffsiteBackupCard />
    </QueryClientProvider>,
  );
}

const copyButton = () => screen.getByRole("button", { name: /Copiar agora|Copiando/ });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Cópia fora deste computador: sem pasta", () => {
  it("explica o porquê, mostra o exemplo só como dica e não oferece copiar", async () => {
    mockApi(NO_FOLDER);
    renderCard();

    expect(await screen.findByText(/O banco de dados só existe neste disco, e o Git não o guarda/)).toBeInTheDocument();
    expect(screen.getByText("não definida")).toBeInTheDocument();
    expect(screen.getByText("nenhuma ainda")).toBeInTheDocument();
    expect(screen.getByText("Sem cópia")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Caminho da pasta" });
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", FOLDER);
    expect(input).toHaveAccessibleDescription(/Exemplo: G:\\Meu Drive\\Investment Lab Backup/);
    expect(screen.queryByRole("button", { name: "Copiar agora" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desligar" })).not.toBeInTheDocument();
  });

  it("Salvar pasta fica desligado, com o motivo, até haver um caminho", async () => {
    const user = userEvent.setup();
    mockApi(NO_FOLDER);
    renderCard();

    const save = await screen.findByRole("button", { name: "Salvar pasta" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("Digite o caminho da pasta para poder salvar.");
    await user.type(screen.getByRole("textbox", { name: "Caminho da pasta" }), "   ");
    expect(save).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Caminho da pasta" }), "D:\\Backup");
    expect(save).toBeEnabled();
  });

  it("salva sem as aspas do 'Copiar como caminho' e diz o que fazer a seguir", async () => {
    const user = userEvent.setup();
    const server = mockApi(NO_FOLDER);
    renderCard();

    await user.type(await screen.findByRole("textbox", { name: "Caminho da pasta" }), '"D:\\Backup"');
    await user.click(screen.getByRole("button", { name: "Salvar pasta" }));

    const done = await screen.findByText(/Pasta salva: D:\\Backup\./);
    expect(done).toHaveTextContent("Ainda não há cópia nesta pasta. Faça uma cópia agora.");
    // O aviso fixo diria a mesma coisa: fica de fora enquanto a mensagem de sucesso está na tela.
    expect(screen.queryByText(/ainda não fez nenhuma cópia/)).not.toBeInTheDocument();
    expect(server.calls.find((c) => c.method === "PUT")?.body).toEqual({ folder: "D:\\Backup" });
    expect(within(screen.getByRole("status")).getByText(/Pasta salva/)).toBeInTheDocument();
    // Com a pasta definida, o formulário vira resumo e aparece a ação principal.
    expect(await screen.findByRole("button", { name: "Copiar agora" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Caminho da pasta" })).not.toBeInTheDocument();
  });

  it.each([
    ["folder_not_found", /Não encontrei essa pasta e não consegui criá-la/],
    ["folder_not_absolute", /Informe o caminho completo da pasta, começando pela letra da unidade/],
    ["folder_not_writable", /Não consigo gravar nessa pasta/],
    ["folder_inside_data", /dentro da pasta de dados do app/],
  ])("erro %s: mostra o que fazer ao lado do campo e mantém o que foi digitado", async (code, message) => {
    const user = userEvent.setup();
    mockApi(NO_FOLDER, { put: async () => json({ detail: "texto técnico", code }, 422) });
    renderCard();

    const input = await screen.findByRole("textbox", { name: "Caminho da pasta" });
    await user.type(input, "X:\\Nada");
    await user.click(screen.getByRole("button", { name: "Salvar pasta" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(input).toHaveValue("X:\\Nada");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("texto técnico")).not.toBeInTheDocument();
  });
});

describe("Cópia fora deste computador: com pasta", () => {
  it("em dia: mostra pasta, data e hora, idade e situação por palavra e ícone", async () => {
    mockApi(status());
    renderCard();

    expect(await screen.findByText(FOLDER)).toBeInTheDocument();
    expect(screen.getByText("03/11/2026 14:30 (há 2 dias)")).toBeInTheDocument();
    expect(screen.getByText("Em dia")).toBeInTheDocument();
    expect(screen.queryByText(/A última cópia foi feita/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Não consegui acessar a pasta/)).not.toBeInTheDocument();
    expect(copyButton()).toHaveTextContent("Copiar agora");
  });

  it("desatualizada: avisa a idade da cópia e deixa Copiar agora em destaque", async () => {
    mockApi(status({ stale: true, days_since_last_copy: 9, last_copy_at: "2026-10-27T08:00:00" }));
    renderCard();

    expect(await screen.findByText("Desatualizada")).toBeInTheDocument();
    expect(screen.getByText(/A última cópia foi feita há 9 dias\./)).toBeInTheDocument();
    expect(screen.getByText("27/10/2026 08:00 (há 9 dias)")).toBeInTheDocument();
    // Em destaque = botão principal (tinta sólida), não o secundário.
    expect(copyButton().className).toContain("bg-ink");
    expect(copyButton().className).not.toContain("bg-raise");
  });

  it("pasta definida mas sem nenhuma cópia: convida a fazer a primeira", async () => {
    mockApi(status({ last_copy_at: null, last_copy_file: null, days_since_last_copy: null, stale: true }));
    renderCard();

    expect(await screen.findByText("Sem cópia")).toBeInTheDocument();
    expect(screen.getByText(/ainda não fez nenhuma cópia fora deste computador/)).toBeInTheDocument();
    expect(screen.getByText("nenhuma ainda")).toBeInTheDocument();
  });

  it("copiando: o botão diz Copiando… e fica desabilitado; o sucesso diz o que foi feito e quando copiar de novo", async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => {};
    const server = mockApi(status(), { copy: () => new Promise<Response>((resolve) => (release = resolve)) });
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Copiar agora" }));
    // aria-disabled (e não disabled): o botão continua focável, então o teclado não perde o lugar.
    const busy = await screen.findByRole("button", { name: "Copiando…" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).not.toBeDisabled();
    await user.click(busy);

    // O que a API devolve depois da cópia: a situação é relida.
    server.current = status({ last_copy_at: "2026-11-05T09:10:00", days_since_last_copy: 0 });
    release(json(copyResult));

    const done = await screen.findByText(/Cópia gravada em/);
    expect(done).toHaveTextContent(`Cópia gravada em ${FOLDER} (investment-2026-11-05.db).`);
    expect(done).toHaveTextContent("A próxima é recomendada até 12/11/2026.");
    expect(done).toHaveTextContent("guarda as 4 cópias mais recentes");
    expect(screen.getByRole("status")).toContainElement(done);
    expect(await screen.findByText("05/11/2026 09:10 (hoje)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar agora" })).not.toHaveAttribute("aria-disabled");
    // O clique no botão ocupado não dispara uma segunda cópia.
    expect(server.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("copy_failed: diz que nada foi gravado e que a última cópia continua válida", async () => {
    const user = userEvent.setup();
    mockApi(status(), { copy: async () => json({ detail: "boom", code: "copy_failed" }, 500) });
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Copiar agora" }));

    const message = await screen.findByText(/A cópia não foi gravada/);
    expect(message).toHaveTextContent("A última cópia continua válida");
    expect(screen.getByRole("status")).toContainElement(message);
    expect(screen.queryByText(/Cópia gravada em/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar agora" })).toBeEnabled();
  });

  it("no_folder (409): manda definir a pasta antes", async () => {
    const user = userEvent.setup();
    mockApi(status(), { copy: async () => json({ detail: "sem pasta", code: "no_folder" }, 409) });
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Copiar agora" }));

    expect(await screen.findByText(/Ainda não há uma pasta definida/)).toBeInTheDocument();
  });

  it("folder_unavailable ao copiar: avisa que não acessou a pasta e oferece trocá-la", async () => {
    const user = userEvent.setup();
    mockApi(status(), { copy: async () => json({ detail: "x", code: "folder_unavailable" }, 422) });
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Copiar agora" }));

    const warning = await screen.findByText(/Não consegui acessar a pasta\./);
    expect(warning.closest("p")).toHaveTextContent("Se for pendrive ou Drive, confira se está conectado.");
    await user.click(screen.getByRole("button", { name: "Alterar pasta" }));
    expect(screen.getByRole("textbox", { name: "Caminho da pasta" })).toHaveValue(FOLDER);
  });

  it("pasta indisponível já na consulta: aviso, e ainda dá para tentar copiar ou trocar a pasta", async () => {
    mockApi(status({ folder_available: false }));
    renderCard();

    expect(await screen.findByText(/Não consegui acessar a pasta\./)).toBeInTheDocument();
    // O selo concorda com o aviso: não diz "Em dia" com a pasta fora do ar.
    expect(screen.getByText("Sem acesso à pasta")).toBeInTheDocument();
    expect(screen.queryByText("Em dia")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alterar pasta" })).toBeEnabled();
    expect(copyButton()).toBeEnabled();
  });

  it("pasta que some na hora de copiar também troca o selo 'Em dia' por 'Sem acesso à pasta'", async () => {
    const user = userEvent.setup();
    mockApi(status(), { copy: async () => json({ detail: "x", code: "folder_unavailable" }, 422) });
    renderCard();

    expect(await screen.findByText("Em dia")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copiar agora" }));
    expect(await screen.findByText("Sem acesso à pasta")).toBeInTheDocument();
    expect(screen.queryByText("Em dia")).not.toBeInTheDocument();
  });

  it("caminho longo sem espaços não alarga as mensagens (quebra em qualquer ponto)", async () => {
    const user = userEvent.setup();
    const longFolder = "G:\\" + "Pasta-muito-comprida-".repeat(10) + "Backup";
    const server = mockApi(status({ folder: longFolder }), {
      copy: async () => json({ ...copyResult, file: `${longFolder}\\investment-2026-11-05.db` }),
    });
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Copiar agora" }));
    const done = await screen.findByText(/Cópia gravada em/);
    expect(done.className).toContain("[overflow-wrap:anywhere]");
    expect(done).toHaveTextContent(longFolder);
    expect(server.calls.some((c) => c.method === "POST")).toBe(true);
  });

  it("mesma unidade do banco: avisa que isso não protege contra falha do disco", async () => {
    mockApi(status({ same_drive: true }));
    renderCard();

    const warning = await screen.findByText(/Esta pasta está no mesmo disco do banco\./);
    expect(warning.closest("p")).toHaveTextContent("não protege contra falha do disco");
  });
});

describe("Cópia fora deste computador: trocar e desligar", () => {
  it("Alterar pasta abre o campo com a pasta atual e Cancelar volta ao resumo sem gravar", async () => {
    const user = userEvent.setup();
    const server = mockApi(status());
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Alterar pasta" }));
    const save = screen.getByRole("button", { name: "Salvar pasta" });
    expect(screen.getByRole("textbox", { name: "Caminho da pasta" })).toHaveValue(FOLDER);
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("Este já é o caminho salvo.");

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("textbox", { name: "Caminho da pasta" })).not.toBeInTheDocument();
    expect(server.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("Desligar pede confirmação que diz o efeito; Cancelar não muda nada", async () => {
    const user = userEvent.setup();
    const server = mockApi(status());
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Desligar" }));

    const dialog = screen.getByRole("alertdialog", { name: "Desligar a cópia fora deste computador?" });
    expect(dialog).toHaveAccessibleDescription(
      `O app deixa de avisar sobre cópias. As cópias já gravadas continuam na pasta ${FOLDER}, mas este cartão passa a mostrar “Sem cópia”.`,
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(server.calls.some((c) => c.method === "PUT")).toBe(false);
    expect(screen.getByText(FOLDER)).toBeInTheDocument();
  });

  it("confirmar manda folder null e diz que as cópias já gravadas continuam na pasta", async () => {
    const user = userEvent.setup();
    const server = mockApi(status());
    server.put = async () => {
      server.current = NO_FOLDER;
      return json(NO_FOLDER);
    };
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Desligar" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Sim, desligar" }));

    const done = await screen.findByText(/Cópia fora do computador desligada/);
    expect(done).toHaveTextContent(`As cópias já gravadas continuam em ${FOLDER}, mas o cartão agora mostra “Sem cópia”.`);
    expect(server.calls.find((c) => c.method === "PUT")?.body).toEqual({ folder: null });
    // Volta ao estado "sem pasta": campo vazio, sem Copiar agora e a situação "Sem cópia".
    expect(await screen.findByRole("textbox", { name: "Caminho da pasta" })).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Copiar agora" })).not.toBeInTheDocument();
    expect(screen.getByText("Sem cópia")).toBeInTheDocument();
  });

  it("trocar de pasta diz que ainda não há cópia nela, sem repetir o aviso fixo", async () => {
    const user = userEvent.setup();
    const server = mockApi(status());
    server.put = async (folder) => {
      server.current = status({ folder, last_copy_at: null, last_copy_file: null, days_since_last_copy: null, stale: true });
      return json(server.current);
    };
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Alterar pasta" }));
    const input = screen.getByRole("textbox", { name: "Caminho da pasta" });
    await user.clear(input);
    await user.type(input, "D:\\Outra");
    await user.click(screen.getByRole("button", { name: "Salvar pasta" }));

    const done = await screen.findByText(/Pasta salva: D:\\Outra\./);
    expect(done).toHaveTextContent("Ainda não há cópia nesta pasta. Faça uma cópia agora.");
    expect(screen.getAllByText(/Ainda não há cópia nesta pasta/)).toHaveLength(1);
    expect(screen.queryByText(/ainda não fez nenhuma cópia/)).not.toBeInTheDocument();
    expect(await screen.findByText("Sem cópia")).toBeInTheDocument();
  });
});

describe("Cópia fora deste computador: foco do teclado", () => {
  it("Alterar pasta leva o foco ao campo; Cancelar devolve o foco a Alterar pasta", async () => {
    const user = userEvent.setup();
    mockApi(status());
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Alterar pasta" }));
    expect(screen.getByRole("textbox", { name: "Caminho da pasta" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("button", { name: "Alterar pasta" })).toHaveFocus();
  });

  it("na carga da página o foco não é puxado para o campo da pasta", async () => {
    mockApi(NO_FOLDER);
    renderCard();

    await screen.findByRole("textbox", { name: "Caminho da pasta" });
    expect(screen.getByRole("textbox", { name: "Caminho da pasta" })).not.toHaveFocus();
  });

  it("Salvar pasta mantém o foco enquanto envia e, ao sucesso, leva a Copiar agora", async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => {};
    const server = mockApi(status());
    server.put = (folder) =>
      new Promise<Response>((resolve) => {
        release = resolve;
        server.current = status({ folder });
      });
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Alterar pasta" }));
    await user.clear(screen.getByRole("textbox", { name: "Caminho da pasta" }));
    await user.type(screen.getByRole("textbox", { name: "Caminho da pasta" }), "D:\\Outra");
    await user.click(screen.getByRole("button", { name: "Salvar pasta" }));

    const busy = await screen.findByRole("button", { name: "Salvando…" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveFocus();

    release(json(server.current));
    await screen.findByText(/Pasta salva: D:\\Outra\./);
    await waitFor(() => expect(screen.getByRole("button", { name: "Copiar agora" })).toHaveFocus());
  });

  it("Copiar agora mantém o foco durante e depois da cópia", async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => {};
    mockApi(status(), { copy: () => new Promise<Response>((resolve) => (release = resolve)) });
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Copiar agora" }));
    expect(await screen.findByRole("button", { name: "Copiando…" })).toHaveFocus();
    release(json(copyResult));
    await screen.findByText(/Cópia gravada em/);
    expect(screen.getByRole("button", { name: "Copiar agora" })).toHaveFocus();
  });

  it("depois de Desligar confirmado, o foco vai para o campo da pasta", async () => {
    const user = userEvent.setup();
    const server = mockApi(status());
    server.put = async () => {
      server.current = NO_FOLDER;
      return json(NO_FOLDER);
    };
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Desligar" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Sim, desligar" }));

    await screen.findByText(/Cópia fora do computador desligada/);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Caminho da pasta" })).toHaveFocus());
  });
});

describe("Cópia fora deste computador: carregando e erro", () => {
  it("enquanto consulta, mostra o carregando; se falhar, mostra o erro e deixa tentar de novo", async () => {
    const user = userEvent.setup();
    const server = mockApi(status(), { statusError: true });
    renderCard();

    expect(screen.getByText("Carregando a situação da cópia...")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Falhou.");

    server.statusError = false;
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText(FOLDER)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
