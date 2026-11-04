import { useRef, useState, type ChangeEvent } from "react";
import { BASE_URL } from "@/shared/lib/api";
import { formatDate } from "@/shared/lib/format";
import { Button, Card, ErrorBox, Field, inputClass, Notice } from "@/shared/ui";
import { RESET_CONFIRMATION, useInspectBackup, useResetData, useRestoreBackup } from "./hooks";
import type { BackupFile, BackupInspection, DataChangeResult } from "./types";

const TABLE_LABELS: Record<string, string> = {
  asset: "ativos",
  asset_valuation: "valores registrados",
  asset_movement: "movimentos",
  snapshot: "fechamentos",
  contribution: "aportes do mês",
  asset_class: "categorias",
  allocation_plan: "planos de alocação",
  institution: "instituições",
};

function summarize(counts: Record<string, number>): string[] {
  return Object.entries(TABLE_LABELS)
    .filter(([key]) => (counts[key] ?? 0) > 0)
    .map(([key, label]) => `${counts[key]} ${label}`);
}

function Result({ result, what, next }: { result: DataChangeResult; what: string; next?: string }) {
  const safety = result.safety_backup?.split(/[\\/]/).pop();
  return (
    <p
      role="status"
      className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
    >
      {what}
      {safety && (
        <>
          {" "}
          Uma cópia dos dados anteriores foi guardada em <code className="text-xs">data/backups/{safety}</code>.
        </>
      )}
      {next && <> {next}</>}
    </p>
  );
}

function RestoreSection() {
  const inspect = useInspectBackup();
  const restore = useRestoreBackup();
  const input = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<BackupFile | null>(null);
  const [fileName, setFileName] = useState("");
  const [readError, setReadError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const info: BackupInspection | undefined = inspect.data;

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    restore.reset();
    setConfirmed(false);
    setBackup(null);
    setReadError(null);
    inspect.reset();
    if (!file) return;
    setFileName(file.name);
    try {
      const parsed = JSON.parse(await file.text()) as BackupFile;
      setBackup(parsed);
      inspect.mutate(parsed);
    } catch {
      setReadError("Este arquivo não é um backup válido do Investment Lab (não consegui ler o conteúdo).");
    }
  }

  const restorable = Boolean(info?.valid && info.compatible);
  // Revisão diferente da atual, mas aceita pela API: o back-end converte o arquivo ao restaurar.
  const converting =
    restorable && (info?.needs_conversion ?? (Boolean(info?.schema_revision) && info?.schema_revision !== info?.current_revision));
  const canRestore = Boolean(backup && restorable && confirmed && !restore.isPending);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Restaurar de um arquivo</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Escolha um backup exportado antes. Você vê o resumo do arquivo e confirma antes de qualquer mudança.
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        aria-label="Arquivo de backup"
        onChange={onFile}
        className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium dark:text-slate-300 dark:file:border-slate-700 dark:file:bg-slate-900"
      />
      {readError && <ErrorBox error={readError} />}
      <ErrorBox error={inspect.error} />

      {info && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
          <p className="font-medium">{fileName}</p>
          <ul className="space-y-1 text-slate-600 dark:text-slate-400">
            <li>
              Gerado em: <strong>{info.exported_at ? formatDate(info.exported_at.slice(0, 10)) : "data desconhecida"}</strong>
            </li>
            <li>Conteúdo: {summarize(info.counts).join(", ") || "vazio"}</li>
            {info.snapshots_from && info.snapshots_to && (
              <li>
                Fechamentos de {formatDate(info.snapshots_from)} a {formatDate(info.snapshots_to)}
              </li>
            )}
          </ul>
          {info.problems.length > 0 && !restorable && (
            <Notice tone="warn">
              <strong>Este arquivo não pode ser restaurado:</strong> {info.problems.join(" ")}
            </Notice>
          )}
          {restorable && (
            <>
              {/* Com o arquivo restaurável, o que vem em `problems` é aviso (ex.: backup de versão anterior), não bloqueio. */}
              {info.problems.length > 0 && (
                <Notice tone="warn">
                  <strong>Antes de restaurar:</strong> {info.problems.join(" ")}
                </Notice>
              )}
              {converting && (
                <Notice>
                  Este backup é de uma versão anterior do app. Ao restaurar, o app <strong>converte o arquivo</strong> para a versão atual.
                  Uma cópia dos seus dados de hoje é guardada antes de qualquer mudança e, se der erro, nada muda: seus dados atuais
                  continuam como estão.
                </Notice>
              )}
              <Notice tone="warn">
                Restaurar <strong>substitui todos os dados atuais</strong> pelo conteúdo do arquivo. Antes disso, uma cópia dos dados de
                hoje é guardada automaticamente.
              </Notice>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="size-4 accent-blue-500"
                />
                {converting
                  ? "Entendo que os dados atuais serão substituídos pelo conteúdo deste backup, convertido para a versão atual"
                  : "Entendo que os dados atuais serão substituídos"}
              </label>
              <Button
                variant="danger"
                disabled={!canRestore}
                onClick={() => backup && restore.mutate(backup, { onSuccess: () => setConfirmed(false) })}
              >
                {restore.isPending ? "Restaurando…" : "Restaurar este backup"}
              </Button>
            </>
          )}
        </div>
      )}
      <ErrorBox error={restore.error} />
      {restore.error && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Nada foi alterado: seus dados atuais continuam como estavam. Corrija o problema ou escolha outro arquivo.
        </p>
      )}
      {restore.data && (
        <Result
          result={restore.data}
          next="Confira a Carteira e o Histórico para ver se está tudo como esperava."
          what={
            restore.data.converted_from_revision
              ? `Backup restaurado. Ele era da versão ${restore.data.converted_from_revision} e foi convertido para a versão atual do app.`
              : "Backup restaurado."
          }
        />
      )}
    </div>
  );
}

function ResetSection() {
  const reset = useResetData();
  const [word, setWord] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3 rounded-xl border border-red-200 p-4 dark:border-red-900/60">
      <div>
        <h3 className="text-sm font-semibold text-red-700 dark:text-red-300">Apagar todos os dados</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Remove ativos, histórico, aportes e movimentos e volta ao ponto de partida (categorias e plano padrão). Uma cópia é guardada antes.
          Exporte um backup primeiro se quiser poder voltar atrás.
        </p>
      </div>
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Quero apagar os dados…
        </Button>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            reset.mutate(word, {
              onSuccess: () => {
                setWord("");
                setOpen(false);
              },
            });
          }}
        >
          <Field label={`Digite ${RESET_CONFIRMATION} para confirmar`} className="w-64">
            <input className={inputClass} value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit" variant="danger" disabled={word !== RESET_CONFIRMATION || reset.isPending}>
            Apagar tudo
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
              setWord("");
            }}
          >
            Cancelar
          </Button>
        </form>
      )}
      <ErrorBox error={reset.error} />
      {reset.data && <Result result={reset.data} what="Dados apagados." />}
    </div>
  );
}

/** Exportar, restaurar e reiniciar os dados, com resumo e confirmação antes de qualquer mudança. */
export function BackupCard() {
  return (
    <Card title="Backup e dados">
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold">Exportar backup</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Baixa um arquivo com tudo o que está no app (ativos, histórico, aportes, planos e reserva). Guarde-o fora deste computador.
          </p>
          <a
            href={`${BASE_URL}/backup/export`}
            download
            className="mt-3 inline-flex items-center justify-center rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-blue-700 dark:bg-blue-400 dark:text-slate-950 dark:hover:bg-blue-300"
          >
            Exportar backup
          </a>
        </div>
        <hr className="border-slate-200 dark:border-slate-800" />
        <RestoreSection />
        <hr className="border-slate-200 dark:border-slate-800" />
        <ResetSection />
      </div>
    </Card>
  );
}
