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
