import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MoneyText } from "./MoneyText";

describe("Frase com valores", () => {
  const parts = ["Seu dinheiro trabalhou ", { cents: 1_230 }, " para você."];

  it("desenha cada valor com <Money>, para o modo de ocultar valores funcionar", () => {
    const { container } = render(
      <p>
        <MoneyText parts={parts} />
      </p>,
    );
    expect(container.textContent?.replace(/\s/g, " ")).toBe("Seu dinheiro trabalhou R$ 12,30 para você.");
    const money = container.querySelectorAll(".money");
    expect(money).toHaveLength(1);
    expect(money[0].textContent?.replace(/\s/g, " ")).toBe("R$ 12,30");
  });
});
