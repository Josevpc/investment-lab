import { useReserve } from "@/features/reserve";
import { MoneyText } from "@/shared/ui/MoneyText";
import { redemptionDoneParts, type ReserveSnapshot } from "../lib/redemption";
import type { Asset } from "../types";
import type { RedemptionDone } from "./RedemptionForm";

/**
 * Confirmação do resgate: diz o que foi feito e o que vem a seguir. Se o ativo é da reserva, mostra quanto ela
 * ficou abaixo da meta (só depois que a reserva é recarregada, para não mostrar o número de antes do resgate).
 */
export function RedemptionNotice({ done, asset }: { done: RedemptionDone; asset: Asset | undefined }) {
  const onReserve = asset?.purpose === "reserva";
  const reserve = useReserve();
  const r = reserve.data;
  const snapshot: ReserveSnapshot | null =
    onReserve && r && !reserve.isFetching && typeof r.goal_cents === "number"
      ? { goal_cents: r.goal_cents, balance_cents: r.balance_cents, remaining_cents: r.remaining_cents, reached: r.reached }
      : null;
  const { movement } = done;

  return (
    <p role="status" className="mb-3 text-sm text-slate-700 dark:text-slate-300">
      <MoneyText
        parts={redemptionDoneParts({
          assetName: movement.asset_name,
          amountCents: movement.amount_cents,
          date: movement.date,
          alreadyInBalance: done.alreadyInBalance,
          creditedAccount: done.creditedAccount,
          onReserve,
          reserve: snapshot,
        })}
      />
    </p>
  );
}
