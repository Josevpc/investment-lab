// Marcos do "salário do seu dinheiro" já comemorados, para cada conquista soltar confete uma vez só.
// O modo demonstração guarda à parte, para os dados fictícios não "gastarem" as conquistas reais.

export const CELEBRATED_KEY = "il-earnings-celebrated";
export const CELEBRATED_DEMO_KEY = "il-earnings-celebrated-demo";

// Sem localStorage (bloqueado ou cheio), a memória da aba evita repetir a festa a cada recarga dos dados.
const memory = new Map<string, string[]>();

export function readCelebrated(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((k): k is string => typeof k === "string");
    }
  } catch {
    // Armazenamento indisponível ou valor corrompido: segue com a memória da aba.
  }
  return memory.get(key) ?? null;
}

export function writeCelebrated(key: string, keys: string[]): void {
  memory.set(key, keys);
  try {
    localStorage.setItem(key, JSON.stringify(keys));
  } catch {
    // Sem armazenamento: vale só para esta aba.
  }
}

/** Só para testes: esquece o que foi lembrado na aba. */
export function forgetCelebratedInMemory(): void {
  memory.clear();
}
