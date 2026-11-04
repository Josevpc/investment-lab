// Interface pública da feature de alocação (consumida por outras features).
// As páginas ficam fora do index, e o roteador importa direto delas, para evitar ciclos.
export { Donut } from "./components/Donut";
export { useActivePlan, useComparison, usePlans, useSplit } from "./hooks";
export { allocate as allocateBps } from "./lib/targets";
export { HeldAssetsNotice } from "./components/HeldAssetsNotice";
export { AdjustedTargetNotes, GroupTargetMeta, TargetGap, TargetMeta } from "./components/TargetCells";
export { comparisonSections, groupHoldNote, type ComparisonSection } from "./lib/groups";
export { adjustedTargetNote, fullyHeldNames, isAllHeldSplitError, targetShareOfPortfolio, targetStatus } from "./lib/comparison";
export { joinNames } from "./lib/messages";
export { PlansSection } from "./PlansSection";
export type { AssetRef, Comparison, ComparisonGroup, ComparisonItem, HeldAsset, HoldStatus, Plan, Split, SplitItem, SplitMode } from "./types";
