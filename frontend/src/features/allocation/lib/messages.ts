/** "A", "A e B", "A, B e C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;
}

/** Mensagem depois de salvar o plano: confirma e diz o que acontece no próximo aporte. */
export function savedPlanMessage(isActive: boolean): string {
  return isActive
    ? "Metas salvas. A divisão do próximo aporte já segue este plano."
    : "Metas salvas. Este plano não está ativo: clique em Ativar para a tela de aporte usar estas metas.";
}
