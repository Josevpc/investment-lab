import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScrollRegion } from "./ScrollRegion";

function measure(scrollWidth: number, clientWidth: number) {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(scrollWidth);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(clientWidth);
}

afterEach(() => vi.restoreAllMocks());

describe("ScrollRegion", () => {
  it("quando o conteúdo cabe, não vira parada de Tab nem região", () => {
    measure(300, 328);
    render(
      <ScrollRegion label="Fechamentos">
        <p>conteúdo</p>
      </ScrollRegion>,
    );
    expect(screen.queryByRole("region", { name: "Fechamentos" })).not.toBeInTheDocument();
    const box = screen.getByText("conteúdo").parentElement!;
    expect(box).not.toHaveAttribute("tabindex");
  });

  it("quando o conteúdo é mais largo, é focável pelo teclado e tem nome acessível", () => {
    measure(520, 328);
    render(
      <ScrollRegion label="Fechamentos">
        <p>conteúdo</p>
      </ScrollRegion>,
    );
    expect(screen.getByRole("region", { name: "Fechamentos" })).toHaveAttribute("tabindex", "0");
  });

  it("esmaece a borda direita quando há conteúdo escondido, como pista de que rola", () => {
    measure(520, 328);
    render(
      <ScrollRegion label="Fechamentos">
        <p>conteúdo</p>
      </ScrollRegion>,
    );
    expect(screen.getByRole("region", { name: "Fechamentos" }).style.maskImage).toContain("transparent 100%");
  });

  it("não esmaece nada quando o conteúdo cabe", () => {
    measure(300, 328);
    render(
      <ScrollRegion label="Fechamentos">
        <p>conteúdo</p>
      </ScrollRegion>,
    );
    expect(screen.getByText("conteúdo").parentElement!.style.maskImage ?? "").toBe("");
  });

  it("diferenças de 1 px de arredondamento não contam como rolagem", () => {
    measure(329, 328);
    render(
      <ScrollRegion label="Fechamentos">
        <p>conteúdo</p>
      </ScrollRegion>,
    );
    expect(screen.queryByRole("region", { name: "Fechamentos" })).not.toBeInTheDocument();
  });
});
