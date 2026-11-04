import { ErrorBox, Loading } from "@/shared/ui";
import { QuickUpdate } from "../components/QuickUpdate";
import { useAssets } from "../hooks";

/** Atualização rápida dos saldos (a rotina semanal). O fechamento do mês é outra rota. */
export function QuickUpdateTab() {
  const assets = useAssets(false);
  if (assets.isLoading) return <Loading />;
  if (assets.error) return <ErrorBox error={assets.error} />;
  return <QuickUpdate assets={assets.data ?? []} />;
}
