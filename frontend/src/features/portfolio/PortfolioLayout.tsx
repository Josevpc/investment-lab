import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { NextStepBanner } from "@/features/overview";
import { ButtonLink, cx, PageHeader } from "@/shared/ui";
import { Menu, type MenuItem } from "@/shared/ui/Menu";
import { useScrollEdges } from "@/shared/ui/scrollEdges";
import { useAssets } from "./hooks";

const TABS = [
  { to: "/carteira", label: "Resumo", end: true },
  { to: "/carteira/ativos", label: "Ativos", end: false },
  { to: "/carteira/movimentacoes", label: "Movimentações", end: false },
  { to: "/carteira/retiradas", label: "Retiradas", end: false },
  { to: "/carteira/contas", label: "Contas e caixa", end: false },
] as const;

const NEEDS_ASSET = "Cadastre um ativo primeiro";

/**
 * Casca da Carteira: título, a ação principal (Atualizar saldos, a rotina semanal) e as seções
 * (Resumo, Ativos, Movimentações, Retiradas, Contas e caixa). Aporte, ativo novo e provento ficam no menu
 * "Mais ações", para a tela ter uma ação só em destaque. O fechamento mensal é rota própria e abre de dentro
 * da atualização e dos avisos do mês.
 */
export function PortfolioLayout() {
  const assets = useAssets(false);
  // Enquanto a lista carrega não dá para afirmar que não há ativos: o menu não pisca "cadastre um ativo".
  const empty = assets.isSuccess && assets.data.length === 0;
  // A faixa de seções rola no celular: a borda com mais seções esmaece.
  const { ref: tabsRef, style: tabsFade } = useScrollEdges<HTMLElement>();
  const { pathname } = useLocation();

  // No celular as seções não cabem numa linha: a aba atual rola para a vista.
  useEffect(() => {
    // Rola só a barra de abas (scrollLeft), nunca a página.
    const nav = tabsRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && active) nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.clientWidth) / 2;
  }, [pathname, tabsRef]);

  const moreActions: MenuItem[] = [
    empty
      ? { label: "Novo aporte", disabled: true, hint: NEEDS_ASSET }
      : { label: "Novo aporte", to: "/carteira/movimentacoes?novo=aporte" },
    { label: "Novo ativo", to: "/carteira/ativos?novo=1" },
    empty
      ? { label: "Registrar provento", disabled: true, hint: NEEDS_ASSET }
      : { label: "Registrar provento", to: "/carteira/movimentacoes?novo=provento" },
  ];

  return (
    <>
      <PageHeader
        title="Carteira"
        subtitle="Todos os seus ativos, de todas as instituições, em um só lugar."
        action={
          // Ação principal primeiro na ordem de tabulação; o menu abre para a esquerda, sempre dentro da tela.
          <div role="group" aria-label="Ações da carteira" className="grid w-full grid-cols-1 gap-3 min-[26rem]:grid-cols-2 sm:flex sm:w-auto">
            {/* Na própria tela de atualizar o botão levaria a ela mesma: a ação principal passa a ser a da tela. */}
            {pathname !== "/carteira/atualizar" && <ButtonLink to="/carteira/atualizar">Atualizar saldos</ButtonLink>}
            <Menu label="Mais ações" items={moreActions} />
          </div>
        }
      />

      <NextStepBanner />

      <nav ref={tabsRef} style={tabsFade} aria-label="Seções da carteira" className="relative mb-6 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-raise p-1">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cx(
                "flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors duration-150 sm:px-5",
                isActive ? "bg-ink text-card" : "text-ink-2 hover:bg-soil",
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </>
  );
}
