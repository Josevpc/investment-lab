import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCreateReservation, useReleaseReservation } from "./hooks";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: 1 }), { status: 200 })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Consultas já carregadas: a invalidação as deixa velhas (`isInvalidated`).
  client.setQueryData(["cash", "accounts", false], []);
  client.setQueryData(["portfolio", "summary"], {});
  client.setQueryData(["history", "contributions-by-month", "2026-05", "now"], { months: [] });
  client.setQueryData(["history", "snapshots"], []);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const stale = (key: unknown[]) => client.getQueryState(key)?.isInvalidated === true;
  return { wrapper, stale };
}

describe("Caixa: o que é atualizado depois de mexer no dinheiro separado", () => {
  it("separar dinheiro atualiza o caixa, o resumo da carteira e o aporte por mês do Histórico", async () => {
    const { wrapper, stale } = setup();
    const { result } = renderHook(() => useCreateReservation(), { wrapper });
    await act(() => result.current.mutateAsync({ accountId: 1, input: { name: "Reserva", amount_cents: 10_000 } as never }));
    await waitFor(() => expect(stale(["cash", "accounts", false])).toBe(true));
    expect(stale(["portfolio", "summary"])).toBe(true);
    expect(stale(["history", "contributions-by-month", "2026-05", "now"])).toBe(true);
    // O resto do histórico não depende do caixa e não é mexido.
    expect(stale(["history", "snapshots"])).toBe(false);
  });

  it("liberar dinheiro separado também atualiza o aporte por mês", async () => {
    const { wrapper, stale } = setup();
    const { result } = renderHook(() => useReleaseReservation(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 3 }));
    await waitFor(() => expect(stale(["history", "contributions-by-month", "2026-05", "now"])).toBe(true));
  });
});
