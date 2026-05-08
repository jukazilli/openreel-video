# APGen Video Studio deployment

Este app e o empacotamento white-label APGen do OpenReel usado pela POC `/openreel-poc`.

## Objetivo

- Publicar o editor como subapp estatico separado do APGen.
- Manter o bundle pesado do editor fora do bundle principal APGen.
- Permitir iframe pelo APGen sem liberar embed amplo.
- Preservar execucao client-side: importacao, edicao e export locais no browser.

## Build local

```bash
cd C:\projetos\openreel-video
pnpm build:wasm
pnpm --filter @openreel/web build
```

## Preview local

```bash
cd C:\projetos\openreel-video
pnpm --filter @openreel/web preview -- --host 127.0.0.1 --port 5173
```

No APGen, apontar:

```env
VITE_OPENREEL_EDITOR_URL="http://localhost:5173/#/new?dimensions=1920x1080"
```

## Vercel staging

Configurar o projeto Vercel com root directory:

```text
apps/web
```

O arquivo `apps/web/vercel.json` define:

- `installCommand`: instala dependencias no root do monorepo.
- `buildCommand`: compila WASM e app web.
- `outputDirectory`: `dist`.
- headers COOP/COEP para recursos modernos de video.
- CSP `frame-ancestors` permitindo APGen local e previews Vercel.
- rewrite SPA para `index.html`.

Depois do deploy, configurar no APGen staging:

```env
VITE_OPENREEL_EDITOR_URL="https://<openreel-apgen-preview>.vercel.app/#/new?dimensions=1920x1080"
VITE_GOOGLE_CLIENT_ID="<client-id OAuth autorizado para o dominio APGen>"
```

Como `VITE_*` e injetado em build, alterar essas variaveis exige rebuild/redeploy do APGen.

Preview publicado em 2026-05-08:

```text
https://openreel-video-d0f2cyzdf-feather-tecnologias.vercel.app
```

URL usada pelo APGen:

```env
VITE_OPENREEL_EDITOR_URL="https://openreel-video-d0f2cyzdf-feather-tecnologias.vercel.app/#/new?dimensions=1920x1080"
VITE_OPENREEL_VERCEL_BYPASS_SECRET=""
```

Se o preview continuar protegido por Vercel Authentication/Password Protection, gerar um secret em:

```text
Vercel > openreel-video > Settings > Deployment Protection > Protection Bypass for Automation
```

Depois preencher `VITE_OPENREEL_VERCEL_BYPASS_SECRET` no APGen e rebuildar/redeployar o APGen. O APGen adiciona estes parametros no iframe:

```text
x-vercel-protection-bypass=<secret>
x-vercel-set-bypass-cookie=samesitenone
```

Esse segredo fica visivel no browser porque iframe nao permite header customizado. Use apenas para staging/preview e revogue o secret se ele vazar.

## Producao

Antes de promover para producao:

- adicionar o dominio final do APGen no OAuth Client do Google;
- adicionar o dominio final do editor no CSP `frame-ancestors`, se nao for `*.vercel.app`;
- rebuildar OpenReel/APGen apos qualquer alteracao de env `VITE_*`;
- validar iframe, importacao local, export local, upload Drive e aplicacao no slide `Videos`.

## Smoke OAuth/Drive

1. Abrir APGen autenticado.
2. Abrir `/openreel-poc`.
3. Confirmar que o iframe carrega o `APGen Video Studio`.
4. Importar ou gravar um video curto.
5. Executar `Validar ORE-4`.
6. Executar `Exportar editado`.
7. Clicar `Enviar editado ao Drive`.
8. Conceder OAuth com escopo `drive.file`.
9. Confirmar arquivo na pasta `Apgen / <projeto> / Videos editados`.
10. Clicar `Aplicar no slide Videos` e confirmar o link salvo no APGen.

## Limites conhecidos

- O smoke real de OAuth/Drive exige sessao de usuario e popup do Google; nao e automatizado por CLI.
- `X-Frame-Options` nao deve voltar como `DENY`, pois bloquearia o iframe no APGen.
- Se usar dominio proprio fora de `*.vercel.app`, atualizar CSP `frame-ancestors` em `_headers` e `vercel.json`.

## Proximo corte: ORE-9

O proximo corte aprovado para planejamento e remover a barra POC do APGen e integrar as acoes customizadas APGen aos controles nativos do OpenReel.

Documento canonico do plano:

```text
apps/web/APGEN_NATIVE_ACTIONS_PLAN.md
```

Direcao:

- manter a UI do OpenReel;
- remover botoes externos duplicados do APGen;
- usar `Assets > Add media` para importacao;
- usar o botao nativo `Record` para gravacao APGen quando em modo integrado;
- usar o botao nativo `EXPORT` para export local, upload Drive e aplicacao no slide;
- manter standalone/fallback do OpenReel quando nao houver parent APGen.
