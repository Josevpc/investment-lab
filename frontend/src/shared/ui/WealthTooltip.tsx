import { tooltipStyle } from "@/shared/lib/chart";
import { formatDate } from "@/shared/lib/format";
import { Money } from "./primitives";

/** Uma data do gráfico de patrimônio, em centavos. `total` é o patrimônio sem o separado. */
export interface WealthTooltipRow {
  date: string;
  total: number;
  invested?: number;
  separated: number;
}

/**
 * Dica do gráfico de patrimônio. Com dinheiro separado na data, soma na mesma linha: "Patrimônio X · Separado Y · Total Z",
 * para a faixa hachurada nunca parecer parte do patrimônio investido.
 */
export function WealthTooltip({ active, payload }: { active?: boolean; payload?: readonly { payload?: WealthTooltipRow }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div style={{ ...tooltipStyle, padding: "10px 14px", maxWidth: 260 }}>
      <p className="font-medium">{formatDate(row.date)}</p>
      <p className="tabular mt-1">
        Patrimônio <Money cents={row.total} />
        {row.separated > 0 && (
          <>
            {" · Separado "}
            <Money cents={row.separated} />
            {" · Total "}
            <Money cents={row.total + row.separated} />
          </>
        )}
      </p>
      {row.invested !== undefined && (
        <p className="tabular mt-1">
          Investido <Money cents={row.invested} />
        </p>
      )}
    </div>
  );
}
