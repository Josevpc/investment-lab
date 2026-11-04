import { useId } from "react";
import { Link } from "react-router-dom";
import { cx } from "@/shared/ui";
import { joinNames } from "../lib/messages";
import type { HeldAsset, HoldStatus } from "../types";

interface HeldClass {
  class_key: string;
  class_name: string;
  hold_status: HoldStatus;
  held_assets: HeldAsset[];
}

/**
 * Aviso somente leitura das categorias com ativos mantidos. A marca "Manter posição" fica no cadastro
 * do ativo, então daqui só se aponta para a Carteira. Some quando nada está mantido.
 */
export function HeldAssetsNotice({ items, className }: { items: readonly HeldClass[]; className?: string }) {
  const titleId = useId();
  const withHeld = items.filter((i) => i.hold_status !== "none" && i.held_assets.length > 0);
  if (withHeld.length === 0) return null;

  return (
    <section
      aria-labelledby={titleId}
      className={cx(
        "rounded-field bg-raise px-4 py-3 text-sm text-ink-2",
        className,
      )}
    >
      <h3 id={titleId} className="font-medium text-ink">
        Ativos mantidos (não recebem novos aportes)
      </h3>
      <ul className="mt-1 space-y-1">
        {withHeld.map((item) => {
          const names = joinNames(item.held_assets.map((a) => a.name));
          return (
            <li key={item.class_key}>
              <strong className="font-medium">{item.class_name}:</strong>{" "}
              {item.hold_status === "all"
                ? `todos os ativos mantidos (${names}). Mantida: meta suspensa; a categoria fica sem aporte e as metas das outras são ajustadas na divisão.`
                : `${names} ${item.held_assets.length === 1 ? "mantido" : "mantidos"}. A meta continua valendo; o aporte da categoria vai para os outros ativos.`}{" "}
              <Link
                to={`/carteira/ativos?categoria=${encodeURIComponent(item.class_key)}`}
                className="font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink"
              >
                Ver ativos de {item.class_name} na Carteira
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-sm text-ink-3">
        Para mudar, edite o ativo na Carteira e ligue ou desligue "Manter posição".
      </p>
    </section>
  );
}
