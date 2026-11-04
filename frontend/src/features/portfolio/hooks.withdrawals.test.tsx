import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRedemption, useUndoMovement } from "./hooks";

afterEach(() => vi.unstubAllGlobals());

// A tela de Retiradas lista resgates; registrar ou desfazer um precisa recarregá-la.
function setup() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const keys = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  return { wrapper, keys };
}

describe("Retiradas: invalidação após mutações", () => {
  it("registrar um resgate recarrega as retiradas", async () => {
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useRedemption(), { wrapper });

    result.current.mutate({ asset_id: 1, amount_cents: 10_000, note: null, credit_cash: false, already_in_balance: false });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(keys()).toContainEqual(["withdrawals"]);
  });

  it("desfazer um movimento recarrega as retiradas", async () => {
    const { wrapper, keys } = setup();
    const { result } = renderHook(() => useUndoMovement(), { wrapper });

    result.current.mutate(7);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(keys()).toContainEqual(["withdrawals"]);
  });
});
