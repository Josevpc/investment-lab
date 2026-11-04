import { useEffect } from "react";
import { useSystemStatus } from "@/features/system";
import { celebrate } from "@/shared/lib/celebrate";
import { useEarnings } from "../hooks";
import { CELEBRATED_DEMO_KEY, CELEBRATED_KEY, readCelebrated, writeCelebrated } from "../lib/celebrated";
import { hasEarningsData, milestonesToCelebrate } from "../lib/earnings";

/**
 * Montado uma vez no Layout: quando os dados de rendimento recarregam (depois de atualizar saldos ou
 * registrar um provento, em qualquer tela), comemora o marco novo. Não desenha nada.
 */
export function EarningsCelebrator() {
  const earnings = useEarnings();
  const status = useSystemStatus();
  const data = earnings.data;
  const demo = status.data?.demo === true;
  const statusReady = !status.isLoading;

  useEffect(() => {
    // Espera saber se é demonstração, para lembrar na chave certa.
    if (!statusReady || !hasEarningsData(data)) return;
    const key = demo ? CELEBRATED_DEMO_KEY : CELEBRATED_KEY;
    const result = milestonesToCelebrate(data, readCelebrated(key));
    if (result.changed) writeCelebrated(key, result.seen);
    if (result.celebration) celebrate(result.celebration);
  }, [data, demo, statusReady]);

  return null;
}
