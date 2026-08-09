const http = require('http');
const net = require('net');
const { URL } = require('url');

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT || 3000);
const APP_PORT = Number(process.env.APP_PORT || 3001);
const WS_PORT = Number(process.env.WS_PORT || 3003);

function targetPort(urlString) {
  try {
    const url = new URL(urlString, 'http://127.0.0.1');
    // Deliberately allow only the two in-container backends. Never turn this
    // query parameter into an arbitrary-port proxy.
    return url.searchParams.get('XTransformPort') === String(WS_PORT)
      ? WS_PORT
      : APP_PORT;
  } catch {
    return APP_PORT;
  }
}

function filteredHeaders(headers, port) {
  return {
    ...headers,
    host: `127.0.0.1:${port}`,
    'x-forwarded-host': headers['x-forwarded-host'] || headers.host || '',
    'x-forwarded-proto': headers['x-forwarded-proto'] || 'http',
  };
}

const gateway = http.createServer((req, res) => {
  if (req.url === '/__kanban_gateway_health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, appPort: APP_PORT, wsPort: WS_PORT }));
    return;
  }

  const port = targetPort(req.url || '/');
  const upstream = http.request({
    hostname: '127.0.0.1',
    port,
    method: req.method,
    path: req.url || '/',
    headers: filteredHeaders(req.headers, port),
  }, (response) => {
    res.writeHead(response.statusCode || 502, response.statusMessage, response.headers);
    response.pipe(res);
  });

  upstream.on('error', (error) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`upstream unavailable: ${error.code || 'error'}\n`);
  });
  req.pipe(upstream);
});

gateway.on('upgrade', (req, clientSocket, head) => {
  const port = targetPort(req.url || '/');
  const upstreamSocket = net.connect(port, '127.0.0.1');

  upstreamSocket.once('connect', () => {
    const lines = [`${req.method} ${req.url || '/'} HTTP/${req.httpVersion}`];
    for (const [name, value] of Object.entries(filteredHeaders(req.headers, port))) {
      if (Array.isArray(value)) {
        for (const item of value) lines.push(`${name}: ${item}`);
      } else if (value !== undefined) {
        lines.push(`${name}: ${value}`);
      }
    }
    lines.push('', '');
    upstreamSocket.write(lines.join('\r\n'));
    if (head.length) upstreamSocket.write(head);
    clientSocket.pipe(upstreamSocket);
    upstreamSocket.pipe(clientSocket);
  });

  upstreamSocket.on('error', () => {
    clientSocket.destroy();
  });
  clientSocket.on('error', () => {
    upstreamSocket.destroy();
  });
});

gateway.on('clientError', (_error, socket) => socket.destroy());
gateway.listen(GATEWAY_PORT, '0.0.0.0', () => {
  console.log(`[kanban-gateway] listening on ${GATEWAY_PORT}; app=${APP_PORT}; ws=${WS_PORT}`);
});

function shutdown() {
  gateway.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
