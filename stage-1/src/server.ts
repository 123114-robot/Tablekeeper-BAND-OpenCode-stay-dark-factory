/**
 * Entry point: listen, serve, and close cleanly.
 *
 * `startServer` is what the tests use (ephemeral port, no process side effects);
 * `main` is the thin wrapper that reads `PORT` and installs signal handlers.
 */

import { createServer, type Server } from 'node:http';
import { createRequestListener } from './routes.ts';
import { newStore, type Store } from './store.ts';

export type StartedServer = {
  server: Server;
  store: Store;
  port: number;
  close: () => Promise<void>;
};

export type StartOptions = {
  /** Defaults to 0, so a test never fights the machine for a port. */
  port?: number;
  host?: string;
};

export function startServer(options: StartOptions = {}): Promise<StartedServer> {
  const port = options.port ?? 0;
  const host = options.host ?? '127.0.0.1';
  const store = newStore();

  return new Promise<StartedServer>((resolve, reject) => {
    const server = createServer(createRequestListener(store));
    server.on('error', (err) => reject(err));
    server.listen(port, host, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('server did not bind to a TCP port'));
        return;
      }
      resolve({
        server,
        store,
        port: address.port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((err) => {
              if (err) fail(err);
              else done();
            });
            server.closeAllConnections();
          }),
      });
    });
  });
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8080);
  const started = await startServer({ port, host: '0.0.0.0' });
  process.stdout.write(`tablekeeper stage-1 listening on http://0.0.0.0:${started.port}\n`);

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    void started.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
