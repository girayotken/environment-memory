import { resolve, join, sep } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (existsSync(join(root, '.env'))) loadEnvFile(join(root, '.env'));
const port = Number(process.env.MEMORY_PORT || 7384);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MEMORY_PORT must be a valid TCP port');
const app = createApp(process.env.MEMORY_DATA_DIR || join(root, 'data/runtime'), { port,readOnly:process.env.MEMORY_READ_ONLY==='true' });
const dist = join(root, 'dist');
{
  app.get('/', async (_, reply) => existsSync(join(dist, 'index.html'))
    ? reply.type('text/html').send(readFileSync(join(dist, 'index.html')))
    : reply.code(503).send({ error: 'Client build is not ready. Run npm run build.' }));
  app.get<{ Params: { '*': string } }>('/assets/*', async (request, reply) => {
    const file = resolve(dist, 'assets', request.params['*']);
    if (!file.startsWith(join(dist, 'assets') + sep) || !existsSync(file)) return reply.code(404).send();
    const mime = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream';
    return reply.type(mime).send(readFileSync(file));
  });
}
await app.listen({ host: '127.0.0.1', port });
console.log(`Environment Memory API: http://localhost:${port} (local-only)`);
const close = async () => { await app.close(); process.exit(0); };
process.on('SIGINT', close); process.on('SIGTERM', close);
