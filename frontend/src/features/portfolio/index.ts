// Interface pública da feature de carteira (consumida por outras features).
export { CategoriesCard } from "./components/CategoriesCard";
export { useAssetClasses, useAssets, useInstitutions, useMonthSummary, usePortfolioSummary, usePurchase } from "./hooks";
export { investedDetail } from "./lib/monthInvested";
export type { Asset, AssetClass, Institution, MonthSummary, PortfolioSummary, PurchaseResult } from "./types";
