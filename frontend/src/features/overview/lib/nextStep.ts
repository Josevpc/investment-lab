import { monthName } from "@/shared/lib/format";
import type { MoneyTextPart } from "@/shared/lib/moneyText";

export interface NextStepInput {
  /** Mês em foco (AAAA-MM). */
  month: string;
  assetsCount: number;
  /** Já existe aporte registrado para o mês. */
  hasContribution: boolean;
  /** Datas (AAAA-MM-DD) dos fechamentos registrados. */
  snapshotDates: string[];
  /** Andamento do plano do mês (null quando o aporte não tem plano gravado). `amountUnknown`: não deu
   * para saber quais categorias estão mantidas, então o valor pode estar errado e não é mostrado. */
  plan?: { remainingCents: number; largestClass: string | null; amountUnknown?: boolean } | null;
  /** Todas as categorias com todos os ativos em "Manter posição": não há onde aplicar o aporte. */
  allHeld?: boolean;
}

export interface NextStep {
  kind: "register" | "held" | "contribution" | "invest" | "close" | "done";
  /** Frase pronta ou em partes, quando tem valor em reais (a tela desenha com <MoneyText>). */
  title: string | MoneyTextPart[];
  text: string;
  cta: string;
  to: string;
}

/** A única ação que faz sentido agora, na ordem da jornada: cadastrar → aportar → investir → fechar → conferir. */
export function nextStep({ month, assetsCount, hasContribution, snapshotDates, plan, allHeld = false }: NextStepInput): NextStep {
  const name = monthName(month);
  if (assetsCount === 0) {
    return {
      kind: "register",
      title: "Cadastre sua primeira posição",
      text: "Adicione um ativo ou registre um fechamento do passado. Com isso o resumo, a alocação e o histórico ganham vida.",
      cta: "Ir para a carteira",
      to: "/carteira/ativos?novo=1",
    };
  }
  if (!hasContribution && allHeld) {
    return {
      kind: "held",
      title: 'Todos os ativos estão em "Manter posição"',
      text: `O aporte de ${name} não tem onde ser aplicado nas categorias. Para investir, desligue "Manter posição" em algum ativo na Carteira, ou destine o valor do mês à reserva de emergência.`,
      cta: "Ir para os ativos",
      to: "/carteira/ativos",
    };
  }
  if (!hasContribution) {
    return {
      kind: "contribution",
      title: `Defina o aporte de ${name}`,
      text: "Informe o salário e o percentual para ver como dividir o aporte entre as categorias.",
      cta: "Calcular aporte",
      to: "/aporte",
    };
  }
  if (plan && plan.remainingCents > 0) {
    return {
      kind: "invest",
      title: plan.amountUnknown
        ? "Registre os aportes do mês"
        : ["Faltam ", { cents: plan.remainingCents }, ` para completar o aporte de ${name}`],
      text:
        (allHeld
          ? 'Todos os ativos estão em "Manter posição": o que falta é só a reserva de emergência. '
          : plan.largestClass
            ? `A maior parte vai para ${plan.largestClass}. `
            : "") +
        "Faça os aportes nas instituições e registre aqui o que já depositou.",
      cta: "Registrar aportes",
      to: "/carteira/movimentacoes?novo=aporte",
    };
  }
  if (!snapshotDates.some((date) => date.startsWith(month))) {
    return {
      kind: "close",
      title: `Feche ${name}`,
      text: "Atualize seus saldos e registre a evolução do mês.",
      cta: "Continuar fechamento",
      to: "/carteira/fechamento",
    };
  }
  return {
    kind: "done",
    title: `${name[0].toUpperCase()}${name.slice(1)} fechado`,
    text: "Tudo em dia neste mês. Veja como a carteira se saiu frente ao mercado.",
    cta: "Ver desempenho",
    to: "/historico?aba=desempenho",
  };
}
