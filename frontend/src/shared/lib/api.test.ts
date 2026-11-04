import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

function mockFetch() {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("manda o cabeçalho do app em toda requisição, inclusive nas gravações", async () => {
    const fetchMock = mockFetch();
    await api.get("/assets");
    await api.post("/assets", { name: "x" });
    await api.put("/assets/1", { name: "x" });
    await api.patch("/assets/1", { name: "x" });
    await api.delete("/assets/1");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({ "X-Investment-Lab": "1" });
    }
  });

  it("só declara JSON quando há corpo", async () => {
    const fetchMock = mockFetch();
    await api.get("/assets");
    await api.put("/assets/1", { name: "x" });
    const [getInit, putInit] = fetchMock.mock.calls.map(([, init]) => init as RequestInit);
    expect(getInit.headers).not.toHaveProperty("Content-Type");
    expect(putInit.headers).toMatchObject({ "Content-Type": "application/json" });
  });
});
