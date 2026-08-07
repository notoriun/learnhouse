# Relatório de Bugs — Login Corporativo (Keycloak)

**Origem**: feature `008-testes-keycloak-local` | **Data**: 2026-08-06
**Ambiente**: `docker-compose.local.yml` — plataforma na porta 80, Keycloak 26.3 na 8080, realm `dev`
**Como foram encontrados**: execução da suíte de validação em `apps/e2e/features/keycloak/`

Dois defeitos de produto confirmados. Ambos afetam **usuários finais**, não só o ambiente de
desenvolvimento. Nenhum dos dois é pego pelos testes existentes, porque os dois só aparecem contra
um provedor real e com navegador.

---

# BUG 1 — Recusa no login corporativo leva a uma página 404, e o motivo nunca aparece

**Severidade**: alta — a pessoa fica sem saber por que não conseguiu entrar
**Componente**: `apps/web` (BFF do login corporativo)
**Afeta**: toda instalação com login corporativo ativo

## O que acontece

Quando o login corporativo é recusado — conta inexistente, e-mail não verificado, método SSO
desligado na organização — a plataforma redireciona a pessoa para `/auth/login?error=<motivo>`.

Mas **`/auth/login` responde 404**. O caminho servido é `/login`.

Resultado: a pessoa autentica no Keycloak com sucesso, volta para a plataforma, e cai numa página
"Esta página não existe ou foi removida". O código de erro vai na barra de endereços e nunca é
exibido, porque a página que o leria não está naquele caminho.

## Onde está

[`apps/web/app/api/auth/keycloak/callback/route.ts:28`](../../apps/web/app/api/auth/keycloak/callback/route.ts#L28)

```ts
const url = new URL('/auth/login', publicOrigin(request))
```

## Evidência

Medido no ambiente de pé, nos dois níveis, para descartar o proxy como causa:

| Caminho | Via nginx (porta 80) | Direto no servidor Next (porta 8000) |
|---|---|---|
| `/login` | **200** — título `Login — Default Organization` | **200** |
| `/auth/login` | **404** | **404** |
| `/orgs/default/auth/login` | — | **404** |

URL final observada numa recusa real:

```
http://localhost/auth/login?error=conta_nao_encontrada
```

Conteúdo da página nesse endereço:

```
heading "404"
paragraph: Esta página não existe ou foi removida. Verifique o endereço ou volte ao início.
```

## Causa-raiz (resolvida)

`/auth/login` **não é rota pública**: é destino interno de reescrita. `apps/web/proxy.ts:345-376`
reescreve os caminhos públicos (`/login`, `/signup`, …) para o segmento `/auth`, anexando os
cabeçalhos de tenant. Requisitar `/auth/login` direto não casa com essa lista, cai no catch-all
tenant-scoped e vira `/orgs/{slug}/auth/login` — que não existe (confirmado: 404).

**O caminho público canônico é `/login`.** E o erro está em **4 pontos**, dois deles fora do login
corporativo:

| Arquivo | Linha | Tipo |
|---|---|---|
| `apps/web/app/api/auth/keycloak/callback/route.ts` | 28 | redirect → **quebra** |
| `apps/web/app/api/auth/keycloak/authorize/route.ts` | 13 | redirect → **quebra** |
| `apps/web/app/editor/playground/[playgrounduuid]/edit/page.tsx` | 26 | redirect → **quebra** |
| `apps/web/proxy.ts` | 546 | rewrite interna → legítima, manter |

<details><summary>O que foi descartado no caminho até aqui</summary>


- `apps/web/app/auth/login/page.tsx` **existe** no código-fonte;
- **existe** no build do contêiner (`/app/web/.next/server/app/auth/login`);
- não há `middleware` (manifesto vazio: `{"middleware":{},"sortedMiddleware":[]}`);
- não há reescrita de `/login` em `next.config.mjs` (só os proxies do PostHog);
- não há `notFound()` na página;
- e ainda assim `/login` resolve **para essa mesma página** — o título vem do `generateMetadata`
  dela.

O que enganou: as duas rotas apontam para o mesmo componente, e a busca por `middleware.ts` não
achou nada — porque no Next 16 o middleware se chama **`proxy.ts`**. Foi ele que resolveu a
pergunta.

</details>

## Correção sugerida

Trocar `/auth/login` por `/login` nos **três redirecionamentos** de navegador, mantendo
`proxy.ts:546` como está (reescrita interna, legítima). Acrescentar um teste que impeça a
regressão — o mais barato é uma asserção de que nenhum `NextResponse.redirect`/`redirect()` do
`apps/web` aponta para um caminho sob `/auth/`.

## Consequência colateral

Este bug esconde outro comportamento: a API colapsa todos os motivos de recusa em
`CONTA_NAO_ENCONTRADA` ([`keycloak_auth.py:325`](../../apps/api/src/routers/keycloak_auth.py#L325)),
plausivelmente por anti-enumeração. Combinado com o 404, a pessoa não recebe orientação **alguma** —
nem genérica.

## Cobertura

Reproduzido automaticamente por `apps/e2e/features/keycloak/tests/us2-unverified.spec.ts`, passo
"a pessoa recebe o motivo da recusa". A jornada **permanece falhando de propósito** até a correção.

---

# BUG 2 — `redirect_uri` do login corporativo ignora o domínio configurado

**Severidade**: alta — o login corporativo simplesmente não funciona onde o defeito se manifesta
**Componente**: `apps/api` (configuração de hospedagem) + `apps/cli` (template de ambiente)
**Afeta**: **todo self-host da edição community** que ligue o login corporativo

## O que acontece

A plataforma monta a *redirect URI* do fluxo OIDC a partir de `hosting_config.frontend_domain`.
Esse valor **só** é sobrescrito por `LEARNHOUSE_FRONTEND_DOMAIN` — ele **não** cai para
`LEARNHOUSE_DOMAIN`, que é a variável que todo mundo configura.

Sem `LEARNHOUSE_FRONTEND_DOMAIN`, o valor vem do `config.yaml` como `localhost:3000`. A URI
enviada ao Keycloak fica divergente da registrada no client, e o login corporativo quebra — com
sintoma diferente em `localhost` e num domínio real (ver "Dois sintomas" abaixo).

## Onde está

Montagem da URI —
[`apps/api/src/services/auth/keycloak_oidc.py:236-240`](../../apps/api/src/services/auth/keycloak_oidc.py#L236-L240):

```python
def get_callback_redirect_uri() -> str:
    hosting = get_learnhouse_config().hosting_config
    scheme = "https" if hosting.ssl else "http"
    return f"{scheme}://{hosting.frontend_domain}/api/auth/keycloak/callback"
```

Resolução do valor — [`apps/api/config/config.py:372-374`](../../apps/api/config/config.py#L372-L374):

```python
frontend_domain = env_frontend_domain or yaml_config.get("hosting_config", {}).get(
    "frontend_domain", "localhost:3000"
)
```

Sem fallback para `LEARNHOUSE_DOMAIN`. E `apps/api/config/config.yaml:24` fixa
`frontend_domain: localhost:3000`.

## Por que atinge produção, não só o ambiente local

`LEARNHOUSE_FRONTEND_DOMAIN` é emitido **apenas** pelo template Enterprise
([`apps/cli/src/templates/ee.ts:136,141`](../../apps/cli/src/templates/ee.ts#L136)). O template da
edição community ([`apps/cli/src/templates/env.ts`](../../apps/cli/src/templates/env.ts)) **nunca**
o emite, mesmo definindo `LEARNHOUSE_DOMAIN` com o domínio real do cliente.

Logo: `npx learnhouse setup` numa instalação community, com login corporativo ativo, produz um
`redirect_uri` apontando para `localhost:3000` — e o login corporativo não funciona.

## Evidência

Antes de definir a variável, no ambiente local:

```
emitido pela plataforma:  http://localhost:3000/api/auth/keycloak/callback
registrado no client:     http://localhost/api/auth/keycloak/callback
```

Depois de acrescentar `LEARNHOUSE_FRONTEND_DOMAIN=localhost` e recriar a aplicação:

```
emitido pela plataforma:  http://localhost/api/auth/keycloak/callback   ✓ coincide
```

## Dois sintomas, e o pior é o de produção

Verificado executando o fluxo completo nos dois estados:

| Ambiente | O que acontece | Quando |
|---|---|---|
| `localhost` | O Keycloak **aceita** a URI e autentica; o navegador então falha com `ERR_CONNECTION_REFUSED` em `localhost:3000` | Depois de autenticar |
| Domínio real | O Keycloak **recusa** com *"Invalid parameter: redirect_uri"* | Antes de autenticar |

A diferença é a exceção de *loopback* da RFC 8252: o Keycloak ignora a porta para `localhost` e
`127.0.0.1`, então `localhost:3000` casa com o `localhost` registrado. Num domínio real a exceção
não se aplica.

Isso importa para triagem: quem reproduzir só em `localhost` vai ver um erro de rede e pode
concluir que é problema de ambiente. O relato que vem do cliente será o outro.

## Duas frentes de correção, com efeitos diferentes

| Abordagem | Corrige instalações existentes? |
|---|---|
| `frontend_domain` cair para `LEARNHOUSE_DOMAIN` quando não informado (`config.py`) | **Sim** — basta atualizar |
| Template community passar a emitir `LEARNHOUSE_FRONTEND_DOMAIN` (`env.ts`) | Não — só instalações novas |

Recomendação: a primeira, porque conserta quem já está quebrado. A segunda é complementar e torna
o valor explícito para quem lê o `.env`.

## Cobertura

Reproduzido por `apps/e2e/features/keycloak/tests/us1-redirect-uri.spec.ts`, que compara a URI
emitida com as **registradas no client**, lidas da interface administrativa do realm — e não com
uma constante derivada da mesma origem que gerou a URI.

Observação honesta: com `LEARNHOUSE_FRONTEND_DOMAIN` presente no `.env.local.example` entregue por
esta feature, o defeito **fica mascarado no ambiente local**. A jornada existe para pegar a classe
de defeito, não para substituir a correção.

---

# Não são bugs (investigados e descartados)

Registrado para poupar o tempo de quem revisar:

| Suspeita | Veredito |
|---|---|
| `LH_session` sem `httpOnly` | **Correto** — marcador de valor `"1"`, sem token. Os portadores (`LH_access`, `LH_refresh`) são httpOnly |
| Criação de fluxo devolve 200 com o provedor parado | **Correto** — documento de descoberta em cache |
| Config OIDC por organização recusada para `localhost` | **Correto** — proteção anti-SSRF |
| 403 em toda entrada após recriar só o contêiner do Keycloak | **Correto** — os `subject` são regenerados e a plataforma não revincula identidade por coincidência de e-mail |
| Back-channel logout não chegava | **Ambiente** — faltava `backchannel.logout.url` no realm; configurado, a jornada passou |
