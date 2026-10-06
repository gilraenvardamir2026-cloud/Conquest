// Entry point: `npm run dev` (with tsx watch) or `npm start`.
//
// Environment:
//   PORT                 port to listen on (default 3001)
//   DATA_DIR             where room files are kept (default ./data at the repo root)
//   RANDOM_ORG_API_KEY   RANDOM.ORG API key; when set, dice come from RANDOM.ORG instead of drand
//   DICE_SOURCE          drand (default without a key) | random.org | local

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { DiceService, drandSource, randomOrgClient } from './dice';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.PORT ?? 3001);
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data');
const key = process.env.RANDOM_ORG_API_KEY?.trim();
// drand unless a RANDOM.ORG key is set; DICE_SOURCE=local keeps every roll on this server.
const diceSource = process.env.DICE_SOURCE?.trim() || (key ? 'random.org' : 'drand');

const dice = new DiceService({
  client: diceSource === 'random.org' && key ? randomOrgClient(key) : null,
  drand: diceSource === 'drand' ? drandSource() : null,
});
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
  console.log(`  dice: ${dice.status().source === 'random.org' ? 'RANDOM.ORG (key set)' : dice.status().source === 'drand' ? 'drand public beacon' : 'local'}`);
});
