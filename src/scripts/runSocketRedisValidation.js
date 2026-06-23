process.env.REDIS_URL = process.env.RUNTIME_SIM_REDIS_URL || 'redis://127.0.0.1:6379/14';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { io: createClientSocket } = require('socket.io-client');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

const REPORT_PATH = path.resolve(
  __dirname,
  '../../artifacts/socket-redis-validation-report-2026-06-12.md',
);

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function createAdapterPair() {
  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();
  await pubClient.connect();
  await subClient.connect();
  return { pubClient, subClient };
}

async function createSocketServer(name) {
  const server = http.createServer();
  const io = new Server(server, {
    cors: { origin: '*' },
  });
  const { pubClient, subClient } = await createAdapterPair();
  io.adapter(createAdapter(pubClient, subClient));

  io.on('connection', (socket) => {
    socket.on('join_maid', (maidId) => {
      socket.join(`maid_${maidId}`);
    });
  });

  const port = await listen(server);
  return { name, io, server, port, pubClient, subClient };
}

async function flushRedisDb() {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  await client.flushDb();
  await client.quit();
}

async function main() {
  await flushRedisDb();

  const serverA = await createSocketServer('A');
  const serverB = await createSocketServer('B');

  const clientA = createClientSocket(`http://127.0.0.1:${serverA.port}`, {
    transports: ['websocket'],
  });
  const clientB = createClientSocket(`http://127.0.0.1:${serverB.port}`, {
    transports: ['websocket'],
  });

  const connected = await Promise.all([
    new Promise((resolve) => clientA.on('connect', resolve)),
    new Promise((resolve) => clientB.on('connect', resolve)),
  ]);
  void connected;

  clientA.emit('join_maid', 'shared');
  clientB.emit('join_maid', 'shared');

  const startedAt = Date.now();
  const payload = {
    bookingId: 'runtime-socket-booking',
    type: 'instant',
  };

  const receivedByRemoteClient = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 5000);
    clientB.on('booking:offer', (message) => {
      clearTimeout(timeout);
      resolve({
        latencyMs: Date.now() - startedAt,
        message,
      });
    });
    setTimeout(() => {
      serverA.io.to('maid_shared').emit('booking:offer', payload);
    }, 250);
  });

  const report = `# Socket Redis Validation Report

Date: \`2026-06-12\`
Redis URL: \`${process.env.REDIS_URL}\`

## Scenario

- started two separate Socket.IO servers
- attached Redis adapter to both
- connected one client to server A
- connected one client to server B
- both joined room \`maid_shared\`
- emitted \`booking:offer\` from server A

## Result

- remote client on server B received event: \`${Boolean(receivedByRemoteClient)}\`
- measured cross-instance delivery latency: \`${receivedByRemoteClient?.latencyMs ?? 'n/a'} ms\`

## Payload

\`\`\`json
${JSON.stringify(receivedByRemoteClient?.message || null, null, 2)}
\`\`\`
`;

  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        received: Boolean(receivedByRemoteClient),
        latencyMs: receivedByRemoteClient?.latencyMs ?? null,
      },
      null,
      2,
    ),
  );

  clientA.disconnect();
  clientB.disconnect();
  await Promise.all([
    serverA.pubClient.quit(),
    serverA.subClient.quit(),
    serverB.pubClient.quit(),
    serverB.subClient.quit(),
  ]);
  await Promise.all([
    new Promise((resolve) => serverA.io.close(resolve)),
    new Promise((resolve) => serverB.io.close(resolve)),
  ]);
  await Promise.all([
    new Promise((resolve) => serverA.server.close(resolve)),
    new Promise((resolve) => serverB.server.close(resolve)),
  ]);
  await flushRedisDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
