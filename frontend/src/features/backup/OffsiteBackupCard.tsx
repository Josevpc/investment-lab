import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { formatDate, formatDateTime } from "@/shared/lib/format";
import { Badge, Button, Card, ErrorBox, Loading, Notice, useConfirm, inputClass, type NoticeTone } from "@/shared/ui";
import { CheckIcon, CloseIcon } from "@/shared/ui/icons";
import { useCopyOffsite, useOffsiteStatus, useSaveOffsiteFolder } from "./hooks";
import {
  baseName,
  formatDaysAgo,
  nextCopyDue,
  normalizeFolder,
  offsiteErrorCode,
  offsiteErrorMessage,
  offsiteSituation,
  SITUATION_LABEL,
  type OffsiteSituation,
} from "./lib/offsite";
import type { OffsiteStatus } from "./types";

/** Só um exemplo do formato: não é valor padrão, cada pessoa tem a sua pasta. */
const FOLDER_EXAMPLE = "G:\\Meu Drive\\Investment Lab Backup";

interface Feedback {
  tone: NoticeTone;
  text: string;
  /** A mensagem já diz que ainda não há cópia: o aviso fixo equivalente fica de fora enquanto ela estiver na tela. */
  coversNoCopy?: boolean;
}

/** Para onde o foco vai quando o elemento onde ele estava sai da tela (formulário que fecha, botão que vira campo). */
type FocusTarget = "field" | "change" | "copy";

const BADGE_TONE: Record<OffsiteSituation, "good" | "gold" | "warn"> = {
  ok: "good",
  stale: "gold",
  none: "warn",
  unavailable: "warn",
};

function SituationBadge({ situation }: { situation: OffsiteSituation }) {
  // Ícone e palavra junto com a cor: a situação nunca depende só do tom.
  return (
    <Badge tone={BADGE_TONE[situation]}>
      {situation === "ok" ? (
        <CheckIcon className="mr-1 size-3.5" />
      ) : situation === "stale" || situation === "unavailable" ? (
        <span aria-hidden className="mr-1 font-bold">
          !
        </span>
      ) : (
        <CloseIcon className="mr-1 size-3.5" />
      )}
      {SITUATION_LABEL[situation]}
    </Badge>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium sm:max-w-[70%]">{children}</dd>
    </div>
  );
}

function FolderForm({
  initial,
  canCancel,
  error,
  pending,
  inputRef,
  onSave,
  onCancel,
}: {
  initial: string;
  canCancel: boolean;
  error: string | null;
  pending: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onSave: (folder: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const inputId = useId();
  const hintId = useId();
  const reasonId = useId();
  const folder = normalizeFolder(draft);
  const reason = folder === "" ? "Digite o caminho da pasta para poder salvar." : folder === initial ? "Este já é o caminho salvo." : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason && !pending) onSave(folder);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink-2">
          Caminho da pasta
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className={inputClass}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={FOLDER_EXAMPLE}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={hintId}
          aria-invalid={error ? true : undefined}
        />
        <p id={hintId} className="mt-1.5 text-xs text-ink-3">
          Exemplo: {FOLDER_EXAMPLE}. Escolha uma pasta de outro disco, de um pendrive ou sincronizada com a nuvem (Drive, OneDrive). Se a
          pasta não existir, o app a cria, desde que a pasta de cima exista.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {/* Enquanto envia, aria-disabled (e não disabled) para o botão manter o foco do teclado. */}
        <Button
          type="submit"
          size="sm"
          disabled={Boolean(reason)}
          aria-disabled={pending || undefined}
          aria-describedby={reason ? reasonId : undefined}
        >
          {pending ? "Salvando…" : "Salvar pasta"}
        </Button>
        {canCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        {reason && (
          <span id={reasonId} className="text-xs text-ink-3">
            {reason}
          </span>
        )}
      </div>
      <div aria-live="polite">{error && <Notice tone="warn">{error}</Notice>}</div>
    </form>
  );
}

/** O que a pessoa precisa saber e fazer, na ordem: situação, aviso do que está errado, copiar agora, e só então a pasta. */
function Body({ status }: { status: OffsiteStatus }) {
  const save = useSaveOffsiteFolder();
  const copy = useCopyOffsite();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // A pasta pode sumir entre uma consulta e outra (pendrive solto): o aviso vale até a próxima tentativa de copiar ou de salvar.
  const [lostOnCopy, setLostOnCopy] = useState(false);
  // Elementos que somem quando o formulário abre ou fecha levam o foco junto para o <body>; este efeito o devolve.
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!focusTarget) return;
    const element = { field: fieldRef, change: changeRef, copy: copyRef }[focusTarget].current;
    if (!element) return; // O elemento ainda não existe (ex.: a pasta acabou de ser salva): tenta na próxima renderização.
    element.focus();
    setFocusTarget(null);
  });

  const hasFolder = status.folder !== null;
  const situation = offsiteSituation(status, lostOnCopy);
  const unavailable = hasFolder && (!status.folder_available || lostOnCopy);
  const showForm = !hasFolder || editing;

  function copyNow() {
    if (copy.isPending) return; // aria-disabled não bloqueia o clique sozinho.
    setFeedback(null);
    setLostOnCopy(false);
    const folder = status.folder ?? "";
    copy.mutate(undefined, {
      onSuccess: (result) =>
        setFeedback({
          tone: "success",
          text:
            `Cópia gravada em ${folder} (${baseName(result.file)}). A próxima é recomendada até ${formatDate(nextCopyDue(result.copied_at))}.` +
            (result.kept > 1 ? ` O app guarda as ${result.kept} cópias mais recentes nessa pasta.` : ""),
        }),
      onError: (error) => {
        if (offsiteErrorCode(error) === "folder_unavailable") setLostOnCopy(true);
        else setFeedback({ tone: "warn", text: offsiteErrorMessage(error) });
      },
    });
  }

  function saveFolder(folder: string) {
    if (save.isPending) return;
    setFormError(null);
    setFeedback(null);
    save.mutate(folder, {
      onSuccess: (saved) => {
        setEditing(false);
        setLostOnCopy(false);
        copy.reset();
        // A cópia de antes pertencia à outra pasta: aqui, em geral, ainda não há nenhuma.
        const noCopyYet = saved.last_copy_at === null;
        setFeedback({
          tone: "success",
          text: `Pasta salva: ${folder}.` + (noCopyYet ? " Ainda não há cópia nesta pasta. Faça uma cópia agora." : ""),
          coversNoCopy: noCopyYet,
        });
        setFocusTarget("copy"); // A próxima ação é copiar, como a mensagem diz.
      },
      onError: (error) => setFormError(offsiteErrorMessage(error)),
    });
  }

  async function turnOff() {
    if (save.isPending || !status.folder) return;
    const old = status.folder;
    const ok = await confirm({
      title: "Desligar a cópia fora deste computador?",
      message: (
        <>
          O app deixa de avisar sobre cópias. As cópias já gravadas continuam na pasta <span className="break-all font-medium">{old}</span>,
          mas este cartão passa a mostrar “Sem cópia”.
        </>
      ),
      confirmLabel: "Sim, desligar",
      tone: "primary",
    });
    if (!ok) return;
    setFeedback(null);
    save.mutate(null, {
      onSuccess: () => {
        setEditing(false);
        setLostOnCopy(false);
        setFeedback({
          tone: "success",
          text: `Cópia fora do computador desligada. As cópias já gravadas continuam em ${old}, mas o cartão agora mostra “Sem cópia”. Para voltar a receber avisos, informe uma pasta.`,
        });
        setFocusTarget("field");
      },
      onError: (error) => setFeedback({ tone: "warn", text: offsiteErrorMessage(error) }),
    });
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="text-ink-2">
        {hasFolder
          ? "Uma cópia do banco numa pasta fora deste disco protege seu histórico se o computador falhar. Copie pelo menos uma vez por semana."
          : "O banco de dados só existe neste disco, e o Git não o guarda: se o disco falhar, o histórico se perde. Escolha uma pasta sincronizada com a nuvem (Drive, OneDrive) ou um pendrive para guardar uma cópia."}
      </p>

      <dl className="space-y-1.5">
        <Row label="Pasta da cópia">{status.folder ?? <span className="text-ink-3">não definida</span>}</Row>
        <Row label="Última cópia">
          {status.last_copy_at ? (
            <span className="tabular">
              {formatDateTime(status.last_copy_at)}
              {status.days_since_last_copy !== null && ` (${formatDaysAgo(status.days_since_last_copy)})`}
            </span>
          ) : (
            <span className="text-ink-3">nenhuma ainda</span>
          )}
        </Row>
        <Row label="Situação">
          <SituationBadge situation={situation} />
        </Row>
      </dl>

      {/* Regiões sempre presentes: leitores de tela anunciam o aviso quando o texto entra (ex.: pendrive que sumiu na hora de copiar). */}
      <div aria-live="polite" className="space-y-4 empty:hidden">
        {unavailable && (
          <Notice tone="warn">
            <strong>Não consegui acessar a pasta.</strong> Se for pendrive ou Drive, confira se está conectado. Depois tente copiar de novo,
            ou use <strong>Alterar pasta</strong> para escolher outra.
          </Notice>
        )}
        {hasFolder && !unavailable && status.same_drive && (
          <Notice tone="attention">
            <strong>Esta pasta está no mesmo disco do banco.</strong> Isso não protege contra falha do disco: se ele quebrar, o banco e a
            cópia se perdem juntos. Prefira uma pasta de outro disco, de um pendrive ou sincronizada com a nuvem.
          </Notice>
        )}
        {hasFolder && !status.last_copy_at && !feedback?.coversNoCopy && (
          <Notice tone="attention">Você ainda não fez nenhuma cópia fora deste computador. Use Copiar agora para fazer a primeira.</Notice>
        )}
        {hasFolder && status.last_copy_at && status.stale && status.days_since_last_copy !== null && (
          <Notice tone="attention">
            <strong>A última cópia foi feita {formatDaysAgo(status.days_since_last_copy)}.</strong> Copie agora para não perder o que
            mudou desde então.
          </Notice>
        )}
      </div>

      {hasFolder && (
        <div>
          {/* aria-disabled (e não disabled) durante a cópia: o botão mantém o foco do teclado. */}
          <Button
            ref={copyRef}
            variant={situation === "ok" ? "secondary" : "primary"}
            aria-disabled={copy.isPending || undefined}
            onClick={copyNow}
          >
            {copy.isPending ? "Copiando…" : "Copiar agora"}
          </Button>
        </div>
      )}

      <div role="status" aria-live="polite">
        {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}
      </div>

      <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <h3 className="text-sm font-semibold">Onde guardar a cópia</h3>
        {showForm ? (
          <FolderForm
            // Reinicia o campo ao abrir de novo, partindo da pasta salva.
            key={status.folder ?? "nova"}
            initial={status.folder ?? ""}
            canCancel={hasFolder}
            error={formError}
            pending={save.isPending}
            inputRef={fieldRef}
            onSave={saveFolder}
            onCancel={() => {
              setEditing(false);
              setFormError(null);
              setFocusTarget("change");
            }}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              ref={changeRef}
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditing(true);
                setFocusTarget("field");
              }}
            >
              Alterar pasta
            </Button>
            <Button size="sm" variant="ghost" aria-disabled={save.isPending || undefined} onClick={turnOff}>
              Desligar
            </Button>
          </div>
        )}
      </div>
      {dialog}
    </div>
  );
}

/** Garante que existe uma cópia do banco fora deste disco. A ação principal é "Copiar agora"; a pasta é configuração. */
export function OffsiteBackupCard() {
  const status = useOffsiteStatus();
  return (
    <Card title="Cópia fora deste computador">
      {status.isLoading && <Loading label="Carregando a situação da cópia..." />}
      {status.error && (
        <div className="space-y-3">
          <ErrorBox error={status.error} />
          <Button size="sm" variant="secondary" onClick={() => status.refetch()}>
            Tentar de novo
          </Button>
        </div>
      )}
      {status.data && <Body status={status.data} />}
    </Card>
  );
}
