import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aporteHighlight, fetchGoalsProgress } from "@/features/goals";
import { celebrate } from "@/shared/lib/celebrate";
import { formatBRL } from "@/shared/lib/format";
import { portfolioApi } from "./api";
import { createdText, updateInputFrom } from "./lib/newInvestment";
import type {
  Asset,
  AssetClassInput,
  AssetCreateInput,
  AssetUpdateInput,
  BalanceInput,
  Movement,
  MovementKind,
  MovementUpdateInput,
  ProventoInput,
  PurchaseInput,
  RedemptionInput,
  TransferInput,
  ValuationUpdateInput,
} from "./types";

export function useAssetClasses(includeArchived = false) {
  return useQuery({
    queryKey: ["portfolio", "classes", includeArchived],
    queryFn: () => portfolioApi.classes(includeArchived),
  });
}

export function useInstitutions() {
  return useQuery({ queryKey: ["portfolio", "institutions"], queryFn: portfolioApi.institutions });
}

export function useAssets(includeArchived = false) {
  return useQuery({
    queryKey: ["portfolio", "assets", includeArchived],
    queryFn: () => portfolioApi.assets(includeArchived),
  });
}

export function usePortfolioSummary() {
  return useQuery({ queryKey: ["portfolio", "summary"], queryFn: portfolioApi.summary });
}

export function useMovements(filters: { month?: string; kind?: MovementKind } = {}) {
  return useQuery({
    queryKey: ["portfolio", "movements", filters.month ?? "all", filters.kind ?? "all"],
    queryFn: () => portfolioApi.movements(filters),
  });
}

/**
 * Todos os resgates (ou os de um ano). Ao trocar de ano, a lista anterior fica na tela até a nova chegar,
 * para o filtro de anos (que vem na resposta) não sumir no meio da troca.
 */
export function useWithdrawals(year?: number | null) {
  return useQuery({
    queryKey: ["withdrawals", year ?? "all"],
    queryFn: () => portfolioApi.withdrawals(year),
    placeholderData: keepPreviousData,
  });
}

/** Quanto já foi aportado no mês, por categoria e na reserva. */
export function useMonthSummary(month: string) {
  return useQuery({ queryKey: ["portfolio", "month-summary", month], queryFn: () => portfolioApi.monthSummary(month) });
}

/**
 * Qualquer mudança na carteira também muda comparação, rebalanceamento, reserva e trajetória. E o caixa:
 * aporte, provento e compra numa conta com caixa ativado geram lançamentos no extrato dela.
 */
function useInvalidatePortfolio() {
  const client = useQueryClient();
  return () =>
    Promise.all(
      ["portfolio", "cash", "allocation", "analytics", "reserve", "goals", "earnings", "withdrawals"].map((key) => client.invalidateQueries({ queryKey: [key] })),
    );
}

/** Categorias mudam planos, histórico, trajetória e os grupos (quem faz parte de cada um), então tudo é recarregado. */
function useInvalidateEverything() {
  const client = useQueryClient();
  return () =>
    Promise.all(
      ["portfolio", "groups", "cash", "allocation", "history", "analytics", "reserve", "goals", "earnings", "withdrawals"].map(
        (key) => client.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

export function useCreateClass() {
  const invalidate = useInvalidateEverything();
  return useMutation({
    mutationFn: ({ name, color }: { name: string; color?: string }) => portfolioApi.createClass(name, color),
    onSuccess: invalidate,
  });
}

export function useUpdateClass() {
  const invalidate = useInvalidateEverything();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: AssetClassInput }) => portfolioApi.updateClass(id, input),
    onSuccess: invalidate,
  });
}

export function useCreateInstitution() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({ mutationFn: (name: string) => portfolioApi.createInstitution(name), onSuccess: invalidate });
}

export function useDeleteInstitution() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({ mutationFn: (id: number) => portfolioApi.deleteInstitution(id), onSuccess: invalidate });
}

export function useCreateAsset() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: (input: AssetCreateInput) => portfolioApi.createAsset(input),
    onSuccess: (asset) => {
      celebrate({
        title: "Novo ativo na carteira!",
        text: createdText(asset),
        next: { label: "Registrar o aporte do mês", to: "/aporte" },
      });
      return invalidate();
    },
  });
}

export function useUpdateAsset() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: AssetUpdateInput }) => portfolioApi.updateAsset(id, input),
    onSuccess: invalidate,
  });
}

type BalanceUpdate = { id: number; input: BalanceInput };

async function saveBalances(updates: BalanceUpdate[]) {
  for (const { id, input } of updates) await portfolioApi.recordBalance(id, input);
}

/**
 * Atualização rápida de saldos (a rotina semanal): grava e só isso. A tela mostra o resultado, e
 * comemorar toda semana viraria ruído; a comemoração fica para o fechamento do mês.
 */
export function useSaveBalances() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({ mutationFn: saveBalances, onSuccess: invalidate });
}

/** Fechamento do mês: um aporte + saldo por ativo, gravados em sequência. */
export function useSaveClosing() {
  const client = useQueryClient();
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: saveBalances,
    onSuccess: async (_data, updates) => {
      await invalidate();
      const contributed = updates.reduce((sum, { input }) => sum + input.contribution_cents, 0);
      const count = updates.length === 1 ? "1 ativo" : `${updates.length} ativos`;
      if (contributed === 0) {
        celebrate({
          title: "Saldos atualizados!",
          text: `O rendimento de ${count} foi registrado.`,
          next: { label: "Feche o mês para guardar essa foto da carteira.", to: "/carteira/fechamento" },
        });
        return;
      }
      // O aporte pode ter deixado o mês em dia: aí a sequência entra na comemoração.
      // Só enfeite: se a consulta falhar, a comemoração sai sem a linha da sequência.
      const highlight = await fetchGoalsProgress(client).then(aporteHighlight).catch(() => undefined);
      celebrate({
        title: "Aporte registrado!",
        text: `${formatBRL(contributed)} aportados em ${count}. O dinheiro novo já soma ao investido.`,
        highlight,
        next: { label: "Atualize os saldos dos demais ativos e feche o mês.", to: "/carteira/fechamento" },
      });
    },
  });
}

/** Compra com o caixa da conta do ativo: vira aporte do ativo e sai do caixa, numa transação só. */
export function usePurchase() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({ mutationFn: (input: PurchaseInput) => portfolioApi.purchase(input), onSuccess: invalidate });
}

export function useTransfer() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({ mutationFn: (input: TransferInput) => portfolioApi.transfer(input), onSuccess: invalidate });
}

export function useRegisterProvento() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: (input: ProventoInput) => portfolioApi.provento(input),
    onSuccess: (movement, input) => {
      const credited = input.credited_asset_id != null && movement.related_asset_name;
      celebrate({
        title: "Provento registrado!",
        text: `${formatBRL(input.amount_cents)} recebidos de ${movement.asset_name}.`,
        next: {
          label: credited
            ? `O valor já está no saldo de ${movement.related_asset_name}. Reinvista com "Transferir entre ativos".`
            : "Para somar ao saldo de um ativo, registre o provento creditando-o em um ativo de conta.",
        },
      });
      return invalidate();
    },
  });
}

/**
 * Resgate: o dinheiro sai do ativo para uso. Muda saldo, investido, caixa, acumulado do ano e desempenho,
 * então tudo é recarregado. Sem comemoração: não é conquista; a tela mostra o que foi feito.
 */
export function useRedemption() {
  const invalidate = useInvalidateEverything();
  return useMutation({ mutationFn: (input: RedemptionInput) => portfolioApi.redemption(input), onSuccess: invalidate });
}

/** Desfaz um aporte, transferência, resgate ou provento creditado: mexe em saldos e no histórico de aportes. */
export function useUndoMovement() {
  const invalidate = useInvalidateEverything();
  return useMutation({ mutationFn: (id: number) => portfolioApi.undoMovement(id), onSuccess: invalidate });
}

/**
 * "Não contar como aporte" no aporte gerado pelo cadastro: o ativo passa a ser antigo pelo PUT do
 * cadastro (que pede o cadastro inteiro, por isso busca o ativo, mesmo arquivado). O saldo não muda.
 */
export function useUncountInitial() {
  const client = useQueryClient();
  const invalidate = useInvalidateEverything();
  return useMutation({
    mutationFn: async (movement: Movement) => {
      const assets = await client.fetchQuery<Asset[]>({
        queryKey: ["portfolio", "assets", true],
        queryFn: () => portfolioApi.assets(true),
      });
      const asset = assets.find((a) => a.id === movement.asset_id);
      if (!asset) throw new Error(`Não encontramos ${movement.asset_name} na carteira. Recarregue a página e tente de novo.`);
      return portfolioApi.updateAsset(asset.id, updateInputFrom(asset, { is_new_investment: false }));
    },
    onSuccess: invalidate,
  });
}

/** Corrige valor ou data de um movimento; refaz o efeito nos saldos e no histórico de aportes. */
export function useUpdateMovement() {
  const invalidate = useInvalidateEverything();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: MovementUpdateInput }) => portfolioApi.updateMovement(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteMovement() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({ mutationFn: (id: number) => portfolioApi.deleteMovement(id), onSuccess: invalidate });
}

export function useValuations(assetId: number) {
  return useQuery({ queryKey: ["portfolio", "valuations", assetId], queryFn: () => portfolioApi.valuations(assetId) });
}

export function useUpdateValuation(assetId: number) {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: ValuationUpdateInput }) =>
      portfolioApi.updateValuation(assetId, id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteValuation(assetId: number) {
  const invalidate = useInvalidatePortfolio();
  return useMutation({ mutationFn: (id: number) => portfolioApi.deleteValuation(assetId, id), onSuccess: invalidate });
}
