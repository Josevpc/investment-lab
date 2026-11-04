import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchQuoteButton } from "./FetchQuoteButton";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FetchQuoteButton", () => {
  it("busca pelo ticker e entrega o preço com vírgula decimal", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ ticker: "ONDO", price: "2.224256", source: "Binance" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onQuote = vi.fn();
    render(<FetchQuoteButton ticker="ondo" assetName="ONDO" onQuote={onQuote} />);

    await userEvent.click(screen.getByRole("button", { name: "Buscar cotação de ONDO" }));

    await waitFor(() => expect(onQuote).toHaveBeenCalledWith("2,224256")); // "2.224" seria lido como milhar
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/v1/quotes/crypto?ticker=ondo");
  });

  it("se a busca falhar, avisa e deixa digitar à mão sem mexer no campo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "A Binance não tem cotação para XYZ." }), { status: 404 })));
    const onQuote = vi.fn();
    render(<FetchQuoteButton ticker="XYZ" assetName="Xyz" onQuote={onQuote} />);

    await userEvent.click(screen.getByRole("button", { name: "Buscar cotação de Xyz" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A Binance não tem cotação para XYZ. Digite a cotação à mão.");
    expect(onQuote).not.toHaveBeenCalled();
  });
});
