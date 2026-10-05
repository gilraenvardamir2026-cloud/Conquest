// Entry point: `npm run dev` (with tsx watch) or `npm start`.
//
// Environment:
//   PORT                 port to listen on (default 3001)
//   DATA_DIR             where room files are kept (default ./data at the repo root)
//   RANDOM_ORG_API_KEY   RANDOM.ORG API key; without it dice use the local fallback

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { DiceService, randomOrgClient } from './dice';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.PORT ?? 3001);
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data');
const key = process.env.RANDOM_ORG_API_KEY?.trim();

const dice = new DiceService({ client: key ? randomOrgClient(key) : null });
const { server, close } = await createApp({ dataDir, dice, staticDir: path.join(root, 'client/dist') });

// Save every open room before exiting on a normal stop (Ctrl+C, a host redeploy).
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    void close().finally(() => process.exit(0));
  });
}

server.listen(port, () => {
  console.log(`Conquest tabletop server on http://localhost:${port}`);
  console.log(`  rooms stored in ${dataDir}`);
  console.log(`  dice: ${key ? 'RANDOM.ORG (key set)' : 'local fallback (no RANDOM_ORG_API_KEY)'}`);
});
