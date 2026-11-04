import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AdjustedTargetNotes,
  comparisonSections,
  groupHoldNote,
  targetShareOfPortfolio,
  useComparison,
  type Comparison,
  type ComparisonGroup,
  type ComparisonItem,
} from "@/features/allocation";
import { formatPercent } from "@/shared/lib/format";
import { Badge, Card, cx, Empty, ErrorBox, Loading, Money } from "@/shared/ui";
import { ChevronIcon } from "@/shared/ui/icons";
import { PebbleBar } from "@/shared/ui/PebbleBar";
import { Ring } from "@/shared/ui/Ring";
import { biggestShortfall, gapFromTarget } from "../lib/allocationRows";

const ROW = "block rounded-field px-3 py-3";

type Line = Pick<ComparisonItem, "color" | "current_bps" | "current_cents" | "hold_status" | "effective_target_bps">;

/** Os números de uma linha: valor, "% · meta %", o selo de pontos e a barra seixo com o círculo da meta. */
function RowBody({
  name,
  line,
  comparison,
  attention,
  groupTarget,
  note,
  title,
}: {
  name: string;
  line: Line;
  comparison: Comparison;
  attention: boolean;
  groupTarget?: boolean;
  note?: string;
  /** Troca o nome simples por outro elemento com o mesmo texto (o botão que abre o grupo): o nome não se repete na linha. */
  title?: ReactNode;
}) {
  const held = line.hold_status === "all";
  const gap = gapFromTarget(line, comparison);
  const targetMark = targetShareOfPortfolio(line, comparison);
  return (
    <>
      <span className="flex items-baseline justify-between gap-3">
        {title ?? <span className="min-w-0 truncate font-medium">{name}</span>}
        <Money cents={line.current_cents} className="shrink-0 font-medium" />
      </span>
      <span className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="tabular text-sm text-ink-2">
          {formatPercent(line.current_bps)}
          {held ? " · meta suspensa" : ` · meta ${formatPercent(line.effective_target_bps)}`}
          {groupTarget && !held && <span className="sr-only">, soma das metas das categorias</span>}
        </span>
        {held ? <Badge>sem aporte</Badge> : gap.text && <Badge tone={attention ? "warn" : "neutral"}>{gap.text}</Badge>}
      </span>
      <PebbleBar
        role="img"
        valueBps={line.current_bps}
        targetBps={targetMark ?? undefined}
        color={line.color}
        className="mt-2.5"
        label={
          held
            ? `${name}: ${formatPercent(line.current_bps)} da carteira; mantida, meta suspensa`
            : `${name}: ${formatPercent(line.current_bps)} da carteira, meta ${formatPercent(targetMark ?? line.effective_target_bps)}`
        }
      />
      {note && <span className="mt-1.5 block text-sm text-ink-3">{note}</span>}
    </>
  );
}

function ClassLinkRow({
  item,
  comparison,
  attention,
  nested,
}: {
  item: ComparisonItem;
  comparison: Comparison;
  attention: boolean;
  nested?: boolean;
}) {
  const held = item.hold_status === "all";
  return (
    <li>
      <Link to={`/carteira/ativos?categoria=${item.class_key}`} className={cx(ROW, "hover:bg-raise", nested && "pl-4")}>
        <RowBody
          name={item.class_name}
          line={item}
          comparison={comparison}
          attention={attention}
          note={held ? (nested ? "Mantida, sem novos aportes" : "Mantida: meta suspensa") : undefined}
        />
      </Link>
    </li>
  );
}

/** Linha do grupo: subtotal das categorias dele e botão que abre as categorias. */
function GroupBlock({ group, items, comparison, attention }: { group: ComparisonGroup; items: ComparisonItem[]; comparison: Comparison; attention: string | null }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const note = groupHoldNote(items);
  return (
    <li>
      <div className={cx(ROW, "bg-raise")}>
        <RowBody
          name={group.name}
          title={
            <button
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen((value) => !value)}
              className="flex min-h-10 min-w-0 items-center gap-2 rounded-full text-left font-medium"
            >
              <ChevronIcon className={cx("size-4 shrink-0 transition-transform duration-150", open && "rotate-90")} />
              <span className="min-w-0 truncate">{group.name}</span>
            </button>
          }
          line={group}
          comparison={comparison}
          attention={false}
          groupTarget
          note={`Grupo · ${items.length} ${items.length === 1 ? "categoria" : "categorias"}${note ? ` · ${note}` : ""}`}
        />
      </div>
      <ul id={listId} hidden={!open} aria-label={`Categorias de ${group.name}`} className="mt-1 space-y-1 pl-3">
        {items.map((item) => (
          <ClassLinkRow key={item.class_key} item={item} comparison={comparison} attention={attention === item.class_key} nested />
        ))}
      </ul>
    </li>
  );
}

/**
 * Carteira real contra a meta, por categoria: a rosca mostra como o dinheiro se divide e cada linha diz quanto a
 * categoria está acima ou abaixo da meta. Só a que mais falta ganha o selo de atenção. As de um grupo ficam sob a
 * linha dele (recolhida por padrão: é a leitura rápida).
 */
export function AllocationCard() {
  const comparison = useComparison();
  const data = comparison.data;
  const sections = data ? comparisonSections(data) : [];
  const hasGroups = sections.some((s) => s.kind === "group");
  const shortfall = data ? biggestShortfall(data.items, data) : null;

  const slices = sections.map((s) => {
    const source = s.kind === "item" ? s.item : s.group;
    return { key: s.kind === "item" ? s.item.class_key : `group-${s.group.group_id}`, value: source.current_cents, color: source.color, name: s.kind === "item" ? s.item.class_name : s.group.name, bps: source.current_bps };
  });

  return (
    <Card title="Carteira real e meta">
      {comparison.isLoading && <Loading />}
      <ErrorBox error={comparison.error} />
      {data && data.total_cents === 0 && <Empty>Sem investimentos para comparar com a meta.</Empty>}
      {data && data.total_cents > 0 && (
        <>
          <p className="mb-6 max-w-3xl text-base text-ink-2">
            % da carteira toda contra a meta do plano “{data.plan_name}”, sem a reserva de emergência. Toque numa categoria para ver os
            ativos.
            {hasGroups && " Use a seta do grupo para ver as categorias dele; a meta do grupo é a soma das metas delas."}
          </p>
          <div className="grid items-center gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <Ring
              slices={slices}
              label={`Carteira real por categoria: ${slices.map((s) => `${s.name} ${formatPercent(s.bps)}`).join("; ")}.`}
            >
              <span className="text-sm text-ink-2">Carteira real</span>
              <Money cents={data.total_cents} className="font-serif text-2xl" />
            </Ring>
            <div>
              <ul className="space-y-1">
                {sections.map((section) =>
                  section.kind === "item" ? (
                    <ClassLinkRow key={section.item.class_key} item={section.item} comparison={data} attention={shortfall === section.item.class_key} />
                  ) : (
                    <GroupBlock key={`group-${section.group.group_id}`} group={section.group} items={section.items} comparison={data} attention={shortfall} />
                  ),
                )}
              </ul>
              <p className="mt-4 flex items-center gap-2 px-3 text-sm text-ink-2">
                <span aria-hidden className="size-4 shrink-0 rounded-full bg-card ring-[3px] ring-gold" />O círculo de mel marca a meta.
              </p>
            </div>
          </div>
          <AdjustedTargetNotes comparison={data} className="mt-5" />
        </>
      )}
    </Card>
  );
}
