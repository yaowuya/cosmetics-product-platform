// Local WeChat simulator only. The regular HTTPS site stays on 5144.
const { readFileSync } = require('node:fs');
const { createServer: createHttpServer } = require('node:http');
const { createServer: createHttpsServer, request } = require('node:https');
const { resolve } = require('node:path');

const host = '127.0.0.1';
const port = 5145;
const publicPath = /^\/api\/public\/(?:pages\/(?:home|catalog|cases|contact)|catalog|(?:products|cases)(?:\/[1-9][0-9]{0,18})?|media\/[1-9][0-9]{0,18}(?:\/(?:thumbnail|catalog-thumbnail|display-thumbnail))?)$/;
const responseHeaders = ['content-type', 'content-length', 'cache-control', 'x-content-type-options'];

/** Serve published GETs on loopback, using HTTPS when supplied the local TLS certificate and key. */
function createLocalApiServer(requestUpstream, tlsOptions) {
  function forwardPublicRequest(req, res) {
    if (req.headers.host !== `${host}:${req.socket.localPort}` || !publicPath.test(req.url.split('?')[0])) {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' }).end();
      return;
    }

    const unavailable = () => {
      if (res.headersSent) res.destroy();
      else res.writeHead(502, { 'Content-Type': 'application/json' }).end('{"code":"local_upstream_unavailable"}');
    };
    // Send only the path and query. Do not forward cookies, authorization or client headers.
    const upstream = requestUpstream(req.url, incoming => {
      incoming.on('error', unavailable);
      if (incoming.statusCode >= 300 && incoming.statusCode < 400) {
        incoming.resume();
        unavailable();
        return;
      }
      const headers = {};
      for (const key of responseHeaders) {
        if (incoming.headers[key] !== undefined) headers[key] = incoming.headers[key];
      }
      res.writeHead(incoming.statusCode, headers);
      incoming.pipe(res);
    });
    upstream.on('error', unavailable);
    upstream.setTimeout(10_000, () => upstream.destroy(new Error('Local upstream timed out')));
    res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
    upstream.end();
  }
  return tlsOptions ? createHttpsServer(tlsOptions, forwardPublicRequest) : createHttpServer(forwardPublicRequest);
}

if (require.main === module) {
  const root = resolve(__dirname, '../..');
  const cert = readFileSync(resolve(root, process.env.SHOWCASE_TLS_CERT_FILE || '.local/showcase/tls.crt'));
  const key = readFileSync(resolve(root, process.env.SHOWCASE_TLS_KEY_FILE || '.local/showcase/tls.key'));
  // Verify the dedicated connection even if a developer's shell disables Node TLS checks globally.
  const upstream = { hostname: host, port: 5144, ca: cert, rejectUnauthorized: true };
  const server = createLocalApiServer((path, receive) => request({ ...upstream, path }, receive), { cert, key });
  server.listen(port, host, () => console.log(`WeChat simulator public API: https://${host}:${port}`));
}

module.exports = { createLocalApiServer };
