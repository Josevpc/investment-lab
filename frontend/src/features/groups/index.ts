// Interface pública da feature de grupos de categorias (consumida por outras features).
export { GroupsCard } from "./components/GroupsCard";
export { useAssetGroups } from "./hooks";
export { arrangeByGroup, groupsByClassId, groupsByClassKey, type Arranged } from "./lib/grouping";
export type { AssetGroup } from "./types";
