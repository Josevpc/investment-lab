# Investment Lab

Carteira unificada de investimentos: calcula o aporte mensal (percentual do salário), divide o aporte entre as classes de ativos segundo uma alocação-alvo editável, consolida os ativos de vários bancos e guarda o histórico da carteira.

O escopo completo está em [docs/PRD.md](docs/PRD.md) e o desenho das tabelas em [docs/MODELO-DE-DADOS.md](docs/MODELO-DE-DADOS.md).

## Estado atual (Fase 1, MVP)

| Feature | Back-end | Front-end |
| --- | --- | --- |
| Aporte mensal (`contributions`) | cálculo, histórico, ajuste manual, parte destinada à reserva, **plano do mês gravado** (divisão por categoria) | slider, atalhos 5% / 7,5% / 10%, reserva e cartão "Plano do mês" com o já aportado e o que falta |
| Alocação-alvo (`allocation`) | planos, divisão proporcional e por rebalanceamento (padrão), real vs. meta | rosca arrastável, sliders, travas, planos e categorias editáveis |
| Carteira (`portfolio`) | instituições, categorias, ativos (tipo ação/ETF/FII e segmento papel/tijolo), histórico de valores editável, fechamento do mês, transferências, proventos, diário de movimentos | visão por categoria, composição por tipo, histórico de valores por ativo, fechamento do mês, movimentações, real vs. meta |
| Histórico (`history`) | snapshots da carteira ou digitados, edição, evolução, aportes vs. valorização | gráficos de valor e de participação (%) por categoria, lançamento manual do passado |
| Reserva de emergência (`reserve`) | meta fixa, progresso, sugestão pela média dos salários | cartão na Carteira e campo na tela de aporte |
| Trajetória (`analytics`) | simulação mês a mês dos aportes rumo à meta | tela "Trajetória" com a participação de cada categoria no tempo |
| Desempenho x CDI/Selic (`analytics`, `benchmarks`) | retorno acumulado encadeado que neutraliza aportes, taxas mensais do Banco Central, avisos de dados insuficientes | aba Histórico → Desempenho, resumo na Visão geral |
| % do CDI por ativo (`analytics`, `benchmarks`) | CDI diário do Banco Central, saldos observados, aportes com data, período livre | aba "Desempenho vs. CDI" do ativo e tabela em Histórico → Desempenho |
| Backup e ambiente (`backup`, `system`) | exportar, conferir, restaurar e reiniciar em uma transação, com cópia de segurança do arquivo | Configurações → Dados e proteção, chip "Dados neste dispositivo" |
| Metas e projeção (`goals`) | sequência mensal, meta de patrimônio e do ano, projeção em três cenários com taxa única e inflação | tela "Metas", mascote e celebrações |
| Salário do seu dinheiro (`earnings`) | rendimento por mês a partir dos saldos, ritmo por dia, % do salário, marcos | cartão na Visão geral e em Metas, gráfico de minutos de trabalho |
| Caixa das contas (`cash`) | saldo por conta, depósito, retirada, taxa, ajuste, compra com o caixa, conciliação; fora do patrimônio | Carteira → Contas e caixa |
| Comparativos mês a mês e ano a ano, projeção por categoria | não implementado | não implementado |

### Modo demonstração

Dê dois cliques em **[demonstracao.bat](demonstracao.bat)** para ver o app com dados fictícios, num banco separado (`data\demo`) e na porta 8001, com o selo "Modo demonstração". Seus dados reais não são abertos. `demonstracao.bat -Reset` recria só os dados de exemplo.

### Telas

Visual e navegação seguem [design/investment-lab-ux-ui.md](design/investment-lab-ux-ui.md): tema escuro (carvão e dourado) ou claro (marfim), botão do olho para ocultar valores, menu lateral (Visão geral, Aporte do mês, Carteira, Histórico, Trajetória, Metas) e **Configurações** (categorias, planos, reserva, preferências, CDI/Selic, backup). Os endereços antigos (`/portfolio`, `/history`, `/trajectory`, `/allocation`) redirecionam.

## Como rodar

Requisitos: Python 3.12+ (testado com 3.14) e Node 20+ (testado com 24). Os dois instalam com
`winget install Python.Python.3.14` e `winget install OpenJS.NodeJS.LTS`.

### Jeito rápido: um clique

Dê dois cliques em **[iniciar.bat](iniciar.bat)** (ou rode `.\iniciar.bat` no terminal). Ele faz tudo:

1. cria o ambiente Python e instala as dependências do back-end, na primeira vez e quando elas mudam;
2. instala as dependências do front-end e **compila a tela**, na primeira vez e quando o código da tela mudar;
3. sobe **um único servidor**, em que a API também serve a tela, e abre o navegador em http://localhost:8000.

Para encerrar, feche a janela ou pressione Ctrl+C. Se o Investment Lab já estiver rodando, o atalho só
abre o navegador. Opções: `.\iniciar.bat -Port 9000` (outra porta), `-NoBrowser` (não abre o navegador) e
`-Rebuild` (recompila a tela mesmo que pareça atualizada).

Ao subir, a API aplica as migrações do banco, com backup automático em `data/backups/`, e cria os dados
iniciais. O banco fica em `data/investment.db`. A documentação interativa da API está em
http://localhost:8000/docs.

### Para desenvolver

**[desenvolver.bat](desenvolver.bat)** abre a API com recarga automática (porta 8000) e a tela com hot
reload (porta 5173) em duas janelas, e abre http://localhost:5173. Ou, manualmente:

```powershell
# API (porta 8000)
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
.\.venv\Scripts\python -m uvicorn app.main:app --reload

# Tela (porta 5173), em outro terminal
cd frontend
npm install
npm run dev
```

Nesse modo o Vite encaminha `/api` para a API local.

## Testes e qualidade

```powershell
cd backend;  .\.venv\Scripts\python -m pytest ; .\.venv\Scripts\python -m ruff check app tests
cd frontend; npm test ; npm run build
```

## Convenções

- **Dinheiro** em centavos inteiros (`*_cents`) e **percentuais** em pontos-base (`*_bps`, 1% = 100), em toda a API e no banco. Não há `float` em valores monetários.
- **Feature-based**: cada feature tem o mesmo nome no back-end (`backend/app/features/<feature>`) e no front-end (`frontend/src/features/<feature>`). Uma feature só usa outra pela interface pública (`service` no back, `index.ts` no front).
- **Migrações**: `cd backend; .\.venv\Scripts\python -m alembic revision --autogenerate -m "descrição"`.
- **Configuração** por variáveis de ambiente (veja [.env.example](.env.example)), preparada para rodar em Docker no futuro.

## Memória do projeto (Basic Memory)

O contexto do projeto (decisões de domínio, modelo de dados, preferências e tarefas) fica em notas do
[Basic Memory](https://github.com/basicmachines-co/basic-memory), na pasta `investment-lab` do projeto
`main` (cofre em `~/basic-memory`). O servidor MCP está registrado em [.mcp.json](.mcp.json); o Claude
Code pede aprovação na primeira vez que o encontra. Pela linha de comando:

```powershell
basic-memory tool build-context "memory://main/investment-lab/investment-lab" --project main --local
basic-memory tool search-notes "reserva de emergência" --project main --local
```

As notas guardam só estrutura e decisões, nunca os seus valores financeiros.
