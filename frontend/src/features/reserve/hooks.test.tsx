import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSaveReserve } from "./hooks";

afterEach(() => vi.unstubAllGlobals());

describe("useSaveReserve", () => {
  it("ao salvar a meta, recarrega a reserva e as retiradas (a frase 'abaixo da meta atual' depende da meta)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useSaveReserve(), { wrapper });

    result.current.mutate({ goal_cents: 1_000_000, months: 6, monthly_cents: 0, monthly_mode: "percent", percent_bps: 0 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(["reserve"]);
    expect(keys).toContainEqual(["withdrawals"]);
  });
});
