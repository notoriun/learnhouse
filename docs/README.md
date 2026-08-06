<p align="center">
  <a href="https://notoriun.github.io/learnhouse/">
    <img alt="LearnHouse" src=".github/images/learnhouse-github.png" width="600" />
  </a>
</p>

<p align="center">
  <strong>LearnHouse Documentation</strong>
</p>

<p align="center">
  Official documentation for <a href="https://learnhouse.app">LearnHouse</a>, the open-source learning management system.
</p>

<p align="center">
  <a href="https://notoriun.github.io/learnhouse/">notoriun.github.io/learnhouse</a>
</p>

---

## Local Development

This site lives in the [`notoriun/learnhouse`](https://github.com/notoriun/learnhouse)
monorepo under `docs/`. Run all commands from that directory.

**Prerequisites:** [Bun](https://bun.sh) installed.

```bash
# Clone the monorepo and move into the docs app
git clone https://github.com/notoriun/learnhouse.git
cd learnhouse/docs

# Install dependencies
bun install

# Start the dev server
bun dev
```

The site will be available at `http://localhost:3000`.

## Deployment

Pushes to `dev` touching `docs/` publish the site to GitHub Pages
(`.github/workflows/docs-pages.yaml`, `bun run build:static`). The export has no
server, so the API playground proxy is dropped from that build.

## Project Structure

```
content/          # MDX documentation pages
  getting-started/
  platform/
  self-hosting/
  developers/
  enterprise/
  cli/
app/              # Next.js App Router
components/       # React components
public/           # Static assets
scripts/          # Build scripts
```

## Built With

- [Next.js](https://nextjs.org)
- [Nextra](https://nextra.site)
- [Tailwind CSS](https://tailwindcss.com)

## License

MIT - see [LICENSE](LICENSE) for details.
