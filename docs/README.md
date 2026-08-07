<p align="center">
  <strong>Documentação do Notoriun</strong>
</p>

<p align="center">
  Documentação oficial do Notoriun, o sistema de gestão de aprendizado open-source.
</p>

<p align="center">
  <a href="https://notoriun.github.io/learnhouse/">notoriun.github.io/learnhouse</a>
</p>

---

## Desenvolvimento Local

Este site vive no monorepo [`notoriun/learnhouse`](https://github.com/notoriun/learnhouse) sob
`docs/`. Execute todos os comandos a partir desse diretório.

**Pré-requisitos:** [Bun](https://bun.sh) instalado.

```bash
# Clone o monorepo e entre no app de docs
git clone https://github.com/notoriun/learnhouse.git
cd learnhouse/docs

# Instale as dependências
bun install

# Inicie o servidor de desenvolvimento
bun dev
```

O site estará disponível em `http://localhost:3000`.

## Deploy

Pushes para `dev` que tocam em `docs/` publicam o site no GitHub Pages
(`.github/workflows/docs-pages.yaml`, `bun run build:static`): o export estático é
enviado por force-push para a branch `gh-pages`, que é a fonte do Pages. Esse export
não tem servidor, então o proxy do playground da API é removido desse build.

## Estrutura do Projeto

```
content/          # Páginas de documentação em MDX
  getting-started/
  platform/
  self-hosting/
  developers/
  enterprise/
  cli/
app/              # Next.js App Router
components/       # Componentes React
public/           # Assets estáticos
scripts/          # Scripts de build
```

## Construído Com

- [Next.js](https://nextjs.org)
- [Nextra](https://nextra.site)
- [Tailwind CSS](https://tailwindcss.com)

## Licença

MIT - veja [LICENSE](LICENSE) para detalhes.
