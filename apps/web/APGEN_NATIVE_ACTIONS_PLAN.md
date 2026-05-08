# ORE-9: Integracao nativa de acoes APGen na UI OpenReel

Data: 2026-05-08

## Regime do metodo

- Modo aplicado: Realidade + Slice + Corte.
- Fonte de verdade tecnica: codigo atual em `apps/web/src/components/editor`, `apps/web/src/bridges/apgen-bridge.ts` e rota APGen `/openreel-poc`.
- Fonte de verdade de produto: contrato APGen `docs/openreel-editor-integration-contract.md`.
- Limite desta entrega: planejamento e contrato de implementacao. Nenhuma mudanca de UI/codigo deve ser feita antes da validacao do usuario.

## Objetivo

Remover a barra externa de POC exibida acima do iframe no APGen e transformar as acoes customizadas APGen em comportamentos nativos do OpenReel white-label, preservando a interface do OpenReel.

O usuario deve continuar vendo:

- painel `Assets`;
- tile/botao `Add media`;
- botao `Record` com icone circular;
- botao `EXPORT`;
- timeline, preview, inspector e topbar do OpenReel.

O que muda e a funcao por tras desses controles quando o editor estiver rodando em modo APGen.

## Problema atual

A POC provou importacao, gravacao, export, upload Drive e aplicacao no slide, mas criou uma camada operacional duplicada no APGen:

- `Importar arquivo local` fora do OpenReel duplica `Assets > Add media`;
- `Gravar tela` fora do OpenReel duplica `Record`;
- `Exportar editado` fora do OpenReel duplica `EXPORT`;
- `Enviar editado ao Drive` e `Aplicar no slide Videos` ficam fora do fluxo visual do editor;
- `Validar ORE-4`, badges tecnicos e URL fonte sao controles de desenvolvimento, nao experiencia final.

Essa barra deve desaparecer da experiencia oficial. A POC pode manter uma versao debug apenas atras de flag.

## Decisao de arquitetura

Adotar um modo de integracao chamado `apgen-native-actions`.

Nesse modo, OpenReel continua dono da UI e APGen continua dono das regras de produto. A comunicacao entre iframe e parent deixa de ser apenas comando imperativo APGen -> OpenReel e passa a ser bidirecional:

```text
OpenReel UI
  -> usuario clica no controle nativo
  -> ApgenNativeActions intercepta a intencao
  -> bridge envia pedido ao APGen parent quando a acao pertence ao APGen
  -> APGen executa gravacao, Drive, metadados ou slide
  -> APGen devolve resultado
  -> OpenReel atualiza timeline, export state, toast e biblioteca
```

Regra central: nao trocar icones, posicao ou layout do OpenReel para criar botoes APGen paralelos. Trocar o handler, nao a interface.

## Modo de ativacao

O modo APGen deve ser explicito para nao contaminar uso standalone do OpenReel.

Sugestao:

```text
https://openreel-video.../#/new?dimensions=1920x1080&integration=apgen
```

ou, se preferir env build-time:

```env
VITE_APGEN_INTEGRATION_MODE="true"
```

Preferencia: query param + feature flag interna, porque permite o mesmo deploy servir modo standalone e modo APGen.

## Fronteiras de responsabilidade

| Acao | UI visivel | Responsavel de UI | Responsavel funcional no modo APGen |
| --- | --- | --- | --- |
| Importar arquivo local | `Assets > Add media`, header `+`, dropzone | OpenReel | OpenReel importa localmente; APGen recebe evento opcional para diagnostico/contexto |
| Gravar tela | Botao `Record` nativo | OpenReel | APGen recorder, se precisarmos manter paridade com gravador APGen; fallback: recorder OpenReel |
| Parar/pausar gravacao | Modal/controles nativos do recorder | OpenReel | APGen recorder ou wrapper compatibilizado |
| Adicionar gravacao na timeline | Biblioteca/timeline OpenReel | OpenReel | OpenReel recebe `File` retornado e usa `importMedia` + `addClipToNewTrack` |
| Exportar | Botao `EXPORT` nativo | OpenReel | Export local em memoria via OpenReel, sem download obrigatorio |
| Enviar ao Drive | Fluxo pos-export dentro do menu/export state OpenReel | OpenReel | APGen parent executa OAuth/Drive/metadados |
| Aplicar no slide Videos | Acao pos-upload no estado de sucesso | OpenReel | APGen parent atualiza apresentacao |
| Validar ORE-4 | Nao aparece em producao | Debug apenas | Bridge/teste automatizado |

## Contrato de mensagens proposto

### OpenReel -> APGen

```ts
type OpenReelToApgenMessage =
  | {
      source: "openreel";
      type: "APGEN_REQUEST_SCREEN_RECORDING";
      requestId: string;
      payload: {
        includeMicrophone: boolean;
        title: string;
      };
    }
  | {
      source: "openreel";
      type: "APGEN_REQUEST_DRIVE_UPLOAD";
      requestId: string;
      payload: {
        fileName: string;
        mimeType: string;
        durationSec: number;
        sizeBytes: number;
        blob: Blob;
      };
    }
  | {
      source: "openreel";
      type: "APGEN_REQUEST_APPLY_VIDEO_SLIDE";
      requestId: string;
      payload: {
        fileId: string;
        webViewLink: string;
        fileName: string;
      };
    }
  | {
      source: "openreel";
      type: "APGEN_EDITOR_EVENT";
      payload: {
        event: "ready" | "media-imported" | "export-started" | "export-finished" | "drive-uploaded";
        metadata?: Record<string, unknown>;
      };
    };
```

### APGen -> OpenReel

```ts
type ApgenToOpenReelMessage =
  | {
      source: "apgen";
      type: "APGEN_SCREEN_RECORDING_RESULT";
      requestId: string;
      ok: true;
      file: File;
      payload: {
        addToTimeline: true;
        startTime: number;
      };
    }
  | {
      source: "apgen";
      type: "APGEN_DRIVE_UPLOAD_RESULT";
      requestId: string;
      ok: true;
      result: {
        fileId: string;
        fileName: string;
        webViewLink: string | null;
        folderId: string;
        folderName: string;
      };
    }
  | {
      source: "apgen";
      type: "APGEN_ACTION_ERROR";
      requestId: string;
      ok: false;
      error: string;
      recoverable: boolean;
    };
```

Regras:

- Todo pedido com efeito externo deve ter `requestId`.
- `Blob` e `File` seguem apenas via `postMessage` entre parent e iframe; nao passam pelo backend.
- O parent APGen deve validar `event.origin`.
- O OpenReel deve validar que esta em `integration=apgen` antes de confiar em mensagens APGen.
- Erros devem voltar para a UI nativa via toast/export state, nao para uma barra externa.

## Componentes afetados

### APGen

- `src/app/components/video/OpenReelPocPage.tsx`
  - Remover barra POC da experiencia principal.
  - Manter apenas shell minimo: voltar, recarregar/abrir nova aba se ainda forem necessarios.
  - Mover handlers de gravacao, upload Drive e aplicar slide para o listener de mensagens.
  - Criar modo debug opcional para `Validar ORE-4`, badges e fonte do iframe.

- `src/app/contexts/RecordingContext` e `src/app/hooks/useScreenRecorder.ts`
  - Continuam como fonte preferida para gravacao APGen se a decisao for manter o gravador atual.

- `src/app/utils/googleDrive.ts`
  - Continua como unica integracao Drive no APGen.

### OpenReel

- `apps/web/src/bridges/apgen-bridge.ts`
  - Evoluir de comandos POC para adapter bidirecional.
  - Adicionar request/response registry com timeout.
  - Expor helpers para import/export/upload integrados.

- `apps/web/src/components/editor/AssetsPanel.tsx`
  - Manter UI nativa.
  - Opcionalmente emitir evento `media-imported` apos `importMedia`.
  - Nao substituir import local se ele ja atende; evitar duplicacao vem da remocao da barra APGen.

- `apps/web/src/components/editor/Toolbar.tsx`
  - `Record`: manter botao e icone; em modo APGen chamar `requestApgenScreenRecording()` em vez de abrir apenas o recorder nativo.
  - `EXPORT`: manter menu e estado visual; em modo APGen exportar em memoria e abrir etapa pos-export com Drive/APGen.

- `apps/web/src/components/editor/ScreenRecorder.tsx`
  - Usar como fallback quando parent APGen nao responder ou quando o editor estiver standalone.

- `apps/web/src/components/editor/ExportDialog.tsx`
  - Reutilizar configuracoes, mas permitir destino `APGen Drive` no modo APGen.

## Experiencia alvo

1. Usuario entra no APGen autenticado.
2. Clica no editor de video.
3. A tela mostra praticamente so o OpenReel.
4. Usuario clica `Add media`; o fluxo e o nativo do OpenReel.
5. Usuario clica `Record`; a UI continua a do OpenReel, mas a gravacao usa o adapter APGen quando disponivel.
6. Ao terminar gravacao, o arquivo aparece nos assets e entra na timeline.
7. Usuario edita normalmente.
8. Usuario clica `EXPORT`.
9. O export roda localmente no OpenReel.
10. Em vez de so baixar arquivo, o estado final oferece acao principal `Enviar ao Drive` e acao secundaria `Baixar arquivo`.
11. Depois do upload, o estado final oferece `Aplicar no slide Videos` quando houver `projectId`.

## Lacunas inferidas e decisoes recomendadas

| Lacuna | Decisao inferida |
| --- | --- |
| O OpenReel ja tem import local funcional | Nao substituir por APGen; apenas remover import duplicado externo. |
| O OpenReel ja tem recorder proprio | Substituir handler do `Record` por APGen recorder somente em modo APGen; manter recorder OpenReel como fallback standalone. |
| Export nativo baixa arquivo | Em modo APGen, exportar em memoria e oferecer Drive como destino principal; download vira fallback. |
| Upload Drive nao existe no OpenReel | Nao portar OAuth/Drive para OpenReel; solicitar ao parent APGen via bridge. |
| Aplicar no slide depende de `projectId` | Se nao houver `projectId`, mostrar somente upload/download e ocultar aplicar no slide. |
| Barra POC contem status tecnico util | Mover para painel debug/console interno atras de flag, nao UI final. |
| Validar ORE-4 e botao de QA | Remover da experiencia final; manter comando de bridge para testes automatizados. |
| Mensagens e labels ainda misturam ingles/portugues | Nao traduzir tudo neste corte; apenas textos APGen adicionados devem ser consistentes. Uma futura etapa pode revisar i18n. |

## Slices de implementacao

### ORE-9A: Contrato e modo APGen

Entregas:

- Adicionar deteccao `integration=apgen`.
- Criar modulo `apgen-native-actions` no OpenReel.
- Criar request/response bridge com timeout e validacao de origem.
- APGen responder `ready`, `recording`, `drive-upload` e erros.

Criterio de pronto:

- OpenReel consegue detectar parent APGen.
- Mensagem `ready` aparece no APGen sem barra POC.
- Standalone continua funcionando.

### ORE-9B: Remover barra POC e manter shell minimo

Entregas:

- Remover da UI principal os botoes externos: importar, mic, gravar, enviar ultima, validar, exportar, Drive, aplicar.
- Manter iframe em altura total.
- Manter debug apenas atras de flag (`VITE_OPENREEL_DEBUG_TOOLBAR=true`) ou rota separada.

Criterio de pronto:

- Usuario nao ve a barra marcada na imagem.
- APGen continua com botao voltar ou navegacao equivalente.
- Build APGen passa.

### ORE-9C: Record nativo com funcao APGen

Entregas:

- Botao `Record` do `Toolbar.tsx` chama adapter APGen em modo integrado.
- APGen executa `useRecording`/screen recorder e devolve `File`.
- OpenReel importa o arquivo e adiciona na timeline.
- Fallback para recorder nativo quando parent nao responder.

Criterio de pronto:

- Clique no botao circular `Record` grava e adiciona media sem usar barra externa.
- Permissao de tela/mic continua exigindo gesto do usuario.
- Erros aparecem em toast/modal OpenReel.

### ORE-9D: Export nativo com destino APGen Drive

Entregas:

- Botao `EXPORT` mantem UI nativa.
- Em modo APGen, export local usa fluxo em memoria ja validado no bridge.
- Estado pos-export mostra `Enviar ao Drive` como acao principal.
- APGen faz OAuth/Drive e retorna metadados.

Criterio de pronto:

- Clique em `EXPORT` nao exige download para fechar fluxo APGen.
- Upload Drive acontece sem backend de video.
- Download continua disponivel como fallback.

### ORE-9E: Aplicar no slide Videos dentro do fluxo OpenReel

Entregas:

- Depois de `Drive uploaded`, OpenReel mostra acao nativa/inline para aplicar no slide.
- APGen atualiza primeira slide `Videos` quando houver `projectId`.
- Sem `projectId`, acao fica oculta ou desabilitada com tooltip curto.

Criterio de pronto:

- Link do Drive entra no slide sem barra APGen.
- Estado de sucesso fica visivel no OpenReel.

## Fora de escopo do ORE-9

- Reescrever layout do OpenReel.
- Migrar OpenReel para dentro do bundle APGen.
- Implementar Drive OAuth dentro do OpenReel.
- Remover fallback de gravacao/upload bruto do APGen.
- Garantir videos longos de 60 minutos.
- Resolver i18n completa do OpenReel.
- Trocar todos os fluxos cloud/KieAI/Share originais do OpenReel.

## Riscos e mitigacoes

| Risco | Impacto | Mitigacao |
| --- | --- | --- |
| Browser bloquear gravacao por gesto indireto entre iframe e parent | Alto | Disparar request no clique real do botao `Record`; se falhar, usar recorder nativo do iframe. |
| Bridge ficar acoplada demais ao APGen | Medio | Modo `integration=apgen`, adapter isolado e fallback standalone. |
| Export em memoria consumir muita RAM | Alto | Manter limite inicial para videos curtos/medios, progresso e erro claro. |
| Upload Drive parecer parte do OpenReel mas falhar por login APGen | Medio | APGen parent controla OAuth e retorna erro recoverable; UI mostra acao de reconectar. |
| Upstream OpenReel divergir | Medio | Patches concentrados em `apgen-bridge`, `Toolbar` e pequenos pontos de adapter. |

## Evidencias esperadas para fechar ORE-9

- `pnpm --filter @openreel/web build` passa.
- `pnpm build` no APGen passa.
- Smoke browser autenticado:
  - abrir APGen;
  - abrir editor;
  - confirmar ausencia da barra POC;
  - clicar `Add media` e importar arquivo;
  - clicar `Record` e gerar gravacao;
  - editar minimamente;
  - clicar `EXPORT`;
  - enviar ao Drive;
  - aplicar no slide `Videos`.
- Smoke iframe protegido:
  - iframe carrega no APGen com bypass de preview quando necessario;
  - nao retorna `401`;
  - nao retorna `X-Frame-Options: DENY`.

## Decisao pendente para validacao do usuario

Confirmar se o primeiro corte de implementacao deve seguir esta ordem:

1. remover barra POC e manter somente OpenReel visivel;
2. integrar `Record` nativo ao gravador APGen;
3. integrar `EXPORT` nativo ao Drive/APGen;
4. mover aplicar slide para o estado pos-upload.

Recomendacao: aprovar essa ordem. Ela reduz duplicidade rapidamente e deixa os riscos maiores, gravacao cross-frame e upload Drive, isolados em etapas verificaveis.

## Status de implementacao

Implementado em 2026-05-08:

- `ORE-9A`: modo `integration=apgen`, eventos `ready/export-started/export-finished/drive-uploaded` e request/response bidirecional por `postMessage`.
- `ORE-9B`: barra operacional POC removida da experiencia principal do APGen; debug fica atras de `VITE_OPENREEL_DEBUG_TOOLBAR=true`.
- `ORE-9C`: botao nativo `Record` tenta gravacao APGen via parent e cai para o recorder nativo OpenReel quando o navegador ou parent bloqueia a acao.
- `ORE-9D`: botao nativo `EXPORT` usa export em memoria no modo APGen e mostra acoes inline para Drive/download.
- `ORE-9E`: apos upload Drive, a acao de aplicar no slide `Videos` fica no estado pos-export do OpenReel.

Validado:

- `pnpm --filter @openreel/web build`
- `pnpm build` no APGen

Risco residual:

- A gravacao APGen disparada a partir de iframe pode ser bloqueada por politica de ativacao do navegador. O fallback para recorder nativo OpenReel foi mantido para preservar a jornada.
