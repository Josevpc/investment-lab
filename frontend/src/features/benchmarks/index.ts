// Interface pública da feature de índices de referência (CDI, Selic, IPCA, Ibovespa e dólar).
export { BenchmarksCard } from "./BenchmarksCard";
export { useBenchmarkStatus, useRefreshBenchmarks } from "./hooks";
export type { BenchmarkStatus, RefreshResult, SeriesStatus } from "./types";
