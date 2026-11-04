export type StepState = "done" | "current" | "pending";

export interface ClosingStep {
  key: "contribution" | "balances" | "review" | "snapshot" | "summary";
  title: string;
  description: string;
  state: StepState;
}

export interface ClosingInput {
  /** Mês em fechamento (AAAA-MM). */
  month: string;
  hasContribution: boolean;
  /** Ativos não arquivados, com a data da última posição de cada um. */
  assets: { valuation_date: string }[];
  /** O usuário confirmou que os saldos que não mudaram continuam corretos. */
  balancesConfirmed?: boolean;
  /** O usuário já conferiu totais, reserva e composição neste mês. */
  reviewed: boolean;
  hasSnapshot: boolean;
}

/**
 * Etapas do fechamento mensal, derivadas dos dados: sair e voltar mostra o ponto exato em que parou.
 * A primeira etapa não concluída é a atual; as seguintes ficam pendentes.
 */
export function closingSteps(input: ClosingInput): ClosingStep[] {
  const balancesDone =
    input.assets.length > 0 &&
    (input.balancesConfirmed || input.assets.every((asset) => asset.valuation_date.slice(0, 7) >= input.month));

  const definitions: { key: ClosingStep["key"]; title: string; description: string; done: boolean }[] = [
    {
      key: "contribution",
      title: "Rever o aporte do mês",
      description: "Salário, percentual e divisão entre as categorias.",
      done: input.hasContribution,
    },
    {
      key: "balances",
      title: "Atualizar saldos e aportes por ativo",
      description: "Digite o saldo do extrato de cada ativo e quanto entrou de dinheiro novo.",
      done: balancesDone,
    },
    {
      key: "review",
      title: "Conferir totais, reserva e composição",
      description: "Veja se os números batem com o que você espera antes de registrar.",
      done: input.reviewed || input.hasSnapshot,
    },
    {
      key: "snapshot",
      title: "Registrar o fechamento",
      description: "Guarda a foto da carteira deste mês no histórico.",
      done: input.hasSnapshot,
    },
    {
      key: "summary",
      title: "Resumo do fechamento",
      description: "O que mudou desde o fechamento anterior.",
      done: input.hasSnapshot,
    },
  ];

  let currentFound = false;
  return definitions.map(({ done, ...rest }) => {
    if (done) return { ...rest, state: "done" as const };
    if (!currentFound) {
      currentFound = true;
      return { ...rest, state: "current" as const };
    }
    return { ...rest, state: "pending" as const };
  });
}
