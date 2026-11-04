import { Link } from "react-router-dom";
import {
  AdjustedTargetNotes,
  comparisonSections,
  groupHoldNote,
  HeldAssetsNotice,
  joinNames,
  useComparison,
  type Comparison,
  type ComparisonGroup,
  type ComparisonItem,
} from "@/features/allocation";
import { formatPercent } from "@/shared/lib/format";
import { Badge, ButtonLink, Card, cx, Empty, ErrorBox, Loading, Money, Swatch } from "@/shared/ui";
import { ChevronIcon } from "@/shared/ui/icons";
import { useAssets } from "../hooks";
import { assetCountLabel, assetsByClass } from "../lib/categories";
import type { Asset } from "../types";

type Surface = "raise" | "card";

const SUMMARY =
  "flex min-h-16 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 rounded-card px-4 py-3 [&::-webkit-details-marker]:hidden";

/** Falta ou sobra frente à meta, por extenso e em reais; nada na categoria toda mantida (a meta está suspensa). */
function Gap({ item }: { item: Pick<ComparisonItem, "hold_status" | "diff_cents"> }) {
  const diff = item.diff_cents;
  if (item.hold_status === "all" || diff === null) return null;
  if (diff === 0) return <span className="block text-sm text-ink-2">na meta</span>;
  return (
    <span className="block text-sm text-ink-2">
      {diff > 0 ? "sobra " : "falta "}
      <Money cents={Math.abs(diff)} className="whitespace-nowrap" />
    </span>
  );
}

function AssetCard({ asset, surface }: { asset: Asset; surface: Surface }) {
  return (
    <li className={cx("rounded-field px-4 py-3", surface === "card" ? "bg-card" : "bg-raise")}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <p className="min-w-0 flex-1 basis-44 break-words">
          <span className="font-medium">{asset.name}</span>
          {asset.purpose === "reserva" && (
            <>
              {" "}
              <Badge tone="good">Reserva</Badge>
            </>
          )}
          <span className="block text-sm text-ink-3">{asset.institution_name}</span>
        </p>
        <dl className="flex gap-6 text-base">
          <div>
            <dt className="text-sm text-ink-3">Valor atual</dt>
            <dd className="tabular font-medium">
              <Money cents={asset.current_cents} />
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-3">Investido</dt>
            <dd className="tabular">
              <Money cents={asset.invested_cents} />
            </dd>
          </div>
        </dl>
      </div>
    </li>
  );
}

function CategoryDetails({
  item,
  comparison,
  assets,
  surface,
  nested,
}: {
  item: ComparisonItem;
  comparison: Comparison;
  assets: Asset[];
  surface: Surface;
  nested?: boolean;
}) {
  const held = item.hold_status === "all";
  const partial = item.hold_status === "partial" && item.held_assets.length > 0;
  const adjusted = !held && item.effective_target_bps !== item.target_bps;
  const innerSurface: Surface = surface === "raise" ? "card" : "raise";
  const hasReserve = assets.some((a) => a.purpose === "reserva");
  return (
    <details className={cx("group/cat rounded-card", surface === "raise" ? "bg-raise" : "bg-card")}>
      <summary className={SUMMARY}>
        <ChevronIcon className="size-4 shrink-0 text-ink-3 transition-transform duration-150 group-open/cat:rotate-90" />
        <Swatch color={item.color} />
        <span className="min-w-36 flex-1">
          <span className="block break-words font-medium">{item.class_name}</span>
          <span className="block text-sm text-ink-3">{assetCountLabel(assets.length)}</span>
          {held && (
            <span className="mt-1 block">
              <Badge>{nested ? "Mantida, sem novos aportes" : "Mantida: meta suspensa"}</Badge>
            </span>
          )}
          {partial && (
            <span className="block text-sm text-ink-3">
              {joinNames(item.held_assets.map((a) => a.name))} {item.held_assets.length === 1 ? "mantido" : "mantidos"}
            </span>
          )}
        </span>
        <span className="ml-auto shrink-0 text-right">
          <span className="block font-medium">
            <Money cents={item.current_cents} />
          </span>
          <span className="tabular block text-sm text-ink-2">
            {formatPercent(item.current_bps)}
            {!held && (
              <>
                {" · meta "}
                {formatPercent(item.effective_target_bps)}
                {adjusted && (
                  <>
                    *<span className="sr-only"> (meta ajustada, veja a nota abaixo da lista)</span>
                  </>
                )}
              </>
            )}
          </span>
          <Gap item={item} />
        </span>
      </summary>
      <div className="space-y-3 px-3 pb-4 pt-1">
        {assets.length === 0 ? (
          <p className="px-1 text-base text-ink-2">Nenhum ativo nesta categoria ainda.</p>
        ) : (
          <ul aria-label={`Ativos de ${item.class_name}`} className="space-y-2">
            {assets.map((asset) => (
              <AssetCard key={asset.id} asset={asset} surface={innerSurface} />
            ))}
          </ul>
        )}
        {hasReserve && (
          <p className="px-1 text-sm text-ink-3">O valor e a participação da categoria não contam o ativo da reserva de emergência.</p>
        )}
        {comparison.total_cents > 0 && (
          <Link
            to={`/carteira/ativos?categoria=${encodeURIComponent(item.class_key)}`}
            className="inline-flex min-h-10 items-center px-1 font-medium text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink"
          >
            Ver e editar os ativos de {item.class_name}
          </Link>
        )}
      </div>
    </details>
  );
}

/** Grupo de categorias: o subtotal na linha dele e as categorias dentro, cada uma também recolhível. */
function GroupDetails({
  group,
  items,
  comparison,
  byClass,
}: {
  group: ComparisonGroup;
  items: ComparisonItem[];
  comparison: Comparison;
  byClass: Map<string, Asset[]>;
}) {
  const held = group.hold_status === "all";
  const note = groupHoldNote(items);
  const count = items.reduce((sum, item) => sum + (byClass.get(item.class_key)?.length ?? 0), 0);
  return (
    <details className="group/grp rounded-card bg-raise">
      <summary className={SUMMARY}>
        <ChevronIcon className="size-4 shrink-0 text-ink-3 transition-transform duration-150 group-open/grp:rotate-90" />
        <Swatch color={group.color} />
        <span className="min-w-36 flex-1">
          <span className="block break-words font-medium">{group.name}</span>
          <span className="block text-sm text-ink-3">
            Grupo · {items.length} {items.length === 1 ? "categoria" : "categorias"} · {assetCountLabel(count)}
          </span>
          {note && <span className="block text-sm text-ink-3">{note}</span>}
        </span>
        <span className="ml-auto shrink-0 text-right">
          <span className="block font-medium">
            <Money cents={group.current_cents} />
          </span>
          <span className="tabular block text-sm text-ink-2">
            {formatPercent(group.current_bps)}
            {held ? " · meta suspensa" : ` · meta ${formatPercent(group.effective_target_bps)}`}
            {!held && <span className="sr-only">, soma das metas das categorias</span>}
          </span>
          {!held && group.effective_target_bps !== group.target_bps && (
            <span className="block text-sm text-ink-3">soma no plano: {formatPercent(group.target_bps)}</span>
          )}
          <Gap item={group} />
        </span>
      </summary>
      <ul aria-label={`Categorias de ${group.name}`} className="space-y-2 px-1 pb-4 pt-1 sm:px-3">
        {items.map((item) => (
          <li key={item.class_key}>
            <CategoryDetails item={item} comparison={comparison} assets={byClass.get(item.class_key) ?? []} surface="card" nested />
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Carteira real por categoria, contra a meta do plano. Cada categoria abre e mostra os ativos dela (valor atual e
 * investido); as de um grupo ficam sob a linha dele. Todo percentual é da carteira toda, sem a reserva.
 */
export function CategoryBreakdown() {
  const comparison = useComparison();
  const assets = useAssets(false);
  const data = comparison.data;
  const byClass = assetsByClass(assets.data ?? []);
  const sections = data ? comparisonSections(data) : [];
  const hasGroups = sections.some((s) => s.kind === "group");

  return (
    <Card title="Sua carteira por categoria">
      {comparison.isLoading && <Loading />}
      <ErrorBox error={comparison.error} />
      <ErrorBox error={assets.error} />
      {data && data.total_cents === 0 && (
        <Empty
          action={
            <ButtonLink to="/carteira/ativos?novo=1" variant="secondary" size="sm">
              Cadastrar ativo
            </ButtonLink>
          }
        >
          Cadastre ativos para ver a carteira por categoria e a comparação com a meta.
        </Empty>
      )}
      {data && data.total_cents > 0 && (
        <div className="space-y-4">
          <p className="text-base text-ink-2">
            Percentuais da carteira toda contra a meta do plano “{data.plan_name}”, sem a reserva de emergência. Abra uma categoria
            para ver os ativos dela.
          </p>
          <HeldAssetsNotice items={data.items} />
          <ul className="space-y-3">
            {sections.map((section) =>
              section.kind === "item" ? (
                <li key={section.item.class_key}>
                  <CategoryDetails item={section.item} comparison={data} assets={byClass.get(section.item.class_key) ?? []} surface="raise" />
                </li>
              ) : (
                <li key={`group-${section.group.group_id}`}>
                  <GroupDetails group={section.group} items={section.items} comparison={data} byClass={byClass} />
                </li>
              ),
            )}
          </ul>
          <AdjustedTargetNotes comparison={data} />
          <p className="text-sm text-ink-3">
            Falta: quanto aportar para chegar à meta. Sobra: quanto a categoria passou dela.
            {hasGroups &&
              " A meta de um grupo é a soma das metas das categorias dele (só leitura: a meta se ajusta em cada categoria, em Configurações). Categorias mantidas ficam fora do falta/sobra do grupo."}
          </p>
        </div>
      )}
    </Card>
  );
}
