import { Money } from "./primitives";

/**
 * Ativo antigo cadastrado no período entra como aporte nas contas de acumulado (patrimônio menos
 * aportes dá a valorização). Sem esta frase, o valor inicial pareceria dinheiro novo ou rendimento.
 */
export function NewAssetsNote({ cents, className }: { cents: number; className?: string }) {
  if (cents <= 0) return null;
  return (
    <p className={className ?? "text-sm text-slate-600 dark:text-slate-300"}>
      Inclui <Money cents={cents} /> de ativos antigos trazidos para o app no período: entram como aporte aqui para não parecerem valorização.
    </p>
  );
}
