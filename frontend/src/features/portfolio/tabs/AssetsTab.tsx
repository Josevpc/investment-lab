import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccounts } from "@/features/cash";
import type { MoneyTextPart } from "@/shared/lib/moneyText";
import { Button, Card, Drawer, Empty, ErrorBox, inputClass, Loading, Segmented } from "@/shared/ui";
import { MoneyText } from "@/shared/ui/MoneyText";
import { AssetDetail } from "../components/AssetDetail";
import { AssetForm, type AssetFormValues } from "../components/AssetForm";
import { AssetsByCategory } from "../components/AssetsByCategory";
import { AssetsByInstitution } from "../components/AssetsByInstitution";
import { AssetsTable } from "../components/AssetsTable";
import { InstitutionsCard } from "../components/InstitutionsCard";
import { ValuationHistory } from "../components/ValuationHistory";
import { assetSavedMessage } from "../lib/newInvestment";
import { useAssetClasses, useAssets, useCreateAsset, useInstitutions, useUpdateAsset } from "../hooks";
import type { Asset } from "../types";

type Mode = { kind: "list" } | { kind: "new" } | { kind: "edit"; asset: Asset };
type View = "category" | "institution" | "list";

/** Todos os ativos: lista com filtros, cadastro e edição. */
export function AssetsTab() {
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>(() => (params.get("novo") ? { kind: "new" } : { kind: "list" }));
  const [detailId, setDetailId] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [classFilter, setClassFilter] = useState(params.get("categoria") ?? "");
  const [typeFilter, setTypeFilter] = useState("");
  const [institutionFilter, setInstitutionFilter] = useState("");
  const [view, setView] = useState<View>("category");
  // Confirmação da edição (o cadastro novo já comemora em tela cheia).
  const [saved, setSaved] = useState<MoneyTextPart[] | null>(null);

  const classes = useAssetClasses(true);
  const institutions = useInstitutions();
  // Com arquivadas: na edição, a conta atual do ativo pode estar arquivada.
  const accounts = useAccounts(true);
  const assets = useAssets(showArchived);
  const createAsset = useCreateAsset();
  const updateAsset = useUpdateAsset();

  // "Novo ativo" (no topo da Carteira) chega como ?novo=1; abre o formulário e limpa o endereço,
  // para o próximo clique funcionar de novo.
  useEffect(() => {
    if (!params.get("novo")) return;
    setMode({ kind: "new" });
    setSaved(null);
    const next = new URLSearchParams(params);
    next.delete("novo");
    setParams(next, { replace: true });
  }, [params, setParams]);

  const backToList = () => setMode({ kind: "list" });

  function submitAsset(values: AssetFormValues) {
    const { invested_cents, current_cents, valuation_date, archived, is_new_investment, ...fields } = values;
    if (mode.kind === "edit") {
      const before = mode.asset;
      updateAsset.mutate(
        { id: before.id, input: { ...fields, archived, is_new_investment } },
        {
          onSuccess: (after) => {
            setSaved(assetSavedMessage(before, after));
            backToList();
          },
        },
      );
    } else if (is_new_investment !== null) {
      createAsset.mutate(
        { ...fields, invested_cents, current_cents, valuation_date, is_new_investment },
        {
          onSuccess: () => {
            setSaved(null);
            backToList();
          },
        },
      );
    }
  }

  const list = (assets.data ?? []).filter(
    (a) =>
      (!classFilter || a.class_key === classFilter) &&
      (!typeFilter || (typeFilter === "none" ? a.asset_type === null : a.asset_type === typeFilter)) &&
      (!institutionFilter || String(a.institution_id) === institutionFilter),
  );
  const detail = detailId === null ? undefined : (assets.data ?? []).find((a) => a.id === detailId);
  const open = (asset: Asset) => setDetailId(asset.id);

  return (
    <div className="space-y-6">
      {mode.kind === "list" && (
        <Card
          title="Ativos"
          action={
            <Segmented<View>
              label="Visão dos ativos"
              value={view}
              onChange={setView}
              options={[
                { value: "category", label: "Por categoria" },
                { value: "institution", label: "Por instituição" },
                { value: "list", label: "Lista" },
              ]}
            />
          }
        >
          {saved && (
            <p
              role="status"
              className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
            >
              <MoneyText parts={saved} />
            </p>
          )}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select aria-label="Filtrar por tipo" className={`${inputClass} w-auto!`} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">Todos os tipos</option>
              <option value="acao">Ações</option>
              <option value="etf">ETFs</option>
              <option value="fii">Fundos imobiliários</option>
              <option value="none">Sem tipo definido</option>
            </select>
            <select aria-label="Filtrar por categoria" className={`${inputClass} w-auto!`} value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
              <option value="">Todas as categorias</option>
              {classes.data?.filter((c) => !c.archived).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtrar por instituição"
              className={`${inputClass} w-auto!`}
              value={institutionFilter}
              onChange={(e) => setInstitutionFilter(e.target.value)}
            >
              <option value="">Todas as instituições</option>
              {institutions.data?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="size-4 accent-blue-500" />
              Mostrar arquivados
            </label>
          </div>

          {assets.isLoading && <Loading />}
          <ErrorBox error={assets.error} />
          {assets.data && list.length === 0 && view !== "category" && (
            <Empty>
              {assets.data.length === 0 ? (
                <>
                  Nenhum ativo ainda. Cadastre uma instituição e adicione o primeiro ativo.{" "}
                  <Button variant="secondary" className="ml-2" onClick={() => setMode({ kind: "new" })}>
                    Novo ativo
                  </Button>
                </>
              ) : (
                "Nenhum ativo com esses filtros."
              )}
            </Empty>
          )}
          {list.length > 0 && view === "list" && <AssetsTable assets={list} onOpen={open} sortable />}
          {list.length > 0 && view === "institution" && <AssetsByInstitution assets={list} onOpen={open} />}
          {assets.data && view === "category" && (
            <AssetsByCategory
              assets={list}
              allAssets={assets.data}
              categories={(classes.data ?? []).filter((c) => !classFilter || c.key === classFilter)}
              onOpen={open}
            />
          )}
        </Card>
      )}

      {/* Espera as contas para pré-selecionar a padrão; se a consulta falhar, o campo some e o back-end decide. */}
      {(mode.kind === "new" || mode.kind === "edit") && classes.data && institutions.data && (accounts.data || accounts.isError) && (
        <Card title={mode.kind === "edit" ? `Editar ${mode.asset.name}` : "Novo ativo"}>
          <AssetForm
            key={mode.kind === "edit" ? mode.asset.id : "new"}
            initial={mode.kind === "edit" ? mode.asset : undefined}
            classes={classes.data}
            institutions={institutions.data}
            accounts={accounts.data ?? []}
            assets={(assets.data ?? []).filter((a) => !a.archived)}
            pending={createAsset.isPending || updateAsset.isPending}
            error={createAsset.error ?? updateAsset.error}
            onSubmit={submitAsset}
            onCancel={backToList}
          />
        </Card>
      )}

      {mode.kind === "edit" && (
        <Card title="Histórico de valores">
          <ValuationHistory asset={mode.asset} />
        </Card>
      )}

      {mode.kind === "list" && <InstitutionsCard />}

      {detail && (
        <Drawer title={detail.name} wide onClose={() => setDetailId(null)}>
          <AssetDetail
            asset={detail}
            onEdit={() => {
              setDetailId(null);
              setSaved(null);
              setMode({ kind: "edit", asset: detail });
            }}
          />
        </Drawer>
      )}
    </div>
  );
}
