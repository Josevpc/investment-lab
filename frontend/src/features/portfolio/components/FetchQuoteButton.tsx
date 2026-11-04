import { useState } from "react";
import { cx } from "@/shared/ui";
import { portfolioApi } from "../api";

/**
 * Busca a cotação atual de uma cripto (Binance, pelo ticker) e entrega o texto para o campo de cotação.
 * Só consulta quando a pessoa clica; se falhar, o campo continua como estava e ela digita à mão.
 */
export function FetchQuoteButton({
  ticker,
  assetName,
  onQuote,
  className,
}: {
  ticker: string;
  assetName: string;
  onQuote: (price: string) => void;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchQuote() {
    setPending(true);
    setError(null);
    try {
      const quote = await portfolioApi.cryptoQuote(ticker);
      // Vírgula decimal: "2.224" sem ela seria lido como milhar (2.224 = 2224).
      onQuote(quote.price.replace(".", ","));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível buscar a cotação.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className={cx("inline-flex flex-col", className)}>
      <button
        type="button"
        disabled={pending}
        aria-label={`Buscar cotação de ${assetName}`}
        onClick={fetchQuote}
        className="text-left text-xs font-medium text-blue-700 hover:underline disabled:opacity-50 dark:text-blue-300"
      >
        {pending ? "Buscando…" : `Buscar cotação (${ticker.toUpperCase()})`}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error} Digite a cotação à mão.
        </span>
      )}
    </span>
  );
}
