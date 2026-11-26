/** Admin and H5 are separate listeners. These pairs are the ones the handbook and Makefile publish. */
const VISITOR_PORTS: Record<string, string> = { '5001': '5000', '5173': '5174' };

/**
 * Prefix a visitor path with the H5 origin when this page is the admin listener.
 * A combined deployment has no mapped port, so the path stays relative.
 */
export function visitorUrl(
  path: string,
  location: { protocol: string; hostname: string; port: string },
  configured = '',
): string {
  if (!path) return '';
  const explicit = configured.replace(/\/$/, '');
  const mapped = explicit ? '' : VISITOR_PORTS[location.port];
  const origin = explicit || (mapped ? `${location.protocol}//${location.hostname}:${mapped}` : '');
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}
