import { PebbleBar } from "./PebbleBar";

/**
 * Progresso da reserva, na barra seixo. O percentual e o texto de "completa" ficam por escrito
 * ao lado, então a cor não é o único sinal. Sem brilho nem animação: completa é só a barra cheia.
 */
export function EnergyBar({ bps, label, className }: { bps: number; label: string; className?: string }) {
  return <PebbleBar role="progressbar" valueBps={bps} label={label} className={className} />;
}
