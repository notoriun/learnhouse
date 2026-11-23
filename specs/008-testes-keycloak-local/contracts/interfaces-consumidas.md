# Contratos Consumidos pela Validação

**Feature**: `008-testes-keycloak-local` | **Data**: 2026-08-06

A validação **não publica** contrato novo — ela é consumidora. Este documento fixa as interfaces
das quais ela depende, para que uma quebra em qualquer uma delas seja reconhecida como mudança de
contrato e não como intermitência da validação (Princípio I).

Toda leitura de estado passa por estas interfaces. A validação **não** consulta PostgreSQL nem
Redis diretamente.

---

## 1. Plataforma — endpoints REST

Montados sob `/api/v1/auth/keycloak` ([router.py:97](../../../apps/api/src/router.py#L97)).

### `GET /api/v1/auth/keycloak/status?org={slug}`

Público. Diz se a opção de entrada corporativa deve aparecer.

Resposta: `{ "enabled": boolean, "platform": boolean }`

- `enabled` — provedor efetivo configurado **e** método SSO permitido na organização.
- `platform` — `enabled` **e** o provedor efetivo é o da plataforma; é o que libera o caminho de
  registro.

**Uso na validação**: pré-condição "login corporativo ativo" (D-08) e pré-condição do caminho de
registro de US2. Organização desconhecida responde igual a organização sem SSO — comportamento
anti-enumeração que a validação deve preservar, não contornar.

### `POST /api/v1/auth/keycloak/authorize`

Cria o fluxo (state, nonce, verifier de uso único) e devolve a URL de autorização.

Corpo: `{ "org_slug": string, "redirect_to": string?, "action": "login" | "register" }`
Resposta: `{ "authorization_url": string, "state": string }`

Erros relevantes: `SSO_NAO_CONFIGURADO`, `SSO_INDISPONIVEL` (provedor fora),
`REGISTRO_NAO_DISPONIVEL` (`action=register` em provedor que não é o da plataforma).

**Uso na validação**: US2 cenário 3 comprova `REGISTRO_NAO_DISPONIVEL`; a jornada de provedor
indisponível de US1 comprova `SSO_INDISPONIVEL`.

### `POST /api/v1/auth/keycloak/callback`

Consome o fluxo na ordem contratada: state de uso único → organização, política e configuração
efetiva → troca do código → validação integral do token de identidade → provisionamento ou
vínculo → sessão interna. Tokens do provedor **nunca** aparecem na resposta.

**Uso na validação**: exercitado indiretamente pelo navegador via o BFF; a validação comprova o
efeito (sessão emitida ou acesso negado sem sessão), não o formato interno.

### `POST /api/v1/auth/keycloak/logout` e `POST /api/v1/auth/keycloak/backchannel-logout`

Encerramento iniciado pela plataforma e notificação de encerramento vinda do provedor.

**Uso na validação**: US3. O `logout` tem superfície de navegador e é exercitado por lá; o
`backchannel-logout` não tem superfície visível e é exercitado pela suíte de `apps/api`.

### `GET /api/v1/instance/info`

Expõe `account_console_url` — o endereço da central de conta do provedor.

**Uso na validação**: US4 comprova que a orientação de recusa para conta federada aponta para
esse endereço.

---

## 2. Plataforma — rotas do BFF (Next.js)

| Rota | Papel |
|---|---|
| `GET /api/auth/keycloak/authorize` | Inicia o fluxo e redireciona à tela do provedor |
| `GET /api/auth/keycloak/callback` | Recebe o retorno do provedor; é a *redirect URI* registrada no client |
| `GET /api/auth/keycloak/logout` | Inicia o encerramento coordenado |

A *redirect URI* registrada no realm é exatamente
`http://localhost/api/auth/keycloak/callback`. Divergência entre essa URI e o endereço base do
ambiente é falha de **preparação**, não de produto.

---

## 3. Provedor — interfaces do Keycloak

| Interface | Uso na validação |
|---|---|
| Documento de descoberta do realm (`/realms/dev/.well-known/openid-configuration`) | Pré-condição de disponibilidade do provedor |
| Tela de autenticação e tela de registro do realm | Jornadas de US1 e US2, dirigidas pelo navegador |
| Interface administrativa do realm | Criar a identidade efêmera de primeiro acesso (D-09) e confirmar que a sessão foi encerrada no provedor (US3) |
| Central de conta do realm | Endereço comparado com `account_console_url` em US4 |

**Restrição**: nada disso pode ser substituído por simulação em jornada declarada validada
(FR-001). A interface administrativa é usada para **preparar** e **conferir** estado, nunca para
executar a etapa que a jornada precisa comprovar.

---

## 4. Coletor de e-mail (ambiente de teste)

Serviço acrescentado ao compose local por D-06. A validação depende de duas capacidades, e não
de um produto específico:

1. aceitar SMTP do Keycloak, configurado em `smtpServer` do realm;
2. permitir leitura programática das mensagens recebidas, para extrair o link de verificação.

**Uso na validação**: caminho feliz de US2 — registrar, ler o e-mail de verificação, verificar,
e comprovar admissão.

---

## 5. Matriz de rastreabilidade (FR-014, SC-006)

Cada jornada declara seu requisito de origem no título. A matriz abaixo é a fonte da conferência
de cobertura; jornada ausente dela é jornada órfã.

| User Story | Jornada | Requisito de origem |
|---|---|---|
| US1 | Entrada com credencial verificada emite sessão utilizável | FR-001, FR-002, FR-007 (001-fundacao-oidc-keycloak) |
| US1 | Fluxo usa Authorization Code com parâmetros de uso único | FR-002, FR-003 (001) |
| US1 | Redirect URI emitida coincide com a registrada no provedor | FR-002 (001) |
| US1 | Retorno processado só no servidor; token do provedor não vaza | FR-004 (001) |
| US1 | Token de identidade validado integralmente | FR-005 (001) |
| US1 | Endpoints descobertos a partir do issuer | FR-006 (001) |
| US1 | Credencial inválida nega acesso sem criar sessão | FR-009 (001) |
| US1 | Redirecionamento final só para caminho permitido | FR-008 (001) |
| US1 | Provedor fora não afeta sessão interna já ativa | FR-011 (001) |
| US2 | Registro com e-mail verificado provisiona com menor privilégio | FR-001, FR-002 (007) + FR-006 (002-identidade-provisionamento) |
| US2 | E-mail não verificado é recusado na admissão, sem conta criada | FR-002 (007) |
| US2 | Provedor de terceiro não oferece registro | FR-010 (007) |
| US2 | Identidade externa persistida com vínculo correto | FR-001, FR-002, FR-003 (002) |
| US2 | E-mail coincidente de outra procedência não vincula automaticamente | FR-004, FR-005 (002) |
| US3 | Sair encerra sessão local e sessão no provedor | FR-001, FR-002, FR-003 (003-logout-revogacao) |
| US3 | Sessão derrubada no provedor deixa de valer na plataforma | FR-004, FR-006 (003) |
| US3 | Encerramento nativo segue funcionando sem o provedor | FR-010 (003) |
| US4 | Conta federada recusa troca local de senha e de e-mail | FR-008 (007) |
| US4 | Recusa aponta a central de conta do provedor | FR-008 (007) |
| US4 | Perfil comum segue editável em conta federada | FR-008 (007) |
| US4 | Conta local não federada segue trocando senha | FR-010 (007) |

**Fora da matriz por decisão registrada**: requisitos de US5 (004-admin-config-oidc) por D-05 e
de US6 (migração, 007) por FR-016.
