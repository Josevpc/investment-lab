/** Grupo de categorias (ex.: "Renda variável" com FIIs e Ações/ETF). Só agrupa na leitura: a meta fica em cada categoria. */
export interface AssetGroup {
  id: number;
  name: string;
  color: string;
  archived: boolean;
  /** Categorias que fazem parte do grupo. */
  class_ids: number[];
}

export interface AssetGroupInput {
  name?: string;
  color?: string;
  archived?: boolean;
}
