// Gera deploy/docker-compose.yml com o código embutido (configs.content).
// Assim a VPS não precisa acessar o repositório privado nem fazer build.
// Uso: node scripts/build-compose.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_FILES = ['index.html', 'painel.html', 'styles.css', 'app.js', 'painel.js', 'loja.html', 'loja.js', 'config.js', 'favicon.svg'];
const HOST_PORT = process.env.HOST_PORT || '3100';

let commit = 'local';
try { commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch {}

// JSON é um escalar válido em YAML; "$" vira "$$" para o Compose não interpolar.
const yamlStr = (s) => JSON.stringify(s).replace(/\$/g, '$$$$');
const cfgName = (f) => 'web_' + f.replace(/[^a-z0-9]/gi, '_');

const configs = {
  api_server: readFileSync(join(root, 'api/server.js'), 'utf8'),
  nginx_conf: readFileSync(join(root, 'web/nginx.conf'), 'utf8'),
};
// Carimba JS e CSS com o hash do conteúdo: arquivo novo = URL nova, então o navegador
// nunca mistura um HTML novo com um script antigo guardado em cache.
const ver = (f) => createHash('sha256').update(readFileSync(join(root, 'web', f))).digest('hex').slice(0, 8);
const stamp = (html) => html.replace(/(src|href)="(styles\.css|app\.js|painel\.js|loja\.js|config\.js)"/g, (_, attr, f) => `${attr}="${f}?v=${ver(f)}"`);
for (const f of WEB_FILES) {
  const body = readFileSync(join(root, 'web', f), 'utf8');
  configs[cfgName(f)] = f.endsWith('.html') ? stamp(body) : body;
}

const webMounts = WEB_FILES.map((f) => `      - source: ${cfgName(f)}\n        target: /usr/share/nginx/html/${f}`).join('\n');

const yml = `# Gerado por scripts/build-compose.mjs. Não edite à mão.
name: gabi-fisio

services:
  api:
    image: node:22-alpine
    restart: unless-stopped
    command: ["node", "--no-warnings", "/app/server.js"]
    environment:
      PORT: "3000"
      DATA_DIR: /data
      ADMIN_PASSWORD: \${ADMIN_PASSWORD}
      SESSION_SECRET: \${SESSION_SECRET}
      COOKIE_SECURE: \${COOKIE_SECURE:-false}
    labels:
      gabi.commit: "${commit}"
    configs:
      - source: api_server
        target: /app/server.js
    volumes:
      - gabi-data:/data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks: [gabinet]
    mem_limit: 160m

  web:
    image: nginx:1.27-alpine
    restart: unless-stopped
    depends_on: [api]
    ports:
      - "${HOST_PORT}:80"
    labels:
      gabi.commit: "${commit}"
    configs:
      - source: nginx_conf
        target: /etc/nginx/conf.d/default.conf
${webMounts}
    networks: [gabinet]
    mem_limit: 64m

volumes:
  gabi-data:

networks:
  gabinet:

configs:
${Object.entries(configs).map(([k, v]) => `  ${k}:\n    content: ${yamlStr(v)}`).join('\n')}
`;

mkdirSync(join(root, 'deploy'), { recursive: true });
writeFileSync(join(root, 'deploy/docker-compose.yml'), yml);
console.log(`deploy/docker-compose.yml gerado (${(yml.length / 1024).toFixed(1)} KB, commit ${commit})`);
