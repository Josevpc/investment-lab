import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Switch } from "./Switch";

describe("Switch", () => {
  it("tem nome e descrição acessíveis e alterna pelo teclado ou pelo rótulo", async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Somente manter posição" hint="Não recebe novos aportes" />);

    const control = screen.getByRole("switch", { name: "Somente manter posição" });
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(control).toHaveAccessibleDescription("Não recebe novos aportes");

    control.focus();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(screen.getByText("Somente manter posição"));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("desabilitado, diz o motivo e não muda", async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Manter" disabled disabledReason="É a única que recebe aportes." />);

    const control = screen.getByRole("switch", { name: "Manter" });
    expect(control).toBeDisabled();
    expect(control).toHaveAccessibleDescription("É a única que recebe aportes.");
    await userEvent.click(control);
    expect(onChange).not.toHaveBeenCalled();
  });
});
