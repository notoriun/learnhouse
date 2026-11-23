# Quickstart: Validação da Administração da Configuração OIDC

**Feature**: `004-admin-config-oidc` | **Data**: 2026-08-03

Roteiro de validação manual dos critérios SC-001…SC-005 da spec, em ambiente de
desenvolvimento.

## 0. Pré-requisitos

```bash
# Stack local (constituição — fluxo de desenvolvimento)
npx learnhouse dev

# Keycloak de desenvolvimento
docker run -p 8080:8080 -e KEYCLOAK_ADMIN=admin -e KEYCLOAK_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:latest start-dev
```

- Criar no Keycloak um realm `dev` e um cliente OIDC **confidencial**
  (client authentication ON, standard flow ON, PKCE S256) — documento-base §5.
- API com `LEARNHOUSE_DEVELOPMENT_MODE=true` (permite issuer `http://localhost`
  apenas em dev).
- Usuário admin da organização de teste logado no dashboard.

## 1. Configurar o provedor pela UI (US1 / SC-001)

1. Dashboard da org → Configurações → **Autenticação**
   (`apps/web/components/Dashboard/Pages/Org/OrgEditAuthSettings/`).
2. Preencher: issuer `http://localhost:8080/realms/dev`, client_id, segredo
   (usar um valor-canário conhecido, ex.: `s3gr3d0-canario-004`), scopes
   `openid email profile`.
3. **Testar conexão** → esperado: sucesso com endpoints descobertos.
4. Salvar e **ativar** → esperado: página de login da org passa a exibir o botão
   "Entrar com identidade corporativa" (renderização depende da feature `001`).
5. Cronometrar do zero ao primeiro login corporativo: deve ficar abaixo de
   15 minutos sem intervenção da operação (SC-001).

## 2. Teste de conexão — distinção de erros (FR-006)

- Parar o container do Keycloak → **Testar conexão** → mensagem de **provedor
  inacessível** (pt-BR).
- Religar o Keycloak e testar com issuer de path errado
  (`http://localhost:8080/realms/nao-existe`) → mensagem de **configuração
  inválida**.
- As duas mensagens devem ser distintas e em português.

## 3. Tentativa de issuer interno rejeitada — anti-SSRF (SC-003)

Com um token de admin, todas as chamadas abaixo devem retornar **400** com
mensagem clara, sem nenhuma requisição sair para o destino:

```bash
API=http://localhost:1338/api/v1
for issuer in \
  "https://192.168.1.10/realms/x" \
  "https://10.0.0.5/realms/x" \
  "https://169.254.169.254/latest/meta-data" \
  "https://metadata.google.internal/computeMetadata/v1" \
  "https://localhost/realms/x" ; do
  curl -s -o /dev/null -w "%{http_code} $issuer\n" \
    -X POST "$API/orgs/$ORG_ID/oidc-config/test" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d "{\"issuer_url\": \"$issuer\"}"
done
```

- Repetir com `LEARNHOUSE_DEVELOPMENT_MODE` desligado e issuer
  `http://exemplo.com/realms/x` → **400** (HTTPS obrigatório fora de dev).
- Cobertura automatizada correspondente:
  `apps/api/src/tests/security/test_oidc_issuer_ssrf.py`.

## 4. Segredo ausente em respostas e logs — como auditar (US2 / SC-002)

Após cadastrar o segredo-canário `s3gr3d0-canario-004`:

```bash
# 1) Resposta administrativa: valor ausente, apenas o indicador
curl -s "$API/orgs/$ORG_ID/oidc-config" -H "Authorization: Bearer $ADMIN_TOKEN" \
  | grep -c "s3gr3d0-canario-004"        # esperado: 0
curl -s "$API/orgs/$ORG_ID/oidc-config" -H "Authorization: Bearer $ADMIN_TOKEN" \
  | grep -c "secret_configured"          # esperado: 1 (true)

# 2) Logs da API
docker logs learnhouse-api 2>&1 | grep -c "s3gr3d0-canario-004"   # esperado: 0

# 3) Banco: somente ciphertext Fernet (prefixo gAAAA), nunca o plaintext
psql "$DATABASE_URL" -c \
  "SELECT client_secret_encrypted LIKE 'gAAAA%' AS cifrado,
          client_secret_encrypted = 's3gr3d0-canario-004' AS vazado
   FROM oidc_provider_config WHERE org_id = $ORG_ID;"
# esperado: cifrado = t, vazado = f

# 4) Trilha de auditoria sem o valor
psql "$DATABASE_URL" -c \
  "SELECT count(*) FROM user_audit_event
   WHERE event_type LIKE 'oidc_config%'
     AND audit_metadata::text LIKE '%s3gr3d0-canario-004%';"      # esperado: 0
```

- No navegador: DevTools → aba Network ao reabrir a tela — nenhuma resposta
  contém o valor; busca no bundle JS servido também não (SC-002).
- Rotação (FR-005): informar novo segredo na UI → salvar → evento
  `oidc_config_secret_rotated` na auditoria, login continua funcionando.

## 5. Auditoria de mudanças (SC-004)

```bash
psql "$DATABASE_URL" -c \
  "SELECT event_type, user_id, org_id, audit_metadata, created_at
   FROM user_audit_event WHERE event_type LIKE 'oidc_config%'
   ORDER BY created_at DESC LIMIT 10;"
```

Esperado: um evento por operação feita nos passos anteriores (criação, edição,
ativação, rotação), com autor e momento corretos e `audit_metadata` listando os
**nomes** dos campos alterados — nunca valores de segredo.

## 6. Desativação remove o botão de login (FR-007 / SC-005)

1. Na tela de Autenticação, desligar o provedor (switch ativo → inativo) e
   salvar.
2. Abrir a página de login da org em aba anônima → o botão "Entrar com identidade
   corporativa" **não** aparece; login nativo (e-mail/senha) segue funcionando.
3. Conferir contas: usuários provisionados anteriormente continuam existindo e
   logando por método nativo permitido; vínculos de identidade externa
   preservados no banco.
4. Reativar → botão volta no próximo carregamento.

## 7. Acesso negado a não-administradores (FR-001)

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "$API/orgs/$ORG_ID/oidc-config" -H "Authorization: Bearer $STUDENT_TOKEN"
# esperado: 403
```

Repetir com um admin de OUTRA org contra este `$ORG_ID` → **403**
(segurança multi-tenant, Princípio IV).
