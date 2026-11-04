import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MonthInput, shiftMonth } from "./MonthInput";

describe("shiftMonth", () => {
  it("anda de mês em mês e vira o ano", () => {
    expect(shiftMonth("2026-10", 1)).toBe("2026-11");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-03", -15)).toBe("2024-12");
  });
});

describe("MonthInput", () => {
  it("mostra o mês por extenso e troca com as setas, sem digitar", async () => {
    const onChange = vi.fn();
    render(<MonthInput value="2026-10" onChange={onChange} />);
    expect(screen.getByRole("button", { name: /outubro de 2026/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-09");
    await userEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-11");
  });

  it("abre a grade, troca de ano e escolhe o mês", async () => {
    function Harness() {
      const [month, setMonth] = useState("2026-10");
      return <MonthInput value={month} onChange={setMonth} />;
    }
    render(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: /outubro de 2026/i }));
    const dialog = screen.getByRole("dialog", { name: "Escolher mês" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "outubro de 2026" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(within(dialog).getByRole("button", { name: "Ano anterior" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "março de 2025" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); // fecha ao escolher
    expect(screen.getByRole("button", { name: /março de 2025/i })).toBeInTheDocument();
  });

  it("fecha com Esc sem mudar o mês", async () => {
    const onChange = vi.fn();
    render(<MonthInput value="2026-10" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /outubro de 2026/i }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
