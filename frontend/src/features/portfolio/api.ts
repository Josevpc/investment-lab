import { api } from "@/shared/lib/api";
import type {
  Asset,
  AssetClass,
  AssetClassInput,
  AssetCreateInput,
  AssetUpdateInput,
  BalanceInput,
  Institution,
  MonthSummary,
  Movement,
  MovementKind,
  MovementUpdateInput,
  PortfolioSummary,
  ProventoInput,
  PurchaseInput,
  PurchaseResult,
  RedemptionInput,
  TransferInput,
  Valuation,
  ValuationUpdateInput,
  WithdrawalList,
} from "./types";

export interface CryptoQuote {
  ticker: string;
  /** Reais por moeda, texto decimal (ex.: "431884.5"). */
  price: string;
  source: string;
}

export const portfolioApi = {
  cryptoQuote: (ticker: string) => api.get<CryptoQuote>(`/quotes/crypto?ticker=${encodeURIComponent(ticker)}`),
  classes: (includeArchived: boolean) => api.get<AssetClass[]>(`/asset-classes?include_archived=${includeArchived}`),
  createClass: (name: string, color?: string) => api.post<AssetClass>("/asset-classes", { name, color: color ?? null }),
  updateClass: (id: number, input: AssetClassInput) => api.put<AssetClass>(`/asset-classes/${id}`, input),
  institutions: () => api.get<Institution[]>("/institutions"),
  createInstitution: (name: string) => api.post<Institution>("/institutions", { name }),
  renameInstitution: (id: number, name: string) => api.put<Institution>(`/institutions/${id}`, { name }),
  deleteInstitution: (id: number) => api.delete(`/institutions/${id}`),
  assets: (includeArchived: boolean) => api.get<Asset[]>(`/assets?include_archived=${includeArchived}`),
  createAsset: (input: AssetCreateInput) => api.post<Asset>("/assets", input),
  updateAsset: (id: number, input: AssetUpdateInput) => api.put<Asset>(`/assets/${id}`, input),
  recordBalance: (id: number, input: BalanceInput) => api.post<Asset>(`/assets/${id}/balance`, input),
  valuations: (assetId: number) => api.get<Valuation[]>(`/assets/${assetId}/valuations`),
  updateValuation: (assetId: number, id: number, input: ValuationUpdateInput) =>
    api.put<Valuation>(`/assets/${assetId}/valuations/${id}`, input),
  deleteValuation: (assetId: number, id: number) => api.delete(`/assets/${assetId}/valuations/${id}`),
  transfer: (input: TransferInput) => api.post<Movement>("/transfers", input),
  provento: (input: ProventoInput) => api.post<Movement>("/proventos", input),
  redemption: (input: RedemptionInput) => api.post<Movement>("/redemptions", input),
  purchase: (input: PurchaseInput) => api.post<PurchaseResult>("/purchases", input),
  movements: (filters: { month?: string; kind?: MovementKind }) => {
    const params = new URLSearchParams();
    if (filters.month) params.set("month", filters.month);
    if (filters.kind) params.set("kind", filters.kind);
    const query = params.toString();
    return api.get<Movement[]>(`/movements${query ? `?${query}` : ""}`);
  },
  deleteMovement: (id: number) => api.delete(`/movements/${id}`),
  updateMovement: (id: number, input: MovementUpdateInput) => api.patch<Movement>(`/movements/${id}`, input),
  undoMovement: (id: number) => api.post<Movement>(`/movements/${id}/undo`),
  withdrawals: (year?: number | null) => api.get<WithdrawalList>(`/withdrawals${year ? `?year=${year}` : ""}`),
  monthSummary: (month: string) => api.get<MonthSummary>(`/portfolio/month-summary?month=${month}`),
  summary: () => api.get<PortfolioSummary>("/portfolio/summary"),
};
