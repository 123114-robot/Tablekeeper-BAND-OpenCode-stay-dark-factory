import { createServer, type Server } from 'node:http';
import { openDatabase, type Db } from '../../stage-1/src/db.ts';
import { migrate2 } from './hours.ts';
import { createStage2RequestListener } from './availability.ts';

type StartedServer = { server: Server; db: Db; port: number; close: () => Promise<void> };

export function startServer(databasePath: string, port = 0, host = '127.0.0.1'): Promise<StartedServer> {
  const db = openDatabase(databasePath);
  migrate2(db);
  return new Promise((resolve, reject) => {
    const server = createServer(createStage2RequestListener(db));
    server.on('error', (error) => {
      db.close();
      reject(error);
    });
    server.listen(port, host, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        db.close();
        reject(new Error('server did not bind to a TCP port'));
        return;
      }
      resolve({
        server,
        db,
        port: address.port,
        close: () => new Promise((done, fail) => server.close((error) => {
          db.close();
          if (error) fail(error); else done();
        })),
      });
    });
  });
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8080);
  const databasePath = process.env.TABLEKEEPER_DB ?? 'tablekeeper.db';
  const started = await startServer(databasePath, port, '0.0.0.0');
  process.stdout.write(`tablekeeper stage-2 listening on http://0.0.0.0:${started.port}\n`);
  const shutdown = (): void => { void started.close().finally(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
