// Interface pública da feature de análises. As páginas ficam fora do index (o roteador importa direto).
export { AssetVsCdi } from "./components/AssetVsCdi";
export { IrRateSelect } from "./components/IrRateSelect";
export { useAssetsPeriodVsCdi, useAssetsVsCdi, useIrRate, usePerformance, useTrajectory } from "./hooks";
export {
  benchmarkGap,
  benchmarkGapMessage,
  ibovespaByDefault,
  usdByDefault,
  type BenchmarkGap,
  type BenchmarkKey,
} from "./lib/benchmarks";
export type { AssetVsCdi as AssetVsCdiResult, Performance, StaleAsset, Trajectory } from "./types";
