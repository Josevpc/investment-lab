import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { isValidMonth } from "@/shared/lib/format";
import { MovementsCard, type MovementForm } from "../components/MovementsCard";

const FORMS: Record<string, MovementForm> = { aporte: "aporte", provento: "provento", transferencia: "transfer", resgate: "resgate" };

/**
 * Aportes, proventos, resgates e transferências. "Novo aporte", "Registrar provento" e "Usei a reserva" (`?novo=resgate&ativo=ID`)
 * chegam aqui já com o formulário aberto.
 */
export function MovementsTab() {
  const [params, setParams] = useSearchParams();
  const requested = FORMS[params.get("novo") ?? ""] ?? null;

  const handled = useCallback(() => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("novo");
        next.delete("ativo");
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  const month = params.get("mes") ?? "";
  const assetParam = Number(params.get("ativo"));
  return (
    <MovementsCard
      requestedForm={requested}
      requestedAssetId={Number.isInteger(assetParam) && assetParam > 0 ? assetParam : null}
      onRequestHandled={handled}
      initialMonth={isValidMonth(month) ? month : undefined}
    />
  );
}
