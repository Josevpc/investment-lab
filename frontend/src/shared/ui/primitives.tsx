import type { ComponentProps } from "react";
import { Link } from "react-router-dom";
import { formatBRL } from "@/shared/lib/format";

/*
 * Peças que os outros componentes de shared/ui usam por dentro (cx, botão, valor em reais). Ficam num arquivo
 * próprio, e não em index.tsx, para Dialog, PebbleBar, Menu etc. não importarem do index que os reexporta (ciclo).
 * Quem está fora de shared/ui continua importando tudo de "@/shared/ui".
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Valor em reais. Com "ocultar valores" ligado, o CSS desfoca o elemento (ver index.css). */
export function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={cx("tabular money", className)}>{formatBRL(cents)}</span>;
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "md" | "sm";

const variants: Record<ButtonVariant, string> = {
  // A ação principal é tinta (não mel): o mel fica para meta e foco.
  primary: "bg-ink text-card hover:bg-ink-2",
  secondary: "bg-raise text-ink hover:bg-soil",
  danger: "bg-clay text-card hover:bg-clay/85",
  ghost: "text-ink-2 hover:bg-raise",
};

const sizes: Record<ButtonSize, string> = {
  md: "min-h-12 px-6 text-base",
  sm: "min-h-10 px-4 text-sm",
};

/** Classes do botão em pílula. Compartilhadas por <Button> e <ButtonLink> para os dois ficarem idênticos. */
export function buttonClass({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors duration-150 " +
      "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type="button" {...props} className={buttonClass({ variant, size, className })} />;
}

/** Link com cara de botão (navegação). Para ações que mudam dados, use <Button>. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link {...props} className={buttonClass({ variant, size, className })} />;
}
