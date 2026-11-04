import { joinNames, type AssetRef } from "@/features/allocation";

const MAX_LISTED = 3;

/** "A", "A ou B", "A, B ou C", "A, B, C ou mais 2". */
function joinOr(names: string[]): string {
  if (names.length > MAX_LISTED) return `${names.slice(0, MAX_LISTED).join(", ")} ou mais ${names.length - MAX_LISTED}`;
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ou ${names.at(-1)}`;
}

/**
 * Para onde vai o aporte de uma categoria com ativos mantidos: "Vai para: B ou C · A mantido".
 * Só lista; quem escolhe o ativo (e quanto em cada um) é a pessoa. null quando nada está mantido,
 * porque aí a categoria inteira recebe e a lista só repetiria a Carteira.
 */
export function destinationText(receiving: readonly AssetRef[], held: readonly AssetRef[]): string | null {
  if (held.length === 0) return null;
  const heldPart = `${joinNames(held.map((a) => a.name))} ${held.length === 1 ? "mantido" : "mantidos"}`;
  if (receiving.length === 0) return heldPart;
  return `Vai para: ${joinOr(receiving.map((a) => a.name))} · ${heldPart}`;
}
