# Guia de testes

A suíte completa roda **localmente ou no servidor coder, antes do push**. O CI do GitHub
(`.github/workflows/ci.yml`) só verifica ruff, auditoria de marca, lint estrito dos arquivos
alterados do web e o build das apps; ele não executa testes.

## Comandos

```sh
# API (Python, uv)
cd apps/api && uv sync && uv run pytest src/tests/ -v --cov=src --cov-fail-under=25  # precisa de ffmpeg

# Web
cd apps/web && bun install --frozen-lockfile && bun test tests

# CLI
cd apps/cli && bun install --frozen-lockfile && bun run test        # unitários
cd apps/cli && bun run test:all                                     # inclui integração

# E2E (apps/e2e; antes: build do cli e E2E_CLI="node $PWD/apps/cli/dist/bin/learnhouse.js"): bun install && bunx playwright install --with-deps chromium && bun run test
# Keycloak real: ver apps/e2e/features/keycloak/README.md
```

Os workflows de teste (api-tests, cli-tests, e2e, keycloak-validation) foram removidos do GitHub Actions.
