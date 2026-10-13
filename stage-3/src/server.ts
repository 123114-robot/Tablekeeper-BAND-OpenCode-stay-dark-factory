import { createServer } from 'node:http';
import { openDatabase } from '../../stage-1/src/db.ts';
import { migrate2 } from '../../stage-2/src/hours.ts';
import { createStage2RequestListener } from '../../stage-2/src/availability.ts';

async function main(): Promise<void> {
  const db = openDatabase(process.env.TABLEKEEPER_DB ?? 'tablekeeper.db');
  migrate2(db);
  const server = createServer(createStage2RequestListener(db));
  const port = Number(process.env.PORT ?? 8080);
  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`tablekeeper stage-3 listening on http://0.0.0.0:${port}\n`);
  });
  const shutdown = (): void => server.close(() => {
    db.close();
    process.exit(0);
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
