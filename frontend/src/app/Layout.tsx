import type { ComponentType, ReactNode, SVGProps } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { EarningsCelebrator } from "@/features/earnings";
import { useSystemStatus } from "@/features/system";
import { currentMonth, formatMonth } from "@/shared/lib/format";
import { cx } from "@/shared/ui";
import { CelebrationHost } from "@/shared/ui/Celebration";
import {
  BarsIcon,
  CoinsIcon,
  EyeIcon,
  EyeOffIcon,
  GearIcon,
  HomeIcon,
  LogoMark,
  MoonIcon,
  PieIcon,
  SunIcon,
  TargetIcon,
  TrendIcon,
} from "@/shared/ui/icons";
import { useIsDark, usePreferences } from "@/shared/lib/preferences";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

interface NavItem {
  to: string;
  label: string;
  /** Rótulo curto da barra inferior (cabe em 60 px sem cortar). */
  short: string;
  icon: Icon;
  end?: boolean;
  /** Seções aninhadas: aparecem no menu lateral quando a pessoa está nesta área. */
  children?: { to: string; label: string; end?: boolean }[];
}

const links: NavItem[] = [
  { to: "/", label: "Visão geral", short: "Visão", icon: HomeIcon, end: true },
  { to: "/aporte", label: "Aporte do mês", short: "Aporte", icon: CoinsIcon },
  {
    to: "/carteira",
    label: "Carteira",
    short: "Carteira",
    icon: PieIcon,
    children: [
      { to: "/carteira", label: "Resumo", end: true },
      { to: "/carteira/ativos", label: "Ativos" },
      { to: "/carteira/movimentacoes", label: "Movimentações" },
      { to: "/carteira/retiradas", label: "Retiradas" },
      { to: "/carteira/contas", label: "Contas e caixa" },
    ],
  },
  { to: "/historico", label: "Histórico", short: "Histórico", icon: BarsIcon },
  { to: "/trajetoria", label: "Trajetória", short: "Trajetória", icon: TrendIcon },
  { to: "/metas", label: "Metas", short: "Metas", icon: TargetIcon },
];

const TITLES: Record<string, string> = {
  "/": "Visão geral",
  "/aporte": "Aporte do mês",
  "/carteira": "Carteira",
  "/carteira/ativos": "Carteira · Ativos",
  "/carteira/movimentacoes": "Carteira · Movimentações",
  "/carteira/retiradas": "Carteira · Retiradas",
  "/carteira/atualizar":"Carteira · Atualizar saldos",
  "/carteira/fechamento": "Carteira · Fechamento do mês",
  "/carteira/contas": "Carteira · Contas e caixa",
  "/historico": "Histórico",
  "/trajetoria": "Trajetória",
  "/metas": "Metas",
  "/configuracoes": "Configurações",
};

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-full text-ink" aria-label="Investment Lab, ir para a visão geral">
      <LogoMark />
      <span className="font-serif text-xl">
        investment <span className="text-gold">lab</span>
      </span>
    </Link>
  );
}

/** Item do menu lateral: o ativo é uma pílula de cartão com sombra suave e um traço de tinta (o tom sozinho quase não se vê). */
function sideLinkClass(isActive: boolean) {
  return cx(
    "relative flex min-h-12 items-center gap-3 rounded-full px-4 text-base font-medium transition-colors duration-150",
    isActive ? "bg-card text-ink shadow-soft" : "text-ink-2 hover:bg-card/60",
  );
}

/** Marcador do item ativo: não depende de cor nem de tom, aparece nos dois temas. `side` = menu lateral, `bottom` = barra do celular. */
function ActiveMarker({ placement }: { placement: "side" | "bottom" }) {
  return (
    <span
      aria-hidden
      data-active-marker
      className={cx(
        "absolute rounded-full bg-ink",
        placement === "side" ? "left-2 top-1/2 h-5 w-1 -translate-y-1/2" : "left-1/2 top-1 h-1 w-6 -translate-x-1/2",
      )}
    />
  );
}

const iconButton =
  "inline-flex size-11 items-center justify-center rounded-full bg-raise text-ink-2 transition-colors duration-150 hover:bg-soil";

function TopBar() {
  const location = useLocation();
  const { hidden, toggleHidden, theme, setTheme } = usePreferences();
  const dark = useIsDark();
  const status = useSystemStatus();
  const title =
    TITLES[location.pathname] ?? (location.pathname.startsWith("/carteira/contas/") ? "Carteira · Conta e extrato" : "Investment Lab");

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 bg-ground/90 px-4 py-3 backdrop-blur sm:px-8">
      <p className="min-w-0 flex-1 truncate text-base font-medium text-ink-2">{title}</p>

      {status.data?.demo && (
        <span
          role="status"
          className="order-last inline-flex items-center gap-2 rounded-full bg-gold-t px-3.5 py-1.5 text-xs font-medium text-ink sm:order-none"
          title="Os valores desta tela são fictícios. Seus dados reais não estão sendo usados."
        >
          <span aria-hidden className="size-2 rounded-full bg-gold" />
          Modo demonstração
        </span>
      )}

      <span className="hidden rounded-full bg-raise px-3.5 py-1.5 text-sm text-ink-2 sm:inline-block" title="Mês em foco">
        {formatMonth(currentMonth())}
      </span>

      <button
        type="button"
        onClick={toggleHidden}
        aria-pressed={hidden}
        aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}
        title={hidden ? "Mostrar valores" : "Ocultar valores"}
        className={iconButton}
      >
        {hidden ? <EyeOffIcon /> : <EyeIcon />}
      </button>

      <button
        type="button"
        onClick={() => setTheme(dark ? "light" : "dark")}
        aria-label={dark ? "Usar tema claro" : "Usar tema escuro"}
        title={dark ? "Tema claro" : "Tema escuro"}
        className={iconButton}
        data-theme-choice={theme}
      >
        {dark ? <SunIcon /> : <MoonIcon />}
      </button>

      {/* No desktop, Configurações fica no rodapé do menu lateral. */}
      <NavLink to="/configuracoes" aria-label="Configurações" title="Configurações" className={cx(iconButton, "lg:hidden")}>
        <GearIcon />
      </NavLink>
    </header>
  );
}

/**
 * Estrutura do app: menu lateral (soil), barra superior, conteúdo e barra inferior no celular.
 *
 * `aside` é a região opcional à direita (gaveta ou painel lateral), reservada para recursos que ainda
 * não existem. Sem ela, nada é desenhado e a grade continua de duas colunas; com ela, vira a terceira
 * coluna a partir de lg, sem mexer no resto da estrutura.
 */
export function Layout({ aside }: { aside?: ReactNode } = {}) {
  const { pathname } = useLocation();
  return (
    <div className={cx("min-h-screen lg:grid", aside ? "lg:grid-cols-[17rem_minmax(0,1fr)_auto]" : "lg:grid-cols-[17rem_minmax(0,1fr)]")}>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-5 focus:py-3 focus:text-card"
      >
        Pular para o conteúdo
      </a>

      <aside className="hidden bg-soil lg:flex lg:flex-col">
        <div className="sticky top-0 flex h-screen flex-col overflow-y-auto px-5 py-7">
          <div className="px-2">
            <Brand />
          </div>
          <nav aria-label="Principal" className="mt-10 flex flex-col gap-1">
            {links.map(({ to, label, icon: Icon, end, children }) => (
              <div key={to}>
                <NavLink
                  to={to}
                  end={end}
                  aria-expanded={children ? pathname.startsWith(to) : undefined}
                  className={({ isActive }) => sideLinkClass(isActive)}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <ActiveMarker placement="side" />}
                      <Icon />
                      {label}
                    </>
                  )}
                </NavLink>
                {children && pathname.startsWith(to) && (
                  <ul className="rise ml-6 mt-1 space-y-0.5 pl-4">
                    {children.map((child) => (
                      <li key={child.to}>
                        <NavLink
                          to={child.to}
                          end={child.end}
                          className={({ isActive }) =>
                            cx(
                              "flex min-h-10 items-center gap-2 rounded-full px-3 text-sm transition-colors duration-150",
                              isActive ? "font-semibold text-ink" : "text-ink-2 hover:bg-card/60",
                            )
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <span aria-hidden className={cx("size-1.5 rounded-full", isActive ? "bg-gold" : "bg-transparent")} />
                              {child.label}
                            </>
                          )}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </nav>

          <div className="mt-auto space-y-4 pt-6">
            <NavLink to="/configuracoes" className={({ isActive }) => sideLinkClass(isActive)}>
              {({ isActive }) => (
                <>
                  {isActive && <ActiveMarker placement="side" />}
                  <GearIcon />
                  Configurações
                </>
              )}
            </NavLink>
            <p className="px-4 text-xs leading-relaxed text-ink-2">Seus dados ficam só neste dispositivo.</p>
          </div>
        </div>
      </aside>

      <div className="min-w-0 pb-24 lg:pb-0">
        <div className="lg:hidden">
          <div className="flex items-center px-4 pt-4">
            <Brand />
          </div>
        </div>
        <TopBar />
        <main id="conteudo" className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
          <Outlet />
        </main>
      </div>

      {aside}

      <CelebrationHost />
      <EarningsCelebrator />

      <nav
        aria-label="Principal (celular)"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 bg-soil px-1 pb-2 pt-1.5 lg:hidden"
      >
        {links.map(({ to, label, short, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            aria-label={label}
            className={({ isActive }) =>
              cx(
                "relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-field text-xs font-medium tracking-tight transition-colors duration-150",
                isActive ? "bg-card font-semibold text-ink shadow-soft" : "text-ink-2",
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <ActiveMarker placement="bottom" />}
                <Icon className="size-5" />
                <span>{short}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
