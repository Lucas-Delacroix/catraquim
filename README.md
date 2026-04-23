# catraquim

Local daemon to expose LLM CLIs as an OpenAI-compatible API.

## Scaffold atual

O projeto já nasce com:

- CLI em `src/cli.ts` com comandos `start` e `auth:status`
- servidor HTTP em Hono com `GET /healthz`, `GET /auth/status`, `GET /v1/models`
- loader de configuração com defaults + env + `~/.config/catraquim/config.json`
- middleware opcional de bearer token
- contratos das camadas `services`, `adapters`, `credentials` e `sse`
- stubs do adapter Codex para completar nas próximas etapas

## Rodando em desenvolvimento

```bash
pnpm install
pnpm dev
```

Ou direto:

```bash
pnpm start
```

## Comandos

```bash
catraquim start
catraquim auth:status
```

## Configuração

Arquivo base:

```json
{
  "server": { "host": "127.0.0.1", "port": 4141, "token": null },
  "models": {
    "gpt-5-codex": { "adapter": "codex", "upstreamModel": "gpt-5" },
    "gpt-5": { "adapter": "codex", "upstreamModel": "gpt-5" }
  },
  "codex": { "binary": "codex", "codexHomeSource": "~/.codex" }
}
```

Overrides por ambiente:

- `CATRAQUIM_PORT`
- `CATRAQUIM_TOKEN`
- `CATRAQUIM_CODEX_BINARY`
