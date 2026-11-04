import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { CashAccountPage } from "@/features/cash/CashAccountPage";
import { CashAccountsPage } from "@/features/cash/CashAccountsPage";
import { ContributionPage } from "@/features/contributions/ContributionPage";
import { OverviewPage } from "@/features/overview/OverviewPage";
import { PortfolioLayout } from "@/features/portfolio/PortfolioLayout";
import { AssetsTab } from "@/features/portfolio/tabs/AssetsTab";
import { ClosingTab } from "@/features/portfolio/tabs/ClosingTab";
import { MovementsTab } from "@/features/portfolio/tabs/MovementsTab";
import { QuickUpdateTab } from "@/features/portfolio/tabs/QuickUpdateTab";
import { SummaryTab } from "@/features/portfolio/tabs/SummaryTab";
import { WithdrawalsTab } from "@/features/portfolio/tabs/WithdrawalsTab";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { Loading } from "@/shared/ui";
import { Layout } from "./Layout";
import { PreferencesProvider } from "@/shared/lib/preferences";

// Histórico e trajetória carregam a biblioteca de gráficos; ficam em chunks separados.
const TrajectoryPage = lazy(() => import("@/features/analytics/TrajectoryPage").then((m) => ({ default: m.TrajectoryPage })));
const HistoryPage = lazy(() => import("@/features/history/HistoryPage").then((m) => ({ default: m.HistoryPage })));
const GoalsPage = lazy(() => import("@/features/goals/GoalsPage").then((m) => ({ default: m.GoalsPage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <PreferencesProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<OverviewPage />} />
                <Route path="aporte" element={<ContributionPage />} />
                <Route path="carteira" element={<PortfolioLayout />}>
                  <Route index element={<SummaryTab />} />
                  <Route path="ativos" element={<AssetsTab />} />
                  <Route path="movimentacoes" element={<MovementsTab />} />
                  <Route path="retiradas" element={<WithdrawalsTab />} />
                  <Route path="atualizar" element={<QuickUpdateTab />} />
                  <Route path="fechamento" element={<ClosingTab />} />
                  <Route path="contas" element={<CashAccountsPage />} />
                  <Route path="contas/:id" element={<CashAccountPage />} />
                </Route>
                <Route path="historico" element={<HistoryPage />} />
                <Route path="trajetoria" element={<TrajectoryPage />} />
                <Route path="metas" element={<GoalsPage />} />
                <Route path="configuracoes" element={<SettingsPage />} />

                {/* Endereços da versão anterior continuam funcionando. */}
                <Route path="portfolio" element={<Navigate to="/carteira" replace />} />
                <Route path="history" element={<Navigate to="/historico" replace />} />
                <Route path="trajectory" element={<Navigate to="/trajetoria" replace />} />
                <Route path="allocation" element={<Navigate to="/configuracoes#planos" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </QueryClientProvider>
    </PreferencesProvider>
  );
}
