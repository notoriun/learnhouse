import { describe, expect, test } from "bun:test";

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Guarda de regressão: nenhum redirecionamento voltado ao navegador pode
 * apontar para um caminho sob `/auth/`.
 *
 * Por quê: `proxy.ts` trata os caminhos públicos de autenticação e **reescreve**
 * para o segmento `/auth` (`authPaths` → `/auth${pathname}`), anexando os
 * cabeçalhos de tenant. Ou seja, `/auth/login`, `/auth/signup` etc. são destinos
 * *internos*. Pedi-los de fora não casa com `authPaths`, cai no catch-all
 * tenant-scoped e vira `/orgs/{slug}/auth/...` — rota que não existe.
 *
 * O bug real que isto impede: o callback do login corporativo redirecionava para
 * `/auth/login?error=...`, a pessoa caía num 404, e **toda** mensagem de recusa
 * era engolida — apesar de a tela de entrada já mapear cada código de erro.
 * O mesmo erro estava em outros dois pontos, um deles fora do fluxo de Keycloak.
 *
 * A distinção que o teste respeita: `NextResponse.rewrite` para `/auth/...` é
 * legítimo (é a própria reescrita interna). O que não pode é `redirect`.
 */

const WEB_ROOT = new URL("..", import.meta.url).pathname;

const IGNORAR = new Set([
  "node_modules",
  ".next",
  "tests",
  "public",
  "locales",
]);

function arquivosDeCodigo(dir) {
  const encontrados = [];
  for (const entrada of readdirSync(dir)) {
    if (IGNORAR.has(entrada) || entrada.startsWith(".")) continue;
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) {
      encontrados.push(...arquivosDeCodigo(caminho));
    } else if (/\.(ts|tsx)$/.test(entrada)) {
      encontrados.push(caminho);
    }
  }
  return encontrados;
}

/**
 * Procura redirecionamentos para `/auth/...`.
 *
 * Cobre as três formas usadas no projeto:
 *  - `redirect('/auth/...')`                      (next/navigation)
 *  - `NextResponse.redirect(new URL('/auth/...'`  (route handlers)
 *  - `new URL('/auth/...', ...)` seguido de redirect no mesmo trecho
 */
function redirecionamentosParaAuth(conteudo) {
  const achados = [];
  const linhas = conteudo.split("\n");

  linhas.forEach((linha, i) => {
    const temCaminhoAuth = /['"`]\/auth\/[a-z-]+/i.test(linha);
    if (!temCaminhoAuth) return;

    // Reescrita interna é o mecanismo legítimo — não é o alvo deste teste.
    if (/NextResponse\.rewrite/.test(linha)) return;

    const ehRedirect = /\bredirect\s*\(/.test(linha);
    // `new URL('/auth/login', ...)` costuma alimentar um redirect logo abaixo;
    // olhar 3 linhas à frente cobre o padrão sem virar análise sintática.
    const contexto = linhas.slice(i, i + 4).join("\n");
    const redirectPerto = /NextResponse\.redirect|return\s+redirect\(/.test(contexto);

    if (ehRedirect || redirectPerto) {
      achados.push({ linha: i + 1, texto: linha.trim() });
    }
  });

  return achados;
}

describe("caminhos de redirecionamento de autenticação", () => {
  test("nenhum redirecionamento de navegador aponta para /auth/*", () => {
    const violacoes = [];

    for (const arquivo of arquivosDeCodigo(WEB_ROOT)) {
      const conteudo = readFileSync(arquivo, "utf8");
      for (const achado of redirecionamentosParaAuth(conteudo)) {
        violacoes.push(
          `${relative(WEB_ROOT, arquivo)}:${achado.linha} → ${achado.texto}`,
        );
      }
    }

    expect(
      violacoes,
      "Redirecionamentos para /auth/* levam a 404: o segmento /auth é destino " +
        "interno da reescrita em proxy.ts. Use o caminho público (/login, " +
        "/signup, …). Encontrados:\n  " + violacoes.join("\n  "),
    ).toEqual([]);
  });

  test("proxy.ts continua reescrevendo os caminhos públicos para /auth", () => {
    // Contraprova: se alguém "corrigisse" a reescrita interna junto, o teste
    // acima passaria e a autenticação pararia de funcionar por completo.
    const proxy = readFileSync(join(WEB_ROOT, "proxy.ts"), "utf8");
    expect(proxy).toContain("/auth${pathname}");
    expect(proxy).toMatch(/authPaths\s*=\s*\[[^\]]*'\/login'/);
  });
});
