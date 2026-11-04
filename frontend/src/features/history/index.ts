// Interface pública da feature de histórico.
export { useCreateSnapshot, useEvolution, useSnapshots } from "./hooks";
export { RANGES, rangeLabel, rangeStart } from "./lib/range";
export type { RangeKey } from "./lib/range";
export type { Evolution, Snapshot } from "./types";
