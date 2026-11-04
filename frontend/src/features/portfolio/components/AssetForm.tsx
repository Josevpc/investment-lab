import { useId, useRef, useState, type FormEvent } from "react";
import type { Account } from "@/features/cash";
import { holdChangeNotice } from "../lib/hold";
import { NEWNESS_REQUIRED, newnessEffect, newOptionLabel, OLD_OPTION_LABEL } from "../lib/newInvestment";
import { parseQuantity, valueFromQuote } from "../lib/quote";
import {
  bpsToInput,
  centsToInput,
  formatBRL,
  parseMoneyToCents,
  parsePercentToBps,
  todayISO,
} from "@/shared/lib/format";
import { Button, cx, ErrorBox, Field, inputClass, Notice, Switch, useConfirm } from "@/shared/ui";
import { MoneyText } from "@/shared/ui/MoneyText";
import type { Asset, AssetClass, AssetFields, AssetType, FiiSegment, Indexer, Institution } from "../types";

export interface AssetFormValues extends AssetFields {
  invested_cents: number | null;
  current_cents: number;
  valuation_date: string;
  archived: boolean;
  /** No cadastro, sempre escolhido; na edição, null quando a pessoa não mudou. */
  is_new_investment: boolean | null;
}

interface AssetFormProps {
  initial?: Asset;
  classes: AssetClass[];
  institutions: Institution[];
  /** Contas do caixa, inclusive arquivadas (a conta atual do ativo pode estar arquivada). */
  accounts: Account[];
  /** Ativos atuais (não arquivados), para avisar quando "Manter posição" muda a situação da categoria. */
  assets?: Asset[];
  pending?: boolean;
  error?: unknown;
  onSubmit: (values: AssetFormValues) => void;
  onCancel: () => void;
}

const INDEXERS: { value: Indexer; label: string }[] = [
  { value: "CDI", label: "CDI" },
  { value: "IPCA", label: "IPCA+" },
  { value: "PRE", label: "Pré-fixado" },
  { value: "SELIC", label: "Selic" },
  { value: "OUTRO", label: "Outro" },
];

/** Igual ao padrão do back-end: a conta ativa mais antiga (menor id) da instituição. */
function defaultAccountId(accounts: Account[], institutionId: number | ""): number | "" {
  const ids = accounts.filter((a) => a.institution_id === institutionId && !a.archived).map((a) => a.id);
  return ids.length > 0 ? Math.min(...ids) : "";
}

export const HOLD_HINT = "Não recebe novos aportes; continua contando na carteira e na meta da categoria.";

export function AssetForm({ initial, classes: allClasses, institutions, accounts, assets = [], pending, error, onSubmit, onCancel }: AssetFormProps) {
  const editing = Boolean(initial);
  const { confirm, dialog } = useConfirm();
  const archiveNoticeId = useId();
  const newnessErrorId = useId();
  const newnessHintId = useId();
  const firstNewnessRadio = useRef<HTMLInputElement>(null);
  // Categoria arquivada só aparece se for a do próprio ativo que está sendo editado.
  const classes = allClasses.filter((c) => !c.archived || c.key === initial?.class_key);
  const [name, setName] = useState(initial?.name ?? "");
  const [classKey, setClassKey] = useState(initial?.class_key ?? classes[0]?.key ?? "");
  const [institutionId, setInstitutionId] = useState<number | "">(initial?.institution_id ?? institutions[0]?.id ?? "");
  const [accountId, setAccountId] = useState<number | "">(() =>
    initial ? (initial.account_id ?? "") : defaultAccountId(accounts, institutions[0]?.id ?? ""),
  );
  const [ticker, setTicker] = useState(initial?.ticker ?? "");
  const [quantity, setQuantity] = useState(initial?.quantity ?? "");
  const [quote, setQuote] = useState("");
  const [indexer, setIndexer] = useState<Indexer | "">(initial?.indexer ?? "");
  const [rate, setRate] = useState(initial?.rate_bps != null ? bpsToInput(initial.rate_bps) : "");
  const [maturity, setMaturity] = useState(initial?.maturity_date ?? "");
  const [invested, setInvested] = useState(initial ? centsToInput(initial.invested_cents) : "");
  const [current, setCurrent] = useState(initial ? centsToInput(initial.current_cents) : "");
  const [valuationDate, setValuationDate] = useState(todayISO());
  const [archived, setArchived] = useState(initial?.archived ?? false);
  const [isReserve, setIsReserve] = useState(initial?.purpose === "reserva");
  const [holdOnly, setHoldOnly] = useState(initial?.hold_only ?? false);
  const [balanceIsNet, setBalanceIsNet] = useState(initial?.balance_is_net ?? false);
  const [assetType, setAssetType] = useState<AssetType | "">(initial?.asset_type ?? "");
  const [fiiSegment, setFiiSegment] = useState<FiiSegment | "">(initial?.fii_segment ?? "");
  // No cadastro começa sem escolha: novo ou antigo muda os aportes do mês, então a pessoa decide.
  const [isNew, setIsNew] = useState<boolean | null>(initial ? initial.is_new_investment : null);
  const [newnessMissing, setNewnessMissing] = useState(false);

  const isFixedIncome = classKey === "renda_fixa";
  // Ação, ETF e FII não se aplicam à renda fixa nem a cripto.
  const showType = !isFixedIncome && classKey !== "cripto";
  const isFii = showType && assetType === "fii";
  // Valor investido é opcional: vazio significa "igual ao atual" (a rentabilidade conta a partir de hoje).
  const investedCents = invested.trim() === "" ? null : parseMoneyToCents(invested);
  const currentCents = parseMoneyToCents(current);
  const rateBps = rate.trim() === "" ? null : parsePercentToBps(rate);
  // Só contas ativas da instituição; na edição, a conta atual aparece mesmo arquivada.
  const accountOptions = accounts
    .filter((a) => a.institution_id === institutionId && (!a.archived || a.id === initial?.account_id))
    .sort((a, b) => a.id - b.id);
  const selectedAccount = accountOptions.find((a) => a.id === accountId);
  // O back-end recusa marcar ativo arquivado ou da reserva (que já fica fora das metas): os dois
  // desligam a marca ao salvar.
  const holdToSave = archived || isReserve ? false : holdOnly;
  const holdNotice = holdChangeNotice(
    assets,
    { id: initial?.id ?? null, class_key: classKey, hold_only: holdToSave, archived, purpose: isReserve ? "reserva" : null },
    classes.find((c) => c.key === classKey)?.name ?? "A categoria",
  );

  const problems = {
    name: name.trim() === "" ? "Informe o nome do ativo." : null,
    institution: institutions.length === 0 ? "Cadastre uma instituição primeiro." : null,
    invested: invested.trim() !== "" && investedCents === null ? "Valor inválido." : null,
    current: currentCents === null ? "Valor inválido." : null,
    rate: rate.trim() !== "" && rateBps === null ? "Taxa inválida." : null,
    segment: isFii && fiiSegment === "" ? "Escolha papel ou tijolo." : null,
  };
  const valid = !problems.segment && !problems.name && !problems.institution && institutionId !== "" && (editing || (!problems.invested && !problems.current)) && !problems.rate;

  // Quantidade × cotação preenche o valor atual (que continua editável).
  function fillFromQuote(quantityText: string, quoteText: string) {
    const cents = valueFromQuote(quantityText, quoteText);
    if (cents !== null) setCurrent(centsToInput(cents));
  }

  function changeInstitution(value: number | "") {
    setInstitutionId(value);
    // Voltar à instituição original na edição devolve a conta original; senão, a conta padrão da nova.
    setAccountId(initial && value === initial.institution_id ? (initial.account_id ?? "") : defaultAccountId(accounts, value));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    if (isNew === null) {
      setNewnessMissing(true);
      firstNewnessRadio.current?.focus();
      return;
    }
    if (initial && !initial.archived && archived) {
      // Com saldo, o valor some do patrimônio e o histórico o mostra como saída "Ativos arquivados"; quem de fato tirou o
      // dinheiro deve registrar o resgate antes, senão a saída não conta como resgate.
      const effect =
        initial.current_cents > 0
          ? `${formatBRL(initial.current_cents)} sai do patrimônio atual e aparece no histórico como saída "Ativos arquivados" (não é perda). Se você retirou esse dinheiro, cancele e use "Resgatar" antes de arquivar. O rendimento passado é recalculado sem o ativo.`
          : "O rendimento passado é recalculado sem o ativo.";
      const ok = await confirm({
        title: `Arquivar ${initial.name}?`,
        message: `${effect} Você pode desarquivar depois em Mostrar arquivados.`,
        confirmLabel: "Arquivar ativo",
      });
      if (!ok) return;
    }
    const chosenAccount = selectedAccount ? selectedAccount.id : null;
    onSubmit({
      name: name.trim(),
      class_key: classKey,
      institution_id: Number(institutionId),
      // Na edição, null mantém a conta: só manda o id quando a pessoa trocou (evita 409 sem motivo).
      account_id: initial && chosenAccount === initial.account_id ? null : chosenAccount,
      ticker: ticker.trim() || null,
      quantity: quantity.trim() || null,
      indexer: isFixedIncome && indexer ? indexer : null,
      rate_bps: isFixedIncome ? rateBps : null,
      maturity_date: isFixedIncome && maturity ? maturity : null,
      invested_cents: investedCents,
      current_cents: currentCents ?? 0,
      valuation_date: valuationDate,
      archived,
      purpose: isReserve ? "reserva" : null,
      hold_only: holdToSave,
      // O IR só entra na conversa da renda fixa: ao trocar de categoria, a marca não fica escondida.
      balance_is_net: isFixedIncome && balanceIsNet,
      asset_type: showType && assetType !== "" ? assetType : null,
      fii_segment: isFii && fiiSegment !== "" ? fiiSegment : null,
      // Na edição, só manda quando a pessoa trocou (null mantém).
      is_new_investment: initial && isNew === initial.is_new_investment ? null : isNew,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {dialog}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" className="sm:col-span-2">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: CDB Banco X 110% CDI" autoFocus />
        </Field>

        <Field label="Categoria">
          <select className={inputClass} value={classKey} onChange={(e) => setClassKey(e.target.value)}>
            {classes.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Instituição" error={problems.institution}>
          <select
            className={inputClass}
            value={institutionId}
            onChange={(e) => changeInstitution(e.target.value === "" ? "" : Number(e.target.value))}
          >
            {institutions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>

        {/* Visível mesmo com uma conta só: mostra por qual caixa o dinheiro deste ativo passa. */}
        {accountOptions.length > 0 && (
          <Field
            label="Conta"
            className="sm:col-span-2"
            hint={
              selectedAccount
                ? `${selectedAccount.cash_enabled ? "Caixa ativado" : "Caixa não ativado"}. Aportes e compras deste ativo passam pelo caixa desta conta.` +
                  // Avisa antes de salvar o que o back-end recusaria com 409.
                  (editing ? " Se este ativo já tem lançamentos no caixa, a conta não pode ser trocada." : "")
                : undefined
            }
          >
            <select className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value === "" ? "" : Number(e.target.value))}>
              {accountId === "" && <option value="">Escolha</option>}
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.archived ? `${a.name} (arquivada)` : a.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {isFixedIncome ? (
          <>
            <Field label="Indexador">
              <select className={inputClass} value={indexer} onChange={(e) => setIndexer(e.target.value as Indexer | "")}>
                <option value="">—</option>
                {INDEXERS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={indexer === "CDI" ? "Taxa (% do CDI)" : "Taxa (% a.a.)"} error={problems.rate}>
              <input className={`${inputClass} tabular`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Ex.: 110" />
            </Field>
            <Field label="Vencimento" className="sm:col-span-2">
              <input type="date" className={inputClass} value={maturity} onChange={(e) => setMaturity(e.target.value)} />
            </Field>
            <Switch
              className="sm:col-span-2"
              label="Saldo já com o IR descontado"
              checked={balanceIsNet}
              onChange={setBalanceIsNet}
              hint="Ligue se o saldo que você digita já vem líquido na conta, como na Caixinha do Mercado Pago. Desligado, vale como bruto, como no Tesouro Reserva. O app não calcula imposto: usa isso só para rotular o % do CDI."
            />
          </>
        ) : (
          <>
            {showType && (
              <Field label="Tipo do ativo">
                <select
                  className={inputClass}
                  value={assetType}
                  onChange={(e) => {
                    setAssetType(e.target.value as AssetType | "");
                    if (e.target.value !== "fii") setFiiSegment("");
                  }}
                >
                  <option value="">Não definido</option>
                  <option value="acao">Ação</option>
                  <option value="etf">ETF</option>
                  <option value="fii">Fundo imobiliário (FII)</option>
                </select>
              </Field>
            )}
            {isFii && (
              <Field label="Segmento do fundo" error={problems.segment}>
                <select className={inputClass} value={fiiSegment} onChange={(e) => setFiiSegment(e.target.value as FiiSegment | "")}>
                  <option value="">Escolha</option>
                  <option value="papel">Papel (CRIs e recebíveis)</option>
                  <option value="tijolo">Tijolo (imóveis físicos)</option>
                </select>
              </Field>
            )}
            <Field label="Ticker">
              <input className={inputClass} value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ex.: PETR4, BTC" />
            </Field>
            <Field label="Quantidade">
              <input
                className={`${inputClass} tabular`}
                inputMode="decimal"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  fillFromQuote(e.target.value, quote);
                }}
                placeholder="Ex.: 10 ou 0.0025"
              />
            </Field>
            {!editing && parseQuantity(quantity) !== null && (
              <Field
                label="Cotação (R$ por cota ou unidade), opcional"
                hint="Preenche o valor atual: quantidade × cotação. Evita digitar o preço de uma cota no lugar do total."
                error={quote.trim() !== "" && valueFromQuote(quantity, quote) === null ? "Cotação inválida." : null}
                className="sm:col-span-2"
              >
                <input
                  className={`${inputClass} tabular`}
                  inputMode="decimal"
                  aria-label="Cotação"
                  value={quote}
                  onChange={(e) => {
                    setQuote(e.target.value);
                    fillFromQuote(quantity, e.target.value);
                  }}
                  placeholder="Ex.: 106,50"
                />
              </Field>
            )}
          </>
        )}

        {!editing && (
          <>
            <Field
              label="Valor investido (R$), opcional"
              error={problems.invested}
              hint="Não sabe quanto colocou? Deixe vazio: usamos o valor atual e a rentabilidade conta a partir de hoje."
            >
              <input className={`${inputClass} tabular`} inputMode="decimal" value={invested} onChange={(e) => setInvested(e.target.value)} placeholder="igual ao atual" />
            </Field>
            <Field label="Valor atual (R$)" error={current !== "" ? problems.current : null}>
              <input className={`${inputClass} tabular`} inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="0,00" />
            </Field>
            <Field label="Data dos valores" className="sm:col-span-2">
              <input type="date" className={inputClass} value={valuationDate} onChange={(e) => setValuationDate(e.target.value)} />
            </Field>
          </>
        )}
      </div>

      <fieldset
        className="space-y-2"
        aria-invalid={newnessMissing && isNew === null ? true : undefined}
        aria-describedby={cx(newnessMissing && isNew === null && newnessErrorId, editing && newnessHintId) || undefined}
      >
        <legend className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Esse investimento é…</legend>
        {[
          { value: true, label: newOptionLabel(initial ? initial.initial_contribution_date : valuationDate) },
          { value: false, label: OLD_OPTION_LABEL },
        ].map((option, index) => (
          <label
            key={String(option.value)}
            className={cx(
              "flex min-h-10 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition",
              isNew === option.value
                ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-400/10"
                : "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800",
            )}
          >
            <input
              ref={index === 0 ? firstNewnessRadio : undefined}
              type="radio"
              name="is-new-investment"
              checked={isNew === option.value}
              onChange={() => {
                setIsNew(option.value);
                setNewnessMissing(false);
              }}
              className="mt-0.5 size-4 shrink-0 accent-blue-500"
            />
            <span>{option.label}</span>
          </label>
        ))}
        {newnessMissing && isNew === null && (
          <p id={newnessErrorId} className="text-xs text-red-600 dark:text-red-400">
            {NEWNESS_REQUIRED}
          </p>
        )}
        {initial && isNew !== null && (
          <p id={newnessHintId} aria-live="polite" className="text-xs text-slate-600 dark:text-slate-400">
            <MoneyText parts={newnessEffect(initial, isNew)} />
          </p>
        )}
      </fieldset>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={isReserve} onChange={(e) => setIsReserve(e.target.checked)} className="mt-0.5 size-4 accent-blue-500" />
        <span>
          Faz parte da reserva de emergência
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            Conta para a meta da reserva e fica fora do rebalanceamento das categorias.
          </span>
        </span>
      </label>

      {!isReserve && (
        <div className="space-y-2">
          <Switch
            label="Manter posição"
            checked={holdToSave}
            onChange={setHoldOnly}
            hint={HOLD_HINT}
            disabled={archived}
            disabledReason="Ativo arquivado não pode ser mantido."
          />
          {/* Região viva sempre presente, para o leitor de tela anunciar o aviso quando ele aparece. */}
          <div role="status">{holdNotice && <Notice>{holdNotice}</Notice>}</div>
        </div>
      )}

      {editing && (
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
              aria-describedby={archived && !initial?.archived ? archiveNoticeId : undefined}
              className="mt-0.5 size-4 accent-blue-500"
            />
            <span>
              Arquivar ativo
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {initial?.archived
                  ? "Este ativo está arquivado. Desmarque para devolvê-lo à carteira atual."
                  : "Para o que você vendeu ou resgatou por inteiro. Não apaga o histórico."}
              </span>
            </span>
          </label>
          {archived && !initial?.archived && (
            <div id={archiveNoticeId}>
              <Notice tone="warn">
                <span className="block font-medium">Ao salvar, este ativo:</span>
                <span className="block">• sai do patrimônio atual e do rebalanceamento e plano do mês;</span>
                <span className="block">• sai do "Salário do seu dinheiro", inclusive dos meses passados, e do "% do CDI por ativo";</span>
                <span className="block">• deixa de aceitar aporte, provento e transferência;</span>
                <span className="block">
                  • se ainda tem saldo, ele sai do patrimônio e aparece no Histórico como saída "Ativos arquivados". Para registrar uma
                  retirada de dinheiro, use "Resgatar" antes de arquivar.
                </span>
                <span className="mt-1 block">
                  Os fechamentos já registrados no Histórico não mudam. Para desfazer: Mostrar arquivados &gt; Editar &gt; desmarcar
                  "Arquivar ativo".
                </span>
              </Notice>
            </div>
          )}
        </div>
      )}

      <ErrorBox error={error} />

      <div className="flex gap-2">
        <Button type="submit" disabled={!valid || pending}>
          {editing ? "Salvar alterações" : "Adicionar ativo"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
