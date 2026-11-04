import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "./primitives";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Diálogos abertos, do mais antigo ao mais novo: só o de cima reage a Esc e a Tab (ex.: confirmação sobre um painel). */
const openModals: RefObject<HTMLElement | null>[] = [];

/**
 * Comportamento de qualquer janela modal: foco entra nela (em `[data-autofocus]`, se houver), Tab não
 * escapa dela, Esc fecha e, ao fechar, o foco volta para quem a abriu.
 */
export function useModalBehavior(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openModals.push(ref);

    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0] ?? ref.current;
    first?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== ref) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      const inside = ref.current?.contains(active) && active !== ref.current;
      if (event.shiftKey && (!inside || active === items[0])) {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (!event.shiftKey && (!inside || active === items[items.length - 1])) {
        event.preventDefault();
        items[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      openModals.splice(openModals.indexOf(ref), 1);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [ref]);
}

/**
 * Janela central sobre a tela. Vai para o <body> porque cartões com transformação (a entrada animada)
 * viram referência de `position: fixed` e deslocariam o diálogo.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  role = "dialog",
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  role?: "dialog" | "alertdialog";
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useModalBehavior(panel, onClose);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-[var(--scrim)]" />
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className="rise relative max-h-full w-full max-w-md overflow-y-auto rounded-card bg-card p-6 shadow-soft sm:p-8"
      >
        <h2 id={titleId} className="font-serif text-xl sm:text-section">
          {title}
        </h2>
        {description && (
          <div id={descriptionId} className="mt-3 text-base text-ink-2">
            {description}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmação que diz o efeito da ação. O foco começa em "Cancelar": o caminho seguro é o padrão. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancelar",
  tone = "danger",
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog title={title} description={message} onClose={onCancel} role="alertdialog">
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" data-autofocus onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant={tone} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * Separa um texto no formato "Pergunta? Efeito." em título e mensagem do diálogo. Os textos das telas
 * já dizem o efeito da ação nesse formato; sem "? ", tudo vira título.
 */
export function splitQuestion(text: string): { title: string; message?: string } {
  const at = text.indexOf("? ");
  if (at === -1) return { title: text };
  return { title: text.slice(0, at + 1), message: text.slice(at + 2) };
}

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
}

/**
 * Substituto do `window.confirm`: `await confirm({...})` devolve true ou false e `dialog` precisa
 * ser desenhado pelo componente. Não exige provedor, então cada tela decide quando e como perguntar.
 */
export function useConfirm() {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ options, resolve })),
    [],
  );

  const answer = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const dialog = pending ? (
    <ConfirmDialog {...pending.options} onConfirm={() => answer(true)} onCancel={() => answer(false)} />
  ) : null;

  return { confirm, dialog };
}
