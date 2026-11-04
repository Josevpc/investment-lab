import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/features/cash";
import { formatBRL } from "@/shared/lib/format";
import type { Asset, AssetClass, Institution } from "../types";
import { AssetForm, type AssetFormValues } from "./AssetForm";

const classes: AssetClass[] = [
  { id: 1, key: "renda_fixa", name: "Renda Fixa", color: "#2563eb", archived: false },
  { id: 2, key: "renda_variavel", name: "Renda Variável", color: "#7c3aed", archived: false },
  { id: 4, key: "cripto", name: "Criptomoedas", color: "#db2777", archived: false },
];
const institutions: Institution[] = [{ id: 10, name: "XP" }];

function account(id: number, institution_id: number, name: string, extra: Partial<Account> = {}): Account {
  return { id, institution_id, name, archived: false, cash_enabled: false, opening_date: null, balance_cents: 0, ...extra };
}

function setup(initial?: Asset, opts: { accounts?: Account[]; institutions?: Institution[]; assets?: Asset[] } = {}) {
  const onSubmit = vi.fn<(values: AssetFormValues) => void>();
  render(
    <AssetForm
      initial={initial}
      classes={classes}
      institutions={opts.institutions ?? institutions}
      accounts={opts.accounts ?? [account(10, 10, "XP")]}
      assets={opts.assets}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
  );
  return { onSubmit, user: userEvent.setup() };
}

function asset(extra: Partial<Asset> = {}): Asset {
  return {
    id: 4,
    name: "ALZR11",
    ticker: "ALZR11",
    class_key: "renda_variavel",
    class_name: "Renda Variável",
    institution_id: 10,
    institution_name: "XP",
    account_id: 10,
    indexer: null,
    rate_bps: null,
    maturity_date: null,
    quantity: "7",
    archived: false,
    hold_only: false,
    balance_is_net: false,
    purpose: null,
    asset_type: "fii",
    fii_segment: "papel",
    invested_cents: 6986,
    current_cents: 7231,
    gain_cents: 245,
    return_bps: 351,
    proventos_cents: 0,
    total_return_bps: 351,
    valuation_date: "2026-10-17",
    is_new_investment: false,
    initial_contribution_cents: null,
    initial_contribution_date: null,
    ...extra,
  };
}

const submitLabel = /Adicionar ativo|Salvar alterações/;

/** No cadastro a escolha entre novo e antigo é obrigatória. */
async function chooseOld(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("radio", { name: /^Antigo/ }));
}

describe("AssetForm: saldo bruto ou líquido de IR", () => {
  const netSwitch = () => screen.getByRole("switch", { name: "Saldo já com o IR descontado" });

  it("na renda fixa começa desligado (bruto) e vai marcado para o back-end quando a pessoa liga", async () => {
    const { user, onSubmit } = setup();
    expect(netSwitch()).toHaveAttribute("aria-checked", "false");

    await user.type(screen.getByLabelText("Nome"), "Caixinha");
    await user.type(screen.getByLabelText("Valor atual (R$)"), "100");
    await user.click(netSwitch());
    await chooseOld(user);
    await user.click(screen.getByRole("button", { name: submitLabel }));

    expect(onSubmit.mock.calls[0][0]).toMatchObject({ balance_is_net: true });
  });

  it("explica que o app não calcula imposto e só rotula o % do CDI", () => {
    setup();
    expect(netSwitch()).toHaveAccessibleDescription(/não calcula imposto/);
  });

  it("na edição mostra a marca já salva", () => {
    setup(asset({ class_key: "renda_fixa", asset_type: null, fii_segment: null, balance_is_net: true }));
    expect(netSwitch()).toHaveAttribute("aria-checked", "true");
  });

  it("fora da renda fixa não aparece e nunca vai marcado", async () => {
    const { user, onSubmit } = setup(
      asset({ class_key: "renda_fixa", asset_type: null, fii_segment: null, balance_is_net: true }),
    );
    await user.selectOptions(screen.getByLabelText("Categoria"), "cripto");
    expect(screen.queryByRole("switch", { name: "Saldo já com o IR descontado" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ balance_is_net: false });
  });
});

describe("AssetForm: tipo do ativo e segmento do FII", () => {
  it("só pede o tipo fora de renda fixa e cripto", async () => {
    const { user } = setup();
    // A primeira categoria é renda fixa: sem campo de tipo.
    expect(screen.queryByLabelText("Tipo do ativo")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Categoria"), "renda_variavel");
    expect(screen.getByLabelText("Tipo do ativo")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Categoria"), "cripto");
    expect(screen.queryByLabelText("Tipo do ativo")).not.toBeInTheDocument();
  });

  it("o segmento papel/tijolo aparece só para fundos imobiliários e é obrigatório", async () => {
    const { user, onSubmit } = setup();
    await user.selectOptions(screen.getByLabelText("Categoria"), "renda_variavel");
    await user.type(screen.getByLabelText("Nome"), "ALZR11");
    await user.type(screen.getByLabelText("Valor atual (R$)"), "72,31");

    await user.selectOptions(screen.getByLabelText("Tipo do ativo"), "acao");
    expect(screen.queryByLabelText(/Segmento do fundo/)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Tipo do ativo"), "fii");
    expect(screen.getByLabelText(/Segmento do fundo/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: submitLabel })).toBeDisabled(); // falta o segmento

    await user.selectOptions(screen.getByLabelText(/Segmento do fundo/), "tijolo");
    await chooseOld(user);
    await user.click(screen.getByRole("button", { name: submitLabel }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      class_key: "renda_variavel",
      asset_type: "fii",
      fii_segment: "tijolo",
      current_cents: 7231,
      invested_cents: null, // vazio: o back-end assume igual ao atual
    });
  });

  it("trocar de FII para outro tipo descarta o segmento", async () => {
    const { user, onSubmit } = setup();
    await user.selectOptions(screen.getByLabelText("Categoria"), "renda_variavel");
    await user.type(screen.getByLabelText("Nome"), "Fundo");
    await user.type(screen.getByLabelText("Valor atual (R$)"), "10");
    await user.selectOptions(screen.getByLabelText("Tipo do ativo"), "fii");
    await user.selectOptions(screen.getByLabelText(/Segmento do fundo/), "papel");
    await user.selectOptions(screen.getByLabelText("Tipo do ativo"), "etf");
    await chooseOld(user);
    await user.click(screen.getByRole("button", { name: submitLabel }));

    expect(onSubmit.mock.calls[0][0]).toMatchObject({ asset_type: "etf", fii_segment: null });
  });

  it("na edição mostra o tipo e o segmento já salvos", () => {
    setup(asset());
    expect(screen.getByLabelText("Tipo do ativo")).toHaveValue("fii");
    expect(screen.getByLabelText(/Segmento do fundo/)).toHaveValue("papel");
  });
});

describe("AssetForm: entrada por cotação", () => {
  it("quantidade × cotação preenche o valor atual", async () => {
    const { user, onSubmit } = setup();
    await user.selectOptions(screen.getByLabelText("Categoria"), "renda_variavel");
    await user.type(screen.getByLabelText("Nome"), "VGHF11");
    await user.selectOptions(screen.getByLabelText("Tipo do ativo"), "fii");
    await user.selectOptions(screen.getByLabelText(/Segmento do fundo/), "papel");

    expect(screen.queryByLabelText("Cotação")).not.toBeInTheDocument(); // sem quantidade, não há o que multiplicar
    await user.type(screen.getByLabelText("Quantidade"), "45");
    await user.type(screen.getByLabelText("Cotação"), "6,15");

    expect(screen.getByLabelText("Valor atual (R$)")).toHaveValue("276,75"); // 45 x R$ 6,15
    await chooseOld(user);
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ quantity: "45", current_cents: 27_675 }));
  });

  it("o valor atual continua editável depois da cotação", async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText("Categoria"), "renda_variavel");
    await user.type(screen.getByLabelText("Quantidade"), "10");
    await user.type(screen.getByLabelText("Cotação"), "2");
    const current = screen.getByLabelText("Valor atual (R$)");
    expect(current).toHaveValue("20,00");
    await user.clear(current);
    await user.type(current, "21,50");
    expect(current).toHaveValue("21,50");
  });
});

describe("AssetForm: conta do ativo", () => {
  const twoBanks: Institution[] = [
    { id: 10, name: "XP" },
    { id: 20, name: "Nubank" },
  ];
  const accounts = [
    account(12, 10, "XP investimentos", { cash_enabled: true }),
    account(11, 10, "XP conta antiga"),
    account(9, 10, "XP encerrada", { archived: true }),
    account(21, 20, "Nubank"),
  ];

  async function fillNew(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("Nome"), "CDB");
    await user.type(screen.getByLabelText("Valor atual (R$)"), "100");
    await chooseOld(user);
  }

  it("na criação pré-seleciona a conta ativa mais antiga e lista só as ativas da instituição", async () => {
    const { user, onSubmit } = setup(undefined, { accounts, institutions: twoBanks });
    const select = screen.getByLabelText(/^Conta/);
    expect(select).toHaveValue("11");
    expect(within(select).queryByRole("option", { name: /XP encerrada/ })).not.toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "Nubank" })).not.toBeInTheDocument();
    expect(screen.getByText(/Caixa não ativado\. Aportes e compras deste ativo passam pelo caixa desta conta\./)).toBeInTheDocument();

    await user.selectOptions(select, "12");
    expect(screen.getByText(/^Caixa ativado\./)).toBeInTheDocument();

    await fillNew(user);
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ institution_id: 10, account_id: 12 });
  });

  it("trocar de instituição volta para a conta padrão da nova", async () => {
    const { user, onSubmit } = setup(undefined, { accounts, institutions: twoBanks });
    await user.selectOptions(screen.getByLabelText("Instituição"), "20");
    expect(screen.getByLabelText(/^Conta/)).toHaveValue("21");
    expect(within(screen.getByLabelText(/^Conta/)).queryByRole("option", { name: /XP/ })).not.toBeInTheDocument();

    await fillNew(user);
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ institution_id: 20, account_id: 21 });
  });

  it("instituição sem conta esconde o campo e envia null", async () => {
    const { user, onSubmit } = setup(undefined, { accounts: [account(21, 20, "Nubank")], institutions: twoBanks });
    expect(screen.queryByLabelText(/^Conta/)).not.toBeInTheDocument();

    await fillNew(user);
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ institution_id: 10, account_id: null });
  });

  it("na edição sem trocar a conta envia null (mantém a atual)", async () => {
    const { user, onSubmit } = setup(asset({ account_id: 12 }), { accounts, institutions: twoBanks });
    expect(screen.getByLabelText(/^Conta/)).toHaveValue("12");
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ account_id: null });
  });

  it("na edição, trocar a conta envia o id novo", async () => {
    const { user, onSubmit } = setup(asset({ account_id: 12 }), { accounts, institutions: twoBanks });
    await user.selectOptions(screen.getByLabelText(/^Conta/), "11");
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ account_id: 11 });
  });

  it("na edição, a conta atual arquivada aparece marcada e não é enviada se mantida", async () => {
    const { user, onSubmit } = setup(asset({ account_id: 9 }), { accounts, institutions: twoBanks });
    expect(screen.getByLabelText(/^Conta/)).toHaveValue("9");
    expect(screen.getByRole("option", { name: "XP encerrada (arquivada)" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ account_id: null });
  });
});

describe("AssetForm: conta na edição com troca de instituição", () => {
  const banks: Institution[] = [
    { id: 10, name: "XP" },
    { id: 20, name: "Nubank" },
    { id: 30, name: "Inter" },
  ];
  const accounts = [
    account(12, 10, "XP investimentos"),
    account(22, 20, "Nubank reserva"),
    account(21, 20, "Nubank"),
    account(31, 30, "Inter antiga", { archived: true }),
  ];

  it("trocar de instituição envia o id da conta padrão da nova", async () => {
    const { user, onSubmit } = setup(asset({ account_id: 12 }), { accounts, institutions: banks });
    await user.selectOptions(screen.getByLabelText("Instituição"), "20");
    expect(screen.getByLabelText(/^Conta/)).toHaveValue("21");
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ institution_id: 20, account_id: 21 });
  });

  it("trocar de instituição e voltar à original restaura a conta e envia null", async () => {
    const { user, onSubmit } = setup(asset({ account_id: 12 }), { accounts, institutions: banks });
    await user.selectOptions(screen.getByLabelText("Instituição"), "20");
    await user.selectOptions(screen.getByLabelText("Instituição"), "10");
    expect(screen.getByLabelText(/^Conta/)).toHaveValue("12");
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ institution_id: 10, account_id: null });
  });

  it("instituição só com conta arquivada esconde o campo e envia null", async () => {
    const { user, onSubmit } = setup(asset({ account_id: 12 }), { accounts, institutions: banks });
    await user.selectOptions(screen.getByLabelText("Instituição"), "30");
    expect(screen.queryByLabelText(/^Conta/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ institution_id: 30, account_id: null });
  });

  it("na edição avisa que a conta não troca se já houver lançamentos; na criação, não", () => {
    setup(asset({ account_id: 12 }), { accounts, institutions: banks });
    expect(screen.getByText(/Se este ativo já tem lançamentos no caixa, a conta não pode ser trocada./)).toBeInTheDocument();
    cleanup();
    setup(undefined, { accounts, institutions: banks });
    expect(screen.getByLabelText(/^Conta/)).toBeInTheDocument();
    expect(screen.queryByText(/a conta não pode ser trocada/)).not.toBeInTheDocument();
  });
});

describe("AssetForm: arquivar", () => {
  it("marcar Arquivar mostra os efeitos e pede confirmação com o valor ao salvar", async () => {
    const { user, onSubmit } = setup(asset());
    expect(screen.queryByText(/Ao salvar, este ativo/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Arquivar ativo/ }));
    expect(screen.getByText(/deixa de aceitar aporte, provento e transferência/)).toBeInTheDocument();
    expect(screen.getByText(/fechamentos já registrados no Histórico não mudam/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: submitLabel }));
    const dialog = await screen.findByRole("alertdialog", { name: "Arquivar ALZR11?" });
    expect(dialog.textContent).toContain(formatBRL(7231)); // textContent: o espaço do R$ é insecável
    expect(dialog).toHaveTextContent('saída "Ativos arquivados"');
    expect(dialog).toHaveTextContent('use "Resgatar" antes de arquivar');
    expect(onSubmit).not.toHaveBeenCalled(); // nada é salvo enquanto a pessoa não confirmar

    await user.click(within(dialog).getByRole("button", { name: "Arquivar ativo" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ archived: true }));
  });

  it("ativo sem saldo: a confirmação não fala de saída nem de resgate", async () => {
    const { user } = setup(asset({ current_cents: 0 }));
    await user.click(screen.getByRole("checkbox", { name: /Arquivar ativo/ }));
    await user.click(screen.getByRole("button", { name: submitLabel }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).not.toHaveTextContent("Ativos arquivados");
    expect(dialog).toHaveTextContent("rendimento passado é recalculado");
  });

  it("o checkbox Arquivar é descrito pelo aviso só enquanto ele está na tela", async () => {
    const { user } = setup(asset());
    const checkbox = screen.getByRole("checkbox", { name: /Arquivar ativo/ });
    expect(checkbox).not.toHaveAttribute("aria-describedby");

    await user.click(checkbox);
    const id = checkbox.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)).toHaveTextContent(/Ao salvar, este ativo/);
    expect(checkbox).toHaveAccessibleDescription(/deixa de aceitar aporte, provento e transferência/);

    await user.click(checkbox);
    expect(checkbox).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(/Ao salvar, este ativo/)).not.toBeInTheDocument();
  });

  it("cancelar a confirmação não salva", async () => {
    const { user, onSubmit } = setup(asset());
    await user.click(screen.getByRole("checkbox", { name: /Arquivar ativo/ }));
    await user.click(screen.getByRole("button", { name: submitLabel }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("salvar sem arquivar e desarquivar não perguntam", async () => {
    const first = setup(asset());
    await first.user.click(screen.getByRole("button", { name: submitLabel }));
    expect(first.onSubmit).toHaveBeenCalledTimes(1);
    cleanup();

    const { user, onSubmit } = setup(asset({ archived: true }));
    await user.click(screen.getByRole("checkbox", { name: /Arquivar ativo/ }));
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ archived: false }));
  });
});

describe("AssetForm: manter posição", () => {
  it("o interruptor tem nome acessível, explica o efeito e é enviado", async () => {
    const { user, onSubmit } = setup(asset());
    const hold = screen.getByRole("switch", { name: "Manter posição" });
    expect(hold).toHaveAttribute("aria-checked", "false");
    expect(hold).toHaveAccessibleDescription(/Não recebe novos aportes; continua contando na carteira/);

    await user.click(hold);
    expect(hold).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ hold_only: true }));
  });

  it("vem marcado na edição de um ativo mantido e o cadastro novo começa desmarcado", () => {
    setup(asset({ hold_only: true }));
    expect(screen.getByRole("switch", { name: "Manter posição" })).toHaveAttribute("aria-checked", "true");
    cleanup();
    setup();
    expect(screen.getByRole("switch", { name: "Manter posição" })).toHaveAttribute("aria-checked", "false");
  });

  it("arquivar desliga a marca e diz por quê", async () => {
    const { user, onSubmit } = setup(asset({ hold_only: true }));
    await user.click(screen.getByRole("checkbox", { name: /Arquivar ativo/ }));
    const hold = screen.getByRole("switch", { name: "Manter posição" });
    expect(hold).toBeDisabled();
    expect(hold).toHaveAttribute("aria-checked", "false");
    expect(hold).toHaveAccessibleDescription(/Ativo arquivado não pode ser mantido\./);
    await user.click(screen.getByRole("button", { name: submitLabel }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Arquivar ativo" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ archived: true, hold_only: false }));
  });

  it("ativo da reserva não mostra o interruptor e virar reserva envia hold_only: false", async () => {
    const { user, onSubmit } = setup(asset({ hold_only: true }));
    expect(screen.getByRole("switch", { name: "Manter posição" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("checkbox", { name: /reserva de emergência/ }));
    expect(screen.queryByRole("switch", { name: "Manter posição" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ purpose: "reserva", hold_only: false }));
    cleanup();

    setup(asset({ purpose: "reserva" }));
    expect(screen.queryByRole("switch", { name: "Manter posição" })).not.toBeInTheDocument();
  });

  it("novo ativo numa categoria toda mantida avisa que ela volta a receber aportes", async () => {
    const held = asset({ id: 7, hold_only: true });
    const { user } = setup(undefined, { assets: [held] });
    expect(screen.queryByText(/está toda mantida hoje/)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Categoria"), "renda_variavel");
    expect(screen.getByRole("status")).toHaveTextContent(
      /Renda Variável está toda mantida hoje\. Com este ativo recebendo aportes, a categoria volta a receber/,
    );

    // Se o novo também for mantido, nada muda na categoria.
    await user.click(screen.getByRole("switch", { name: "Manter posição" }));
    expect(screen.queryByText(/está toda mantida hoje/)).not.toBeInTheDocument();
  });

  it("marcar o último ativo que recebia avisa que a meta da categoria fica suspensa", async () => {
    const other = asset({ id: 7, name: "PETR4", hold_only: true });
    const { user } = setup(asset(), { assets: [other, asset()] });
    await user.click(screen.getByRole("switch", { name: "Manter posição" }));
    expect(screen.getByRole("status")).toHaveTextContent(/todos os ativos de Renda Variável ficam mantidos.*meta dela fica suspensa/);
  });
});

describe("AssetForm: investimento novo ou antigo", () => {
  const normalize = (text: string | null) => (text ?? "").replace(/\u00a0/g, " ");

  it("no cadastro, nenhuma opção vem marcada e o rótulo do novo diz de que mês é o aporte", async () => {
    const { user } = setup();
    const group = screen.getByRole("group", { name: "Esse investimento é…" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    radios.forEach((r) => expect(r).not.toBeChecked());
    expect(within(group).getByRole("radio", { name: /^Antigo: já existia, só estou trazendo para o app \(não conta como aporte\)/ })).toBeInTheDocument();

    const date = screen.getByLabelText("Data dos valores");
    await user.clear(date);
    await user.type(date, "2026-09-30");
    expect(within(group).getByRole("radio", { name: "Novo: estou aplicando esse dinheiro agora (conta como aporte de setembro)" })).toBeInTheDocument();
  });

  it("sem escolher, não envia: mostra o erro e leva o foco ao grupo", async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByLabelText("Nome"), "CDB");
    await user.type(screen.getByLabelText("Valor atual (R$)"), "100");
    await user.click(screen.getByRole("button", { name: submitLabel }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Escolha se o investimento é novo ou antigo.")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Esse investimento é…" });
    expect(group).toHaveAccessibleDescription("Escolha se o investimento é novo ou antigo.");
    expect(group).toContainElement(document.activeElement as HTMLElement);

    await user.click(screen.getByRole("radio", { name: /^Novo/ }));
    expect(screen.queryByText("Escolha se o investimento é novo ou antigo.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ is_new_investment: true, current_cents: 10_000 });
  });

  it("antigo vai como is_new_investment: false", async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByLabelText("Nome"), "CDB");
    await user.type(screen.getByLabelText("Valor atual (R$)"), "100");
    await chooseOld(user);
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ is_new_investment: false });
  });

  it("na edição, marca o valor atual, explica o efeito da troca e só envia quando muda", async () => {
    const isNew = asset({ is_new_investment: true, initial_contribution_cents: 50_000, initial_contribution_date: "2026-10-05" });
    const first = setup(isNew);
    const novo = screen.getByRole("radio", { name: "Novo: estou aplicando esse dinheiro agora (conta como aporte de outubro)" });
    expect(novo).toBeChecked();
    const group = screen.getByRole("group", { name: "Esse investimento é…" });
    expect(normalize(group.textContent)).toContain("Hoje R$ 500,00 conta como aporte de outubro.");

    await first.user.click(screen.getByRole("radio", { name: /^Antigo/ }));
    expect(normalize(group.textContent)).toContain("Ao salvar, R$ 500,00 sai dos aportes de outubro. O saldo do ativo não muda.");
    await first.user.click(screen.getByRole("button", { name: submitLabel }));
    expect(first.onSubmit.mock.calls[0][0]).toMatchObject({ is_new_investment: false });
    cleanup();

    const second = setup(isNew);
    await second.user.click(screen.getByRole("button", { name: submitLabel }));
    expect(second.onSubmit.mock.calls[0][0]).toMatchObject({ is_new_investment: null });
  });

  it("na edição de um antigo, virar novo diz que o valor do cadastro entra como aporte", async () => {
    const { user, onSubmit } = setup(asset());
    expect(screen.getByRole("radio", { name: /^Antigo/ })).toBeChecked();
    expect(screen.getByText(/Hoje não conta como aporte/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Novo: estou aplicando esse dinheiro agora (conta como aporte do mês do cadastro)" }));
    expect(screen.getByText("Ao salvar, o valor do cadastro entra como aporte do mês do cadastro.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: submitLabel }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ is_new_investment: true });
  });
});
