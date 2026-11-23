import { visitorUrl } from '../../shared/visitor-origin.ts';

/** Open the visitor site, not the admin app that owns this port. */
export function h5Path(path: string): string {
  return visitorUrl(path, window.location, import.meta.env.VITE_H5_ORIGIN ?? '');
}
