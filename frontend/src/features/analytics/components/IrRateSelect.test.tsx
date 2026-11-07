import { renderHook, act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIrRate } from "../hooks";
import { IrRateSelect } from "./IrRateSelect";

beforeEach(() => localStorage.clear());

describe("IrRateSelect", () => {
  it("tem rótulo visível, quatro alíquotas em ordem e a escolhida marcada", () => {
    render(<IrRateSelect value={1500} onChange={() => {}} />);
    const select = screen.getByRole("combobox", { name: "Alíquota de IR para comparar" });
    expect(select).toHaveValue("1500");
    expect(select).toHaveAccessibleDescription(/Simulação/);
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual([
      "22,5% (aplicações de até 180 dias)",
      "20% (de 181 a 360 dias)",
      "17,5% (de 361 a 720 dias)",
      "15% (acima de 720 dias)",
    ]);
  });

  it("avisa a escolha em pontos-base", async () => {
    const onChange = vi.fn();
    render(<IrRateSelect value={1500} onChange={onChange} />);
    await userEvent.setup().selectOptions(screen.getByLabelText("Alíquota de IR para comparar"), "2250");
    expect(onChange).toHaveBeenCalledWith(2250);
  });
});

describe("useIrRate", () => {
  it("começa em 15%, guarda a escolha no navegador e a lê de novo", () => {
    const first = renderHook(() => useIrRate());
    expect(first.result.current[0]).toBe(1500);

    act(() => first.result.current[1](2000));
    expect(first.result.current[0]).toBe(2000);
    expect(localStorage.getItem("il-ir-rate")).toBe("2000");

    const second = renderHook(() => useIrRate());
    expect(second.result.current[0]).toBe(2000);
  });

  it("dois componentes na mesma tela acompanham a mesma escolha", () => {
    const a = renderHook(() => useIrRate());
    const b = renderHook(() => useIrRate());
    act(() => a.result.current[1](1750));
    expect(b.result.current[0]).toBe(1750);
  });

  it("valor guardado que não é uma alíquota volta a 15%", () => {
    localStorage.setItem("il-ir-rate", "999");
    expect(renderHook(() => useIrRate()).result.current[0]).toBe(1500);
  });
});
