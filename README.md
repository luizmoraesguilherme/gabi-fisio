# Gabriela, fisioterapia em casa

Site com agenda online e painel para a Gabriela confirmar os atendimentos.

- `web/`: site público (`index.html`) e painel (`painel.html`). HTML, CSS e JS puros, servidos por nginx.
- `api/server.js`: API em Node 22 sem dependências, com banco SQLite embutido (`node:sqlite`).
- `deploy/docker-compose.yml`: gerado por `scripts/build-compose.mjs`, com o código embutido via `configs`. A VPS não precisa de acesso ao repositório nem de build.

## Rodar localmente

```bash
cd api && ADMIN_PASSWORD=teste PORT=3000 node server.js
# sirva a pasta web/ com qualquer servidor que encaminhe /api para a porta 3000
```

## Ajustes comuns

- **WhatsApp do site:** `web/config.js`, campo `whatsapp` (ex.: `5512999999999`).
- **Dias e horários de atendimento:** `SCHEDULE` em `api/server.js`.
- **Serviços:** `SERVICES` em `api/server.js`.
- **Dias de folga:** pelo próprio painel.

## Deploy

```bash
node scripts/build-compose.mjs   # gera deploy/docker-compose.yml
```

Depois publique o arquivo gerado como projeto Docker `gabi-fisio` na VPS (Docker Manager da Hostinger), com as variáveis `ADMIN_PASSWORD` e `SESSION_SECRET`. O site responde na porta 3100. Os dados ficam no volume `gabi-data`.

Quando houver domínio com HTTPS, defina `COOKIE_SECURE=true`.

## Design

Revise a interface com o Impeccable no Claude Code: `/impeccable critique o hero`, `/impeccable audit o formulário`.
