# Investment Lab: regras para quem trabalha neste repositório

App local e de uma pessoa só para unificar a carteira de investimentos (vários bancos), dividir o aporte mensal, guardar o histórico e comparar o desempenho com o CDI. A interface e os textos são em **português do Brasil**.

## Regra número um: o banco real é do usuário

`data/investment.db` tem dados financeiros pessoais. **Nunca** altere, apague, sobrescreva ou migre esse arquivo.
- Para testar, use uma cópia em pasta temporária, `INVESTMENT_DATABASE_URL` apontando para outro arquivo, ou o modo demonstração (`demonstracao.bat`, dados fictícios em `data/demo/`).
- Para só olhar os dados, abra em modo somente leitura (`sqlite3.connect("file:data/investment.db?mode=ro", uri=True)`).
- Não rode `iniciar.bat`, `desenvolver.bat`, `uvicorn` ou `alembic` sem apontar para outro banco: eles sobem no banco real e aplicam migrações nele. Quem usa o app é o usuário.
- Um hook (`.claude/hooks/guard_real_database.py`) bloqueia isso, mas a regra vale mesmo sem o hook. Ele só libera `uvicorn`/`alembic` se `INVESTMENT_DATABASE_URL` aparecer **no mesmo comando**.
- O usuário pode ter o app aberto; não assuma que o banco ou a porta 8000 estão livres.

## Stack e estrutura

- **Back-end:** Python 3.12+, FastAPI, SQLAlchemy 2, Alembic, SQLite. Organizado por feature em `backend/app/features/<feature>` (`models`, `schemas`, `repository`, `service`, `router`, às vezes `domain` para regras puras).
- **Front-end:** React 19, TypeScript, Vite, Tailwind 4, TanStack Query, Recharts, em `frontend/src/features/<feature>` (`api`, `hooks`, `types`, `lib`, `components`).
- Uma feature só usa outra pela interface pública: o `service` no back-end e o `index.ts` no front-end. As páginas ficam **fora** do `index.ts` (o roteador importa direto), para não criar ciclos.
- Migrações Alembic em `backend/migrations/versions/`. O app migra sozinho ao subir e faz cópia automática do arquivo antes. Toda mudança de modelo precisa de migração e de teste de migração.

## Dinheiro, percentuais e números (não negociável)

- Dinheiro em **centavos inteiros** (`*_cents`). Percentuais em **pontos-base** (`*_bps`, 1% = 100). Taxas do CDI: mensal em ppm (`rate_ppm`), diária em bilionésimos (`rate_e9`).
- **Nunca** use `float` para dinheiro. Back-end: inteiros e `Decimal`. Front-end: inteiros e `BigInt` quando multiplicar quantidade por cotação. Arredonde meio para cima.
- Datas sem fuso: `YYYY-MM-DD` / `YYYY-MM`. Não passe datas por `new Date("2026-10-31")` (desloca o dia).
- Formatação brasileira: `R$ 1.234,56`, `7,5%`, `31/10/2026`. Use os helpers de `frontend/src/shared/lib/format.ts`.

## Como rodar as verificações

```powershell
# Back-end (rode em backend/)
.venv\Scripts\python.exe -m pytest -q
.venv\Scripts\python.exe -m ruff check app tests
.venv\Scripts\python.exe -m ruff format --check app tests

# Front-end (rode em frontend/)
npx tsc --noEmit
npx vitest run
npm run build

# Hook de proteção (na raiz)
backend\.venv\Scripts\python.exe -m pytest .claude/hooks -q
```

Os testes do back-end são isolados do banco real (`tests/conftest.py`). Mantenha assim.
Para ver a tela de verdade: suba o app com `INVESTMENT_DATABASE_URL`, `INVESTMENT_DEMO=1` e `INVESTMENT_BENCHMARKS_AUTO=0` e inspecione os elementos com o `playwright-cli` (skill `playwright-cli`; `snapshot` mostra papel, nome acessível e estado), em vez de ler screenshots. Nunca abra a porta 8000 (pode ser o app do usuário) nem `attach`/`--cdp`/`--extension`/`--persistent`. Use `scripts/capturar-telas.mjs` só quando o usuário pedir imagens (veja o cabeçalho do script).

## Convenções de código

- Código novo segue o estilo ao redor: mesma densidade de comentários, mesmos nomes, mesmo idioma (nomes em inglês no código, textos de interface e comentários de regra de negócio em português).
- Comentários explicam o **porquê**, não o quê. Sem código morto nem abstrações para um caso só.
- Toda mudança de comportamento vem com teste. Corrigir bug = primeiro um teste que falha.
- Cores do tema vêm de tokens (a paleta do Tailwind foi remapeada em `frontend/src/index.css`: `blue-*` é o dourado, `slate-*` os neutros quentes, `emerald-*` o verde-jade). Não use cores soltas. Valores monetários usam `<Money>` (respeita o modo "ocultar valores"), meses usam `<MonthInput>`.

## Padrões de interface (a usabilidade é prioridade do usuário)

A referência é `design/investment-lab-ux-ui.md` e os mockups da pasta `design/`. Resumo do que importa:
- Cada tela deixa claro o seu objetivo e tem **uma** ação principal; o resto fica subordinado.
- Distinguir **valor atual, investido, aporte, valorização, meta e simulação** por rótulo, nunca só por cor.
- Gráficos têm título, período, legenda e alternativa em tabela. Cor nunca é o único sinal.
- Estados de vazio, carregamento, erro, sucesso e dados parciais sempre existem e orientam o próximo passo.
- Teclado, foco visível, nomes acessíveis e contraste. Respeitar redução de movimento. Funciona no celular.
- Ações destrutivas pedem confirmação e dizem o efeito. Mensagens de sucesso dizem **o que** foi feito e **o que vem a seguir**.
- Nunca apresentar dado de exemplo como se fosse real (existe o selo "Modo demonstração").

## Documentação e memória

- `docs/PRD.md` e `docs/TAREFAS.md` **só mudam se o usuário pedir**.
- O Basic Memory (projeto `main`, pasta `investment-lab`) é a memória de decisões do projeto. O usuário a consulta direto. Registre decisões novas e não óbvias ali, em poucas linhas, sem repetir o que o código ou o git já dizem.

## Time de agentes (`.claude/agents/`)

| Agente | Papel | Pode editar? |
| --- | --- | --- |
| `project-manager` | Entende o pedido, esclarece o que for ambíguo e entrega o plano para os outros | não |
| `backend-engineer` | API, regras de negócio, banco e migrações | `backend/` |
| `frontend-engineer` | Especialista em UX/UI: telas, componentes, acessibilidade | `frontend/` |
| `qa-reviewer` | Roda as verificações e revisa o que mudou | não |
| `data-guardian` | Audita migrações, scripts e qualquer coisa que toque dados | não |
| `docs-memory` | Registra decisões no Basic Memory | só Basic Memory |

Fluxo: o pedido do usuário vai ao `project-manager`, que devolve um plano com tarefas por agente, ordem, o que roda em paralelo, o contrato de API entre back-end e front-end e os critérios de aceite. Os especialistas executam; `qa-reviewer` e, se houver banco, `data-guardian` revisam; `docs-memory` fecha o registro. Para o gerente rodar como sessão principal e delegar sozinho: `claude --agent project-manager`.
