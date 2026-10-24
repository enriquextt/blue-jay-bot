import { createServer } from './app.js';
import { config } from './config/index.js';

const server = await createServer(config);
console.log(`Blue Jay Bot escuchando en http://${config.host}:${config.port}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
