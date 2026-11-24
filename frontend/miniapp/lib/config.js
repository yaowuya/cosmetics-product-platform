/** Reviewer, release and local builds never inherit one another's destination. */
const ORIGINS = Object.freeze({
  develop: 'http://127.0.0.1:5145', // Local simulator bridge only; never used by trial or release.
  trial: 'https://www.zhongwuya.site',
  release: '',
});

const ENVIRONMENTS = ['develop', 'trial', 'release'];
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/;
const LOCAL_SUFFIX = /\.(?:localhost|local|internal|test|invalid|example)$/;

function privateV4(host) {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every(part => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** Resolve only a configured origin. Public environments additionally need WeChat's legal-domain check. */
function resolveOrigin(version, origins = ORIGINS) {
  if (!ENVIRONMENTS.includes(version)) return '';
  const value = origins[version];
  if (typeof value !== 'string' || value !== value.trim()) return '';
  // Do not depend on the browser URL class; exclude userinfo, paths, queries and fragments up front.
  const match = /^(https?):\/\/([a-z0-9.-]+|\[::1\])(?::([1-9]\d{0,4}))?$/i.exec(value);
  if (!match) return '';
  const [, scheme, address, port] = match;
  const protocol = scheme.toLowerCase();
  const host = address.toLowerCase();
  if (port && Number(port) > 65535) return '';
  const local = host === 'localhost' || host === '[::1]' || privateV4(host);
  if (version === 'develop' && local) return `${protocol}://${host}${port ? `:${port}` : ''}`;
  if (protocol !== 'https' || (port && port !== '443') || host.length > 253 || !HOST.test(host) || LOCAL_SUFFIX.test(host)) return '';
  return `https://${host}`;
}

module.exports = { resolveOrigin };
