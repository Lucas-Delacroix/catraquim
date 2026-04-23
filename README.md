# catraquim

Gateway local que expõe o Codex como API compatível com OpenAI.

## Requisitos

- Node 20+
- pnpm
- `codex` disponível no `PATH`
- autenticação válida em `~/.codex`

## Rodando

```bash
pnpm install
pnpm start
```

Para desenvolvimento:

```bash
pnpm dev
```

## Comandos

```bash
catraquim start
catraquim auth:status
catraquim config:setup
```

## Endpoints

```text
GET  /healthz
GET  /auth/status
GET  /v1/models
POST /v1/chat/completions
GET  /openapi.json
GET  /docs
```

## Configuração

Arquivo: `~/.config/catraquim/config.json`

```json
{
  "server": { "host": "127.0.0.1", "port": 4141, "token": null },
  "models": {
    "codex-max": { "adapter": "codex", "upstreamModel": "codex-max" },
    "codex-mini": { "adapter": "codex", "upstreamModel": "codex-mini" }
  },
  "providers": {
    "codex": { "binary": "codex", "homePath": "~/.codex" }
  }
}
```

`codex-max` e `codex-mini` são aliases do gateway. Se o seu Codex usar outros nomes, troque o `upstreamModel`.

Variáveis de ambiente:

- `CATRAQUIM_PORT`
- `CATRAQUIM_TOKEN`
- `CATRAQUIM_CODEX_BINARY`

## Exemplo

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
