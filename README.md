# catraquim

<p align="center">
  <strong>Gateway local que expõe o Codex como uma API compatível com OpenAI.</strong>
</p>

<p align="center">
  Rode clientes e SDKs que falam OpenAI contra um servidor local, com configuração simples,
  aliases de modelos e documentação OpenAPI embutida.
</p>


<p align="center">
  <a href="https://github.com/Lucas-Delacroix/catraquim/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Lucas-Delacroix/catraquim" alt="License" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white" alt="Node.js >= 20" />
  <img src="https://img.shields.io/badge/typescript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/openapi-documented-6BA539" 
  <img src="https://img.shields.io/badge/tests-vitest-729B1B?logo=vitest&logoColor=white" alt="Vitest" />
</p>

## Visao geral

O `catraquim` funciona como uma camada HTTP local sobre o Codex, expondo endpoints no formato esperado por clientes compatíveis com OpenAI. Isso permite apontar ferramentas, scripts e integrações existentes para um `baseURL` local, sem reinventar o protocolo.

## Destaques

- API compatível com OpenAI para `chat completions` e listagem de modelos.
- Aliases de modelos configuráveis, desacoplando o nome exposto do nome real no provider.
- Documentação em `/docs` e especificação OpenAPI em `/openapi.json`.
- Middleware opcional com bearer token.
- CLI para inicializar, validar, editar e inspecionar a configuração.
- Base em TypeScript, Hono, Zod e Vitest.

## Sumario

- [Requisitos](#requisitos)
- [Instalacao](#instalacao)
- [Quick Start](#quick-start)
- [Comandos](#comandos)
- [Endpoints](#endpoints)
- [Configuracao](#configuracao)
- [Exemplo de uso](#exemplo-de-uso)
- [Desenvolvimento](#desenvolvimento)
- [Contribuindo](#contribuindo)
- [Licenca](#licenca)

## Requisitos

Antes de iniciar, garanta que o ambiente tenha:

- Node.js 20 ou superior
- `pnpm`
- binario `codex` disponivel no `PATH`
- autenticacao valida em `~/.codex`

## Instalacao

```bash
pnpm install
```

## Quick Start

1. Gere a configuracao inicial:

```bash
pnpm exec tsx src/cli.ts config:init
```

2. Se preferir, abra o assistente interativo:

```bash
pnpm exec tsx src/cli.ts config:setup
```

3. Suba o gateway local:

```bash
pnpm start
```

4. Acesse a documentacao:

```text
http://127.0.0.1:4141/docs
```

## Comandos

Se estiver rodando a partir do checkout do repositorio, use:

```bash
pnpm exec tsx src/cli.ts <comando>
```

Comandos disponiveis:

```bash
catraquim start
catraquim auth:status
catraquim config:init
catraquim config:setup
catraquim config:path
catraquim config:validate
catraquim config:edit
```

## Endpoints

| Metodo | Rota | Descricao |
| --- | --- | --- |
| `GET` | `/healthz` | Health check do gateway |
| `GET` | `/auth/status` | Status de autenticacao dos adapters configurados |
| `GET` | `/v1/models` | Lista de modelos expostos pelo gateway |
| `POST` | `/v1/chat/completions` | Chat completions no formato OpenAI |
| `GET` | `/openapi.json` | Especificacao OpenAPI |
| `GET` | `/docs` | Swagger UI |

## Configuracao

Arquivo padrao:

```text
~/.config/catraquim/config.json
```

Exemplo:

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 4141,
    "token": null
  },
  "models": {
    "codex-max": {
      "adapter": "codex",
      "upstreamModel": "codex-max"
    },
    "codex-mini": {
      "adapter": "codex",
      "upstreamModel": "codex-mini"
    }
  },
  "providers": {
    "codex": {
      "binary": "codex",
      "homePath": "~/.codex"
    }
  }
}
```

Notas:

- `codex-max` e `codex-mini` sao aliases do gateway. Ajuste `upstreamModel` se o seu ambiente usar outros nomes.
- Se `server.token` for definido, todas as rotas passam a exigir `Authorization: Bearer <token>`.
- O endpoint de `stream` ainda nao esta implementado. Requisicoes com `"stream": true` retornam `501`.

Variaveis de ambiente suportadas:

- `CATRAQUIM_PORT`
- `CATRAQUIM_TOKEN`
- `CATRAQUIM_CODEX_BINARY`

## Exemplo de uso

```bash
curl -X POST 'http://127.0.0.1:4141/v1/chat/completions' \
  -H 'content-type: application/json' \
  -d '{
    "model": "codex-max",
    "stream": false,
    "messages": [
      { "role": "user", "content": "Responda com uma frase curta." }
    ]
  }'
```

Se voce tiver configurado token:

```bash
curl -X POST 'http://127.0.0.1:4141/v1/chat/completions' \
  -H 'authorization: Bearer seu-token' \
  -H 'content-type: application/json' \
  -d '{
    "model": "codex-max",
    "stream": false,
    "messages": [
      { "role": "user", "content": "Liste tres usos para um gateway local." }
    ]
  }'
```

## Desenvolvimento

```bash
pnpm dev
pnpm test
pnpm check
pnpm build
```

Stack principal:

- TypeScript
- Hono
- Zod
- Vitest
- tsup

## Contribuindo

Issues e pull requests sao bem-vindos. Se for contribuir com codigo:

1. Abra uma issue ou descreva claramente o problema.
2. Mantenha as mudancas focadas.
3. Rode `pnpm test` e `pnpm check` antes de enviar.

## Licenca

Distribuido sob a licenca MIT. Veja [`LICENSE`](LICENSE) para mais detalhes.
