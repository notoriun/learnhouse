<h1 align="center">Notoriun</h1>

<h3 align="center">Plataforma aberta de aprendizagem — cursos, conteúdo interativo e colaboração em tempo real.</h3>

<p align="center">
📖 <b>Cursos</b> — crie e gerencie cursos com facilidade<br>
✏️ <b>Editor</b> — editor de conteúdo em blocos, estilo Notion<br>
📦 <b>Coleções</b> — organize cursos em trilhas curadas<br>
📝 <b>Tarefas</b> — atividades com acompanhamento de entregas<br>
💬 <b>Discussões</b> — fóruns de comunidade para os alunos<br>
🎙️ <b>Podcasts</b> — conteúdo em áudio<br>
📊 <b>Analytics</b> — engajamento e desempenho dos cursos<br>
🧊 <b>Playgrounds</b> — elementos interativos e simulações geradas por IA<br>
💻 <b>Código</b> — execução real de código com correção automática em 30+ linguagens<br>
📋 <b>Quadros</b> — whiteboards colaborativos em tempo real<br>
🧠 <b>IA</b> — assistência contextual para aprender e ensinar<br>
🎓 <b>Certificados</b> — emissão automática na conclusão do curso<br>
👥 <b>Grupos</b> — organize alunos e controle acessos<br>
🔍 <b>SEO</b> — metadados, sitemaps e open graph integrados<br>
🎨 <b>Personalização</b> — identidade própria, landing pages e temas<br>
🔐 <b>Login corporativo</b> — autenticação OIDC via Keycloak<br>
</p>

## 🚀 Começando

### Desenvolvimento

```bash
git clone https://github.com/notoriun/learnhouse.git
cd learnhouse
npx learnhouse dev
```

O comando sobe PostgreSQL e Redis, instala as dependências e inicia os
servidores de API, Web e Colaboração com hot reload.

### Self-host

```bash
npx learnhouse@latest setup
```

O assistente de instalação configura domínio, banco de dados, conta
administrativa e recursos opcionais.

> O nome do pacote CLI (`learnhouse`) é um identificador técnico herdado do
> projeto de origem; sua renomeação é gradual e não afeta a operação.

## 📁 Estrutura do projeto

| App | Caminho | Descrição |
|-----|---------|-----------|
| **Web** | `apps/web` | Frontend — dashboard, player de cursos, editor, landing pages |
| **API** | `apps/api` | Backend REST — auth, cursos, IA, analytics |
| **Collab** | `apps/collab` | Colaboração em tempo real — edição ao vivo de cursos e quadros |
| **CLI** | `apps/cli` | CLI oficial — instalação, dev e gestão de instância |
| **Docs** | `docs` | Documentação pública (Nextra + Next.js) — ver seção abaixo |

## 📚 Documentação (`docs/`)

A documentação pública vive em `docs/` e é publicada em
**docs.notoriun.com.br**. Stack: [Nextra](https://nextra.site) 4 +
Next.js 16, React 19, Tailwind v4, busca via [Pagefind](https://pagefind.app).
Gerenciador de pacotes: **Bun**.

### Atualizando o conteúdo

Todo o conteúdo é MDX em `docs/content/`. A rota segue o caminho do arquivo, e
`index.mdx` responde pela raiz da seção:

```
docs/content/platform/certifications.mdx   ->  /platform/certifications
docs/content/developers/index.mdx          ->  /developers
```

A **ordem e os rótulos da sidebar** não vêm do nome do arquivo: cada pasta tem
um `_meta.json` que define a sequência, os títulos exibidos e os separadores de
grupo. Uma página nova só aparece na navegação depois de ser registrada ali.

```jsonc
// docs/content/_meta.json
{
  "index": "Home",
  "-- Platform": { "type": "separator", "title": "Platform" },
  "platform": "Platform",
  "self-hosting": "Self Hosting"
}
```

Outros pontos de edição:

| O que | Onde |
|-------|------|
| Título/descrição globais e metadados | `docs/app/layout.jsx` |
| Navbar e footer | `docs/components/Navbar/`, `docs/components/Footer/` |
| Referência da API (gerada, **não** editar à mão) | `docs/lib/reference/openapi.snapshot.json` |
| Estilos | `docs/styles.css` |

A referência da API é montada a partir de um snapshot do OpenAPI commitado no
repo. Para atualizá-la depois de mudar endpoints na API:

```bash
cd docs
node scripts/update-openapi-snapshot.mjs http://localhost:1338
```

Loop de desenvolvimento local:

```bash
cd docs
bun install
bun dev          # http://localhost:3000
```

> O índice do Pagefind (`public/_pagefind`) é gerado apenas no `postbuild`, e
> não é commitado. Portanto a busca não fica funcional no `bun dev` — para
> testá-la, use a imagem Docker descrita abaixo.

### O que o build faz

```
bun run build
  ├─ node scripts/generate-llms-full.mjs   -> public/llms-full.txt
  └─ next build                            -> .next/ (116 rotas prerenderizadas)

postbuild (o Bun encadeia automaticamente)
  ├─ pagefind --site .next/server/app --output-path public/_pagefind
  └─ next-sitemap                          -> public/sitemap.xml + robots.txt
```

**A doc não é um site estático.** `docs/next.config.mjs` não usa
`output: 'export'`, e o Pagefind indexa a partir de `.next/server/app`. Ou seja:
exige runtime Node em produção e **não** dá para servir só com nginx. O config
usa `output: 'standalone'`, que empacota `server.js` mais as dependências
rastreadas.

### Imagem Docker

Construída pelo [Dockerfile.docs](Dockerfile.docs) — build em `oven/bun:1`,
runtime em `node:22-slim` rodando `node server.js`:

```bash
# a partir da raiz do repo
docker build -t learnhouse-docs:latest -f Dockerfile.docs .

# testar localmente antes de publicar
docker run --rm -p 3100:3000 learnhouse-docs:latest   # http://localhost:3100
```

Dois detalhes que parecem redundantes mas não são:

- **`output: 'standalone'` não inclui `public/` nem `.next/static`.** Por isso o
  Dockerfile tem dois `COPY` extras. Sem eles a imagem sobe, responde 200 e o
  site aparece **sem CSS/JS e sem busca** — falha silenciosa.
- **Existe um [Dockerfile.docs.dockerignore](Dockerfile.docs.dockerignore)
  dedicado.** O `.dockerignore` da raiz exclui `docs/` (regra correta para o
  build do app), o que deixaria o `COPY docs/ .` sem nada para copiar. O
  BuildKit dá precedência ao arquivo `<dockerfile>.dockerignore`, então o build
  da doc tem o próprio escopo sem afetar o contexto do build do app.

> Os nomes têm sufixo `.docs` de propósito: o `Dockerfile` da raiz é o build do
> app (web + api) e não deve ser sobrescrito.

### Como funciona o compose

[docker-compose.docs.yml](docker-compose.docs.yml) é uma **stack do Docker
Swarm** — não um `docker compose up`. O arquivo tem um serviço só, e cada bloco
existe por um motivo:

| Bloco | Para que serve |
|-------|----------------|
| `image` | Imagem já construída. Em Swarm **cada nó resolve a imagem por conta própria**, então uma imagem só local não replica: para múltiplos nós, publicar em registry e apontar para lá. |
| `networks: traefik-public` | Rede overlay **externa**, criada fora desta stack e compartilhada com o Traefik. Sem estar na mesma rede overlay, o Traefik não alcança o container. |
| `deploy.replicas` | Número de instâncias do serviço. |
| `deploy.placement.constraints` | Fixa o serviço no nó `server1`. |
| `deploy.labels` | Os labels do Traefik. **Precisam ficar aqui, não em `labels`** — ver abaixo. |

O serviço **não publica `ports`**: nada é exposto no host. O único caminho de
entrada é o Traefik, pela rede overlay.

> ⚠️ **`deploy.labels` e não `labels`.** Em Swarm o Traefik descobre serviços
> pela API do Swarm, não pelos containers. Labels em `labels` ficam no container
> e o Traefik simplesmente não os vê — o serviço sobe saudável e o domínio
> retorna 404. É o erro mais comum nesse setup.

Os labels, um por um:

| Label | Efeito |
|-------|--------|
| `traefik.enable=true` | Habilita a descoberta deste serviço. |
| `traefik.docker.network=traefik-public` | Diz por qual rede o Traefik deve falar com o container, necessário quando o serviço está em mais de uma rede. |
| `routers.lhdocs.rule=Host(...)` | Casa o domínio `docs.notoriun.com.br`. |
| `routers.lhdocs.entrypoints` | Entrypoint HTTPS do Traefik. **Ajustar** ao nome usado neste ambiente. |
| `routers.lhdocs.tls=true` + `tls.certresolver` | Liga o TLS e escolhe o resolver Let's Encrypt. **Ajustar** ao nome usado neste ambiente. |
| `services.lhdocs.loadbalancer.server.port=3000` | Porta **interna** do container. Não é porta publicada; é para onde o Traefik encaminha. |

Para descobrir os nomes reais de entrypoint e certresolver do ambiente:

```bash
docker service inspect traefik \
  --format '{{json .Spec.TaskTemplate.ContainerSpec.Args}}' | tr ',' '\n' \
  | grep -iE 'entrypoint|certificatesresolvers'
```

### Publicando uma atualização

```bash
# 1. build com uma tag versionada (evita depender de :latest em Swarm)
docker build -t <registry>/notoriun/learnhouse-docs:$(git rev-parse --short HEAD) \
             -f Dockerfile.docs .
docker push <registry>/notoriun/learnhouse-docs:<tag>

# 2. primeiro deploy — ou qualquer mudança no compose
docker stack deploy -c docker-compose.docs.yml learnhouse-docs

# 2b. apenas trocar a imagem, sem reprocessar a stack
docker service update --image <registry>/notoriun/learnhouse-docs:<tag> \
  learnhouse-docs_learnhouse-docs

# 3. acompanhar
docker service logs -f learnhouse-docs_learnhouse-docs
docker service ps learnhouse-docs_learnhouse-docs
```

> Em Swarm, `:latest` é uma armadilha: o serviço pode não reconhecer que a
> imagem mudou e não recriar as tasks. Use tags versionadas.

### Pontos de atenção conhecidos

- **`entrypoints` e `tls.certresolver` estão com placeholder** no compose e
  precisam ser ajustados antes do primeiro deploy.
- **`sitemap.xml`, `robots.txt` e `llms-full.txt` ainda apontam para
  `docs.learnhouse.app`** — valores fixos em `docs/next-sitemap.config.js`
  (`siteUrl`) e `docs/scripts/generate-llms-full.mjs` (`SITE_URL`). Idem
  `docsRepositoryBase` em `docs/app/layout.jsx`, que aponta para o repo
  upstream. Herança do fork, ainda não corrigida.
- **O build emite `warn [nextra] Init git repository failed`.** O `.git` não
  entra no contexto do build, então as páginas saem sem a data de "última
  atualização". Não afeta conteúdo nem busca.

## 🔒 Segurança

Vulnerabilidades devem ser reportadas de forma privada — veja
[SECURITY.md](SECURITY.md). Não as divulgue publicamente antes da correção.

## ⚖️ Licença e atribuição

Distribuído sob a licença [AGPL-3.0](LICENSE). O código-fonte correspondente a
cada versão em execução está disponível a todos os usuários do serviço.

Este projeto é um trabalho derivado do
[LearnHouse](https://github.com/learnhouse/learnhouse), cujos avisos de
copyright e licença são preservados. **Notoriun é um produto independente, não
afiliado, não endossado e não patrocinado pela LearnHouse, Inc.** O nome
"LearnHouse" aparece neste repositório apenas como atribuição factual exigida
pela licença.

O código-fonte correspondente a cada release é publicado automaticamente junto
da imagem, e a aplicação expõe um link **"Código-fonte (AGPL-3.0)"** apontando
para a fonte da exata versão em execução.

> **Nota:** a conformidade técnica descrita aqui orienta o trabalho de
> engenharia e **não substitui parecer jurídico**. A operação comercial deve
> validar o modelo final com profissional especializado em software livre e
> marcas antes do go-live.
