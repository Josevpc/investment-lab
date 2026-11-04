import { useNavigate } from "react-router-dom";
import { MonthClosing } from "../components/MonthClosing";
import { useAssets } from "../hooks";

/** Fechamento do mês, em etapas. Sair do fluxo volta ao resumo da carteira. */
export function ClosingTab() {
  const navigate = useNavigate();
  const assets = useAssets(false);
  return <MonthClosing assets={assets.data ?? []} onClose={() => navigate("/carteira")} />;
}
