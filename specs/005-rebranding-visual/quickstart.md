# Quickstart: Validação do Rebranding

**Feature**: `005-rebranding-visual` | **Date**: 2026-08-03

Pré-requisito: ambiente local de desenvolvimento (`npx learnhouse dev`) rodando web + API.

## 1. Auditoria de marca (automatizada)

```bash
node scripts/brand-audit.mjs
```

Esperado: `0 falhas` e exit code 0. Qualquer FAIL aponta arquivo:linha com marca residual.
Para o formato consumido pelo CI: `node scripts/brand-audit.mjs --json`.

## 2. Superfícies-chave (inspeção visual)

| Superfície | Como verificar | Esperado |
|---|---|---|
| Login/cadastro/reset | `http://localhost:3000/auth/login` (e signup/reset) | Logo, título da aba, painel lateral e rodapé com a nova marca; texto pt-BR |
| Páginas de erro | Acessar rota inexistente (404); forçar erro (500) | Nova marca e tom de voz pt; nenhum `black_logo.png` |
| E-mail de teste | Disparar cadastro/recuperação de senha e inspecionar o e-mail recebido (ou log do provedor em dev) | Remetente "NovaMarca <…>", assunto, corpo e rodapé sem "LearnHouse" |
| Favicon/manifest | Aba do navegador + DevTools → Application | Ícone novo em 16px legível |
| OG preview | `curl -s localhost:3000/auth/login \| grep -i 'og:'` ou extensão de preview social | Título, descrição e imagem da nova marca |
| Watermark/embed | Página pública de org com watermark habilitado; embed de atividade | Badge "Powered by" com a nova marca |
| Modo escuro | Alternar tema no dashboard | Logo variante dark visível; contraste mantido |

## 3. Continuidade de sessão (FR-009 / SC-004)

1. Faça login **antes** de aplicar o branch da feature (sessão com cookies `LH_*` gravada).
2. Aplique o branch, rebuilde e recarregue a página.
3. Esperado: sessão continua válida sem novo login; nenhum cookie renomeado (DevTools → Application
   → Cookies: mesmos nomes `LH_*`).
4. Suba a stack com o `.env` antigo inalterado (`LEARNHOUSE_*`): a aplicação sobe normalmente.

## 4. Contraste WCAG AA (SC-003)

Com a paleta nova aplicada em `apps/web/styles/globals.css`:

- Rápido: DevTools → seletor de cor mostra a razão de contraste por elemento; ou axe DevTools
  (extensão) na página do dashboard e do site público.
- Automatizado: `npx pa11y http://localhost:3000/auth/login --runner axe` (checar violações
  `color-contrast`) nas páginas login, dashboard, curso e erro 404.

Esperado: todos os pares texto/fundo ≥ 4.5:1 (texto normal) / 3:1 (texto grande).

## 5. Área legal em 2 cliques (SC-005)

1. De qualquer página (ex.: dashboard), clique no rodapé/menu → link "Legal"/"Licença" (clique 1) →
   página `/legal` (clique 2 no máximo).
2. Esperado na página: atribuição ao projeto LearnHouse, licença AGPL-3.0 e declaração de
   independência ("produto independente, não afiliado e não patrocinado pela LearnHouse, Inc.").
3. Confirmar que este é o **único** lugar da aplicação onde o nome original aparece
   (a auditoria do passo 1 garante o resto).

## 6. Troca da marca provisória (ensaio da troca final)

1. Altere o nome no runtime config do web e em `LEARNHOUSE_SITE_NAME` na API; substitua os arquivos
   de `apps/web/public/brand/`.
2. Rebuilde e repita os passos 1–2.
3. Esperado: novo nome/logo em todas as superfícies **sem nenhuma mudança de código** — prova de que
   a troca final é configuração, não retrabalho.
