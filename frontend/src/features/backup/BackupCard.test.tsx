import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupCard } from "./BackupCard";
import type { BackupInspection } from "./types";

const inspection = (overrides: Partial<BackupInspection> = {}): BackupInspection => ({
  valid: true,
  compatible: true,
  problems: [],
  exported_at: "2026-09-30T12:00:00",
  schema_revision: "0010",
  current_revision: "0010",
  counts: { asset: 3, snapshot: 2 },
  snapshots_from: "2026-01-31",
  snapshots_to: "2026-09-30",
  ...overrides,
});

function mockApi(info: BackupInspection, restoreResponse?: () => Promise<Response>) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/backup/inspect")) return new Response(JSON.stringify(info), { status: 200 });
      if (url.endsWith("/backup/restore")) {
        if (restoreResponse) return restoreResponse();
        const converted = info.schema_revision !== info.current_revision ? info.schema_revision : null;
        return new Response(
          JSON.stringify({ safety_backup: "data/backups/antes.db", counts: {}, converted_from_revision: converted }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    }),
  );
  return calls;
}

async function chooseFile(user: ReturnType<typeof userEvent.setup>) {
  const content = JSON.stringify({ app: "investment-lab", format_version: 1, schema_revision: "0009", exported_at: "", tables: {} });
  const file = new File([content], "backup.json", { type: "application/json" });
  // O jsdom pode não implementar File.text(); o componente só precisa do texto.
  Object.defineProperty(file, "text", { value: async () => content });
  await user.upload(screen.getByLabelText("Arquivo de backup"), file);
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BackupCard />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Backup: restaurar de um arquivo", () => {
  it("backup da versão atual: confirmação simples, sem aviso de conversão", async () => {
    const user = userEvent.setup();
    mockApi(inspection());
    renderCard();
    await chooseFile(user);

    expect(await screen.findByText(/substitui todos os dados atuais/)).toBeInTheDocument();
    expect(screen.queryByText(/converte o arquivo/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Restaurar este backup" }));
    const done = await screen.findByText(/Backup restaurado\./);
    expect(done).not.toHaveTextContent("convertido");
    expect(screen.getByRole("checkbox", { name: "Entendo que os dados atuais serão substituídos" })).toBeInTheDocument();
  });

  it("backup de versão anterior: mostra o aviso da API e explica a conversão antes de confirmar", async () => {
    const user = userEvent.setup();
    const calls = mockApi(
      inspection({
        schema_revision: "0009",
        needs_conversion: true,
        problems: ["Este backup é da versão 0009 e será convertido para a atual (0010) ao restaurar. Os dados atuais são copiados para um arquivo de segurança antes."],
      }),
    );
    renderCard();
    await chooseFile(user);

    expect(await screen.findByText(/Este backup é da versão 0009 e será convertido para a atual/)).toBeInTheDocument();
    expect(screen.queryByText(/não pode ser restaurado/)).not.toBeInTheDocument();
    const explanation = screen.getByText(/converte o arquivo/).closest("p")!;
    expect(explanation).toHaveTextContent("cópia dos seus dados de hoje é guardada antes");
    expect(explanation).toHaveTextContent("se der erro, nada muda");

    const restore = screen.getByRole("button", { name: "Restaurar este backup" });
    expect(restore).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /convertido para a versão atual/ }));
    expect(restore).toBeEnabled();
    await user.click(restore);

    expect(await screen.findByText(/Backup restaurado. Ele era da versão 0009 e foi convertido para a versão atual do app/)).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/backup/restore") && c.method === "POST")).toBe(true);
  });

  it("sem needs_conversion, a revisão diferente da atual também dispara a explicação de conversão", async () => {
    const user = userEvent.setup();
    mockApi(inspection({ schema_revision: "0009" }));
    renderCard();
    await chooseFile(user);

    expect(await screen.findByText(/converte o arquivo/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /convertido para a versão atual/ })).toBeInTheDocument();
  });

  it("needs_conversion falso vence a comparação de revisões", async () => {
    const user = userEvent.setup();
    mockApi(inspection({ schema_revision: "0009", needs_conversion: false }));
    renderCard();
    await chooseFile(user);

    expect(await screen.findByText(/substitui todos os dados atuais/)).toBeInTheDocument();
    expect(screen.queryByText(/converte o arquivo/)).not.toBeInTheDocument();
  });

  it("durante a restauração o botão diz Restaurando… e o sucesso diz o que fazer a seguir", async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => {};
    mockApi(inspection(), () => new Promise<Response>((resolve) => (release = resolve)));
    renderCard();
    await chooseFile(user);

    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Restaurar este backup" }));
    expect(await screen.findByRole("button", { name: "Restaurando…" })).toBeDisabled();

    release(new Response(JSON.stringify({ safety_backup: "data/backups/antes.db", counts: {} }), { status: 200 }));
    const done = await screen.findByRole("status");
    expect(done).toHaveTextContent("Backup restaurado.");
    expect(done).toHaveTextContent("Uma cópia dos dados anteriores foi guardada em data/backups/antes.db");
    expect(done).toHaveTextContent("Confira a Carteira e o Histórico");
  });

  it("se a conversão falhar (422), mostra o motivo e garante que nada foi alterado", async () => {
    const user = userEvent.setup();
    mockApi(inspection({ schema_revision: "0009", needs_conversion: true }), async () =>
      new Response(JSON.stringify({ detail: "Não foi possível converter o backup: tabela de ativos incompleta." }), { status: 422 }),
    );
    renderCard();
    await chooseFile(user);

    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Restaurar este backup" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível converter o backup: tabela de ativos incompleta.");
    expect(screen.getByText(/Nada foi alterado: seus dados atuais continuam como estavam/)).toBeInTheDocument();
    expect(screen.queryByText(/Backup restaurado/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restaurar este backup" })).toBeEnabled();
  });

  it("arquivo recusado pela API (versão desconhecida ou posterior): mostra o motivo e não oferece restaurar", async () => {
    const user = userEvent.setup();
    mockApi(
      inspection({ compatible: false, schema_revision: "9999", problems: ["Este backup é de uma versão mais nova que a do app."] }),
    );
    renderCard();
    await chooseFile(user);

    expect(await screen.findByText("Este arquivo não pode ser restaurado:")).toBeInTheDocument();
    expect(screen.getByText(/versão mais nova que a do app/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restaurar este backup" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("checkbox")).not.toBeInTheDocument());
  });
});
