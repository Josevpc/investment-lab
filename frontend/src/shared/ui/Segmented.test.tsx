import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Segmented } from "./index";

const options = [
  { value: "6m", label: "6M" },
  { value: "12m", label: "1A" },
  { value: "all", label: "Todo" },
] as const;

describe("Segmented", () => {
  it("diz qual opção está ativa e avisa a troca", async () => {
    const onChange = vi.fn();
    render(<Segmented label="Período" value="12m" options={options} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "1A" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Todo" }));
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("com fill, as opções dividem uma linha só em vez de quebrar em andares", () => {
    render(<Segmented label="Período" value="12m" options={options} onChange={() => {}} fill />);
    const group = screen.getByRole("group", { name: "Período" });
    expect(group.className).toContain("flex w-full");
    expect(group.className).not.toContain("flex-wrap");
    expect(screen.getByRole("button", { name: "6M" }).className).toContain("flex-1");
  });

  it("sem fill, continua podendo quebrar", () => {
    render(<Segmented label="Período" value="12m" options={options} onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Período" }).className).toContain("flex-wrap");
  });
});
