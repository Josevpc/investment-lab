import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { buttonClass, cx } from "./primitives";
import { ChevronIcon } from "./icons";

export interface MenuItem {
  label: string;
  /** Navegação: o item vira um link. */
  to?: string;
  /** Ação que não navega. */
  onSelect?: () => void;
  disabled?: boolean;
  /** Por que o item está desabilitado, escrito ao lado (a cor sozinha não explica). */
  hint?: string;
}

const itemClass =
  "flex min-h-11 w-full flex-col justify-center rounded-field px-4 py-2 text-left text-base text-ink " +
  "hover:bg-raise aria-disabled:cursor-not-allowed aria-disabled:text-ink-3 aria-disabled:hover:bg-transparent";

/**
 * Menu de ações secundárias: um botão que abre uma lista. Setas, Home e End percorrem os itens, Esc fecha e
 * devolve o foco ao botão, e clicar fora também fecha. Para escolher entre opções de um formulário, use <Segmented>.
 */
export function Menu({ label, items, align = "right" }: { label: string; items: readonly MenuItem[]; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const entries = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (open) entries()[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    const list = entries();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown" ? (index + 1) % list.length
      : event.key === "ArrowUp" ? (index - 1 + list.length) % list.length
      : event.key === "Home" ? 0
      : event.key === "End" ? list.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    list[next]?.focus();
  }

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={buttonClass({ variant: "secondary", className: "w-full" })}
      >
        {label}
        <ChevronIcon aria-hidden className={cx("size-4 transition-transform duration-150", open ? "-rotate-90" : "rotate-90")} />
      </button>

      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          className={cx(
            "absolute top-full z-30 mt-2 w-max min-w-64 max-w-[calc(100vw-2rem)] rounded-card bg-card p-2 shadow-soft",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((item) => {
            const content = (
              <>
                <span className="font-medium">{item.label}</span>
                {item.disabled && item.hint && <span className="text-sm text-ink-3">{item.hint}</span>}
              </>
            );
            if (item.disabled) {
              return (
                <span key={item.label} role="menuitem" aria-disabled="true" tabIndex={-1} className={itemClass}>
                  {content}
                </span>
              );
            }
            if (item.to) {
              return (
                <Link key={item.label} role="menuitem" to={item.to} tabIndex={-1} className={itemClass} onClick={() => close(false)}>
                  {content}
                </Link>
              );
            }
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={itemClass}
                onClick={() => {
                  close(true);
                  item.onSelect?.();
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
