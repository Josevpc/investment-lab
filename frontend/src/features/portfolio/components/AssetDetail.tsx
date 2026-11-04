import { useState, type ReactNode } from "react";
import { AssetVsCdi } from "@/features/analytics";
import { formatDate, formatPercent } from "@/shared/lib/format";
import { Badge, Button, Empty, ErrorBox, Loading, Money, Tabs } from "@/shared/ui";
import { useMovements } from "../hooks";
import type { Asset, Movement } from "../types";
import { ValuationHistory } from "./ValuationHistory";

type Tab = "resumo" | "movimentos" | "historico" | "cdi";

const TABS = [
  { value: "resumo", label: "Resumo" },
  { value: "movimentos", label: "Movimentos e proventos" },
  { value: "historico", label: "Histórico de valores" },
] as const;
const CDI_TAB = { value: "cdi", label: "Desempenho vs. CDI" } as const;

const TYPE_LABEL = { acao: "Ação", etf: "ETF", fii: "Fundo imobiliário" } as const;
const SEGMENT_LABEL = { papel: "Papel", tijolo: "Tijolo" } as const;
const KIND_LABEL = { aporte: "Aporte", provento: "Provento", transferencia: "Transferência", resgate: "Resgate" } as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="tabular text-right font-medium">{children}</dd>
    </div>
  );
}

function Summary({ asset }: { asset: Asset }) {
  return (
    <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
      <Row label="Categoria">{asset.class_name}</Row>
      <Row label="Instituição">{asset.institution_name}</Row>
      <Row label="Tipo">
        {asset.asset_type ? (
          <>
            {TYPE_LABEL[asset.asset_type]}
            {asset.fii_segment && ` · ${SEGMENT_LABEL[asset.fii_segment]}`}
          </>
        ) : (
          "Sem tipo definido"
        )}
      </Row>
      {asset.ticker && <Row label="Ticker">{asset.ticker}</Row>}
      {asset.quantity && <Row label="Quantidade">{asset.quantity}</Row>}
      {asset.indexer && (
        <Row label="Indexador e taxa">
          {asset.indexer}
          {asset.rate_bps !== null && ` · ${formatPercent(asset.rate_bps)}`}
        </Row>
      )}
      {asset.maturity_date && <Row label="Vencimento">{formatDate(asset.maturity_date)}</Row>}
      <Row label="Saldo atual">
        <Money cents={asset.current_cents} />
      </Row>
      {asset.class_key === "renda_fixa" && <Row label="Tipo de saldo">{asset.balance_is_net ? "Líquido de IR" : "Bruto"}</Row>}
      <Row label="Valor investido (custo)">
        <Money cents={asset.invested_cents} />
      </Row>
      <Row label="Rendimento">
        <Money cents={asset.gain_cents} /> ({asset.return_bps == null ? "—" : formatPercent(asset.return_bps)})
      </Row>
      {asset.proventos_cents > 0 && (
        <Row label="Proventos recebidos">
          <Money cents={asset.proventos_cents} /> (retorno total {asset.total_return_bps == null ? "—" : formatPercent(asset.total_return_bps)})
        </Row>
      )}
      <Row label="Posição atualizada em">{formatDate(asset.valuation_date)}</Row>
    </dl>
  );
}

function describe(m: Movement, assetId: number): string {
  if (m.kind === "transferencia") {
    return m.asset_id === assetId ? `Recebido de ${m.related_asset_name}` : `Enviado para ${m.asset_name}`;
  }
  if (m.kind === "provento" && m.related_asset_name) return `Creditado em ${m.related_asset_name}`;
  if (m.kind === "resgate") return m.note ? `Motivo: ${m.note}` : "";
  return "";
}

function Movements({ asset }: { asset: Asset }) {
  const movements = useMovements();
  const list = (movements.data ?? []).filter((m) => m.asset_id === asset.id || m.related_asset_id === asset.id);

  return (
    <div>
      {movements.isLoading && <Loading />}
      <ErrorBox error={movements.error} />
      {movements.data && list.length === 0 && <Empty>Nenhum aporte, provento, resgate ou transferência registrado para este ativo.</Empty>}
      {list.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {list.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <Badge tone={m.kind === "provento" ? "good" : m.kind === "aporte" ? "gold" : "neutral"}>{KIND_LABEL[m.kind]}</Badge>
                <span className="ml-2 tabular">{formatDate(m.date)}</span>
                {describe(m, asset.id) && <span className="block text-xs text-slate-500 dark:text-slate-400">{describe(m, asset.id)}</span>}
              </span>
              <span className="tabular font-medium">
                {m.kind === "resgate" && "− "}
                <Money cents={m.amount_cents} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Para registrar ou desfazer movimentos, use a seção &quot;Movimentos&quot; da Carteira.
      </p>
    </div>
  );
}

/** Detalhe de um ativo: resumo, movimentos e histórico de valores, sem sair da lista. */
export function AssetDetail({ asset, onEdit }: { asset: Asset; onEdit: () => void }) {
  const [tab, setTab] = useState<Tab>("resumo");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {asset.purpose === "reserva" && <Badge tone="warn">Reserva de emergência</Badge>}{" "}
          {asset.archived && <Badge>Arquivado</Badge>}{" "}
          {asset.hold_only && <Badge>Mantido: sem novos aportes</Badge>}
        </p>
        <Button variant="secondary" onClick={onEdit}>
          Editar cadastro
        </Button>
      </div>
      <Tabs
        label="Seções do ativo"
        value={tab}
        tabs={[...TABS, CDI_TAB]}
        onChange={setTab}
      />
      {tab === "resumo" && <Summary asset={asset} />}
      {tab === "movimentos" && <Movements asset={asset} />}
      {tab === "historico" && <ValuationHistory asset={asset} />}
      {tab === "cdi" && <AssetVsCdi assetId={asset.id} />}
    </div>
  );
}
