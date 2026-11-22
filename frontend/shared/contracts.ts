/** 数据库标识和修订均以十进制文本传输，不转为 JavaScript Number。 */
export type WireId = string;
export type Revision = string;

/** 保存可定位到编辑控件的后端校验结果。 */
export interface Issue {
  field: string;
  reason: string;
}

/** 后端业务失败保留状态和错误字段，不携带请求凭据。 */
export class ApiError extends Error {
  declare readonly status: number;
  declare readonly code: string;
  declare readonly issues: Issue[];

  constructor(status: number, code: string, message: string, issues: Issue[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

/** 解读 JSON 或空成功响应；错误保持 HTTP 状态，不伪装成业务成功。 */
export async function readResponse<T>(response: Response): Promise<T | undefined> {
  if (response.ok) {
    return response.status === 204 ? undefined : (await response.json()) as T;
  }

  const error = await response.json().catch(() => undefined) as
    | { code?: string; message?: string; issues?: Issue[] }
    | undefined;
  throw new ApiError(
    response.status,
    typeof error?.code === 'string' ? error.code : 'http_error',
    typeof error?.message === 'string' ? error.message : `HTTP ${response.status}`,
    Array.isArray(error?.issues) ? error.issues : [],
  );
}

/** 仅允许指定同源 API 路径族；解析后的结果而非原文决定归属。 */
export function sameOriginApiPath(path: string, prefix: '/api/public/' | '/api/admin/'): string {
  // 固定的虚拟来源仅用于解析相对地址，不作为任何实际请求目标。
  const origin = 'https://same-origin.invalid';
  if (!path.startsWith(prefix)) {
    throw new TypeError('Expected a relative path in the selected API family');
  }
  const parsed = new URL(path, origin);
  if (parsed.origin !== origin || !parsed.pathname.startsWith(prefix) || parsed.hash) {
    throw new TypeError('Invalid API path');
  }
  return parsed.pathname + parsed.search;
}

/** Wire records shared by the desktop and mobile applications. */
export type Body = Record<string, unknown>;
export type Kind = 'product' | 'case' | 'config';
export interface Account { id: string; login: string; enabled?: boolean; can_edit: boolean; can_publish: boolean; can_manage: boolean; must_change_password: boolean }
export interface SessionAccount extends Account { csrf_token: string }
export interface Item { id: string; kind: Kind; config_slot: string | null; revision: string; live_id: string | null; draft: Body | null; live: Body | null; place_ids: string[]; archived_at: string | null; has_history: boolean; summary?: Body }
export interface Page<T> { items: T[]; total: number; page: number; page_size: number }
export interface CatalogNode { id: string; parent_id?: string | null; level: 'board' | 'category' | 'subcategory'; name: string; sort_order: number; enabled?: boolean; icon_asset_id?: string; icon_url?: string | null }
export interface Catalog { nodes: CatalogNode[]; counts: Record<string, number> }
export interface PublicItem { id: string; body: Body }
export interface PublicPage { page: string; body: Body }
export interface ReleaseCheck { id: string; revision: string; eligible: boolean; issues: Issue[]; place_ids: string[] }
export interface Receipt { id: string; revision: string; release_id: string; seq: number; request_key: string }
export interface Version { seq: number; release_id: string; source_revision: string; actor_id: string; created_at: string; body: Body; place_ids: string[] }
export interface AuditRow { id: string; actor_id: string; action: string; target_kind: string; target_id: string; occurred_at: string; details: Body; request_key: string | null }
export interface PreviewSnapshot { id: string; kind: Kind; config_slot: string | null; revision: string; body: Body; place_ids: string[]; media_urls: Record<string, string> }

/** Extract display text without casting missing JS values to user-visible strings. */
export function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Treat only a real object as a content record. */
export function object(value: unknown): Body {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Body : {};
}

/** Read nested authored lists without accepting objects or primitive fields as rows. */
export function rows(value: unknown): Body[] {
  return Array.isArray(value) ? value.map(object) : [];
}

/** Convert an API/transport failure to one operator-readable message. */
export function message(error: unknown): string {
  return error instanceof ApiError ? error.message : '无法连接服务，请稍后重试。';
}

/** Build a relative path query from the API's named filters. */
export function withQuery(path: string, values: Record<string, string | number | boolean | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  return query.size ? `${path}?${query}` : path;
}
