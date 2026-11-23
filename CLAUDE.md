# learnhouse Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-08-07

## Active Technologies
- Python 3.12 (`apps/api`) + FastAPI, SQLModel; TypeScript 5 / Node 20 (`apps/web`) + Next.js App Router; `@playwright/test` (`apps/e2e`). PostgreSQL via SQLModel + Redis. Sem dependência nova. (009-auto-provisionamento-keycloak)

- TypeScript sobre Node/Bun para o módulo de validação (a suíte existente + `@playwright/test` (já presente em `apps/e2e`); nenhuma dependência (008-testes-keycloak-local)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript sobre Node/Bun para o módulo de validação (a suíte existente: Follow standard conventions

## Recent Changes
- 009-auto-provisionamento-keycloak: criação automática de conta no primeiro acesso via Keycloak; destino pós-acesso passa a ser a área da organização com menu. Sem mudança de schema.

- 008-testes-keycloak-local: Added TypeScript sobre Node/Bun para o módulo de validação (a suíte existente + `@playwright/test` (já presente em `apps/e2e`); nenhuma dependência

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
