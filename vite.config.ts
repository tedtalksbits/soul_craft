import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { format, resolveConfig } from 'prettier';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { CONTENT_WRITE_ENDPOINT, FILE_CHANGED_EVENT, type FileChangedPayload } from './src/dev/protocol.ts';

const ROOT = import.meta.dirname;

/**
 * Dev-only plumbing for the content pipeline:
 *  - edits under /content and /assets are pushed to the running game as a
 *    custom HMR event instead of a full reload, so state survives tweaks;
 *  - POST /__dev/content writes a content file (used by the in-game editor).
 */
function soulCraftDev(): Plugin {
  return {
    name: 'soul-craft-dev',
    apply: 'serve',
    hotUpdate({ file, type }) {
      const rel = relative(ROOT, file).split(sep).join('/');
      if (!rel.startsWith('content/') && !rel.startsWith('assets/')) return;
      if (this.environment.name !== 'client') return [];
      this.environment.hot.send({
        type: 'custom',
        event: FILE_CHANGED_EVENT,
        data: { path: `/${rel}`, type } satisfies FileChangedPayload,
      });
      return [];
    },
    configureServer(server) {
      server.middlewares.use(CONTENT_WRITE_ENDPOINT, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
        req.on('end', () => {
          void (async () => {
            try {
              const { path, data } = JSON.parse(body) as { path: string; data: unknown };
              const target = resolve(ROOT, 'content', path);
              if (!target.startsWith(resolve(ROOT, 'content') + sep) || !target.endsWith('.json')) {
                throw new Error(`refusing to write outside content/: ${path}`);
              }
              await mkdir(dirname(target), { recursive: true });
              // Same canonical layout as `pnpm content:format`, so editor saves diff minimally.
              const options = await resolveConfig(target);
              await writeFile(
                target,
                await format(JSON.stringify(data), { ...options, parser: 'json', filepath: target }),
              );
              res.statusCode = 204;
              res.end();
            } catch (err) {
              res.statusCode = 400;
              res.end(err instanceof Error ? err.message : String(err));
            }
          })();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [soulCraftDev()],
  server: { port: 5173 },
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
