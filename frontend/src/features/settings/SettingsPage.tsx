import type { ReactNode } from "react";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { PlansSection } from "@/features/allocation";
import { BackupCard, OffsiteBackupCard } from "@/features/backup";
import { BenchmarksCard } from "@/features/benchmarks";
import { CategoriesCard } from "@/features/portfolio";
import { ReserveCard } from "@/features/reserve";
import { useSystemStatus } from "@/features/system";
import { formatDate } from "@/shared/lib/format";
import { type ThemeChoice, usePreferences } from "@/shared/lib/preferences";
import { Card, Field, inputClass, Loading, PageHeader, Segmented } from "@/shared/ui";

function formatDateTime(iso: string): string {
  return `${formatDate(iso.slice(0, 10))} às ${iso.slice(11, 16)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

function PreferencesCard() {
  const { theme, setTheme, hidden, setHidden, name, setName } = usePreferences();
  return (
    <Card title="Preferências">
      <div className="mb-6 max-w-sm">
        <Field label="Seu nome" hint="Usado só na saudação da Visão geral. Fica neste navegador.">
          <input
            className={inputClass}
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            placeholder="Como você quer ser chamado"
            autoComplete="given-name"
          />
        </Field>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-medium">Tema</p>
          <Segmented<ThemeChoice>
            label="Tema"
            size="md"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "dark", label: "Escuro" },
              { value: "light", label: "Claro" },
              { value: "system", label: "Como o sistema" },
            ]}
          />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Valores na tela</p>
          <Segmented<"visible" | "hidden">
            label="Visibilidade dos valores"
            size="md"
            value={hidden ? "hidden" : "visible"}
            onChange={(value) => setHidden(value === "hidden")}
            options={[
              { value: "visible", label: "Visíveis" },
              { value: "hidden", label: "Ocultos" },
            ]}
          />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Ocultar apenas desfoca números e gráficos; nada é apagado. O botão do olho na barra superior faz o mesmo.
          </p>
        </div>
      </div>
    </Card>
  );
}

function StorageCard() {
  const status = useSystemStatus();
  const s = status.data;
  return (
    <Card title="Onde ficam os dados">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Tudo fica neste computador, em um arquivo local. Nada é enviado para a nuvem; a única consulta externa é a dos índices de
        referência (CDI, Selic e Ibovespa). Antes de atualizar o app ou restaurar um backup, uma cópia do arquivo é guardada automaticamente.
      </p>
      {status.isLoading && <Loading />}
      {s && (
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-slate-400">Arquivo</dt>
            <dd className="tabular font-medium">{s.database_file ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-slate-400">Tamanho</dt>
            <dd className="tabular font-medium">{s.database_size_bytes === null ? "—" : formatBytes(s.database_size_bytes)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-slate-400">Cópias de segurança</dt>
            <dd className="tabular font-medium">{s.backups_count}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-slate-400">Última cópia</dt>
            <dd className="tabular font-medium">{s.last_backup_at ? formatDateTime(s.last_backup_at) : "nenhuma"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-slate-400">Versão do app</dt>
            <dd className="tabular font-medium">{s.version}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500 dark:text-slate-400">Versão dos dados</dt>
            <dd className="tabular font-medium">
              {s.schema_revision ?? "—"}
              {s.schema_revision !== s.expected_revision && " (precisa atualizar)"}
            </dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <h2 id={`${id}-title`} className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {title}
      </h2>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const { hash } = useLocation();

  // O menu e os links da visão geral apontam para uma seção (#planos, #reserva, #dados).
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash]);

  return (
    <>
      <PageHeader title="Configurações" subtitle="Categorias, metas, reserva, preferências e proteção dos seus dados." />
      <div className="space-y-10">
        <Section id="planos" title="Estratégia">
          <PlansSection />
          <CategoriesCard />
        </Section>
        <Section id="reserva" title="Reserva de emergência">
          <ReserveCard />
        </Section>
        <Section id="preferencias" title="Preferências">
          <PreferencesCard />
        </Section>
        <Section id="dados" title="Dados e proteção">
          <StorageCard />
          <OffsiteBackupCard />
          <BenchmarksCard />
          <BackupCard />
        </Section>
      </div>
    </>
  );
}
