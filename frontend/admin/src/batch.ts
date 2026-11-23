import { ApiError, text, withQuery, type Item, type Page, type AuditRow, type Receipt, type ReleaseCheck } from '../../shared/contracts.ts';
import { request } from './session.ts';

const fieldLabels: Record<string, string> = {
  name: '产品名称', title: '标题', benefit: '功效', ingredients: '核心成分', highlights: '产品亮点',
  formula_no: '配方编号', production_status: '生产状态', brand_name: '品牌名称', product_name: '案例产品名',
  highlight: '案例亮点', description: '说明', intro: '介绍', detail_asset_id: '产品详情长图',
  thumbnail_asset_id: '产品方图', cover_asset_id: '封面', short_benefit: '简短功效', place_ids: '展示位置',
  nodes: '板块与分类', poster_asset_ids: '首页海报', qr_asset_id: '商务二维码', image_asset_id: '案例图片',
  cards: '服务卡片', filters: '案例分类', draft: '草稿', revision: '修订号', id: '条目编号',
};

/** 单款差异和发布检查沿用相同字段名；未登记的校验字段保留原路径。 */
export function releaseFieldLabel(field: string): string {
  return fieldLabels[field] ?? field;
}

/** 返回检查时用于辨识产品的文本，不保留整份草稿；无稿时仍可用列表摘要或线上资料。 */
export function productCaption(item: Item): string {
  const body = item.draft ?? item.live;
  const name = text(item.summary?.name ?? body?.name) || `产品 ${item.id}`;
  const formula = text(item.summary?.formula_no ?? body?.formula_no) || '未设置';
  return `${name} · 配方编号：${formula}`;
}

/** Only explicitly checked, still-current eligible revisions may enter the confirm queue. */
export function toConfirm(checks:ReleaseCheck[], items:Pick<Item,'id'|'revision'>[]) {
  const ids=new Map(items.map(row=>[row.id,row.revision]));
  return checks.filter(check=>check.eligible&&ids.get(check.id)===check.revision);
}

/** Preserve the same request key and source revision after an ambiguous result. */
export interface Attempt { id:string; revision:string; key:string; kind:Item['kind'] }
export function newAttempt(item:Pick<Item,'id'|'revision'|'kind'>):Attempt {
  return {id:item.id,revision:item.revision,key:crypto.randomUUID(),kind:item.kind};
}

/** Delays/timeouts do not imply that publication failed. */
export function ambiguous(error:unknown):boolean {
  return !(error instanceof ApiError)||error.status>=500;
}

/** Keep only verifiable receipt identifiers in storage; never keep draft contents. */
export function decodeAttempts(raw:string|null):Attempt[] {
  try {const saved:unknown=JSON.parse(raw??'[]');if(!Array.isArray(saved))return [];
    return saved.filter((row):row is Attempt=>row!==null&&typeof row==='object'&&typeof row.id==='string'&&/^[1-9]\d*$/.test(row.id)&&typeof row.revision==='string'&&/^\d+$/.test(row.revision)&&['product','case','config'].includes(row.kind)&&typeof row.key==='string'&&/^[\w-]{1,128}$/.test(row.key)).map(({id,revision,key,kind})=>({id,revision,key,kind}));
  }catch{return [];}
}
export function readAttempts(owner:string):Attempt[]{try{return decodeAttempts(localStorage.getItem(`showcase/pending-receipts/${owner}`));}catch{return [];}}

/** A receipt must attest to exactly the source revision the operator confirmed. */
export function matchesReceipt(attempt:Attempt, row:AuditRow|undefined):Receipt|null {
  const receipt=row?.details.receipt as Receipt|undefined;
  return row?.target_id===attempt.id && row.target_kind===attempt.kind && row.details.source_revision===attempt.revision && row.request_key===attempt.key && receipt?.id===attempt.id && receipt.request_key===attempt.key ? receipt : null;
}

/** Read an existing receipt without guessing or writing anything. */
export async function verifyAttempt(attempt:Attempt):Promise<Receipt|null> {
  const ledger=await request<Page<AuditRow>>(withQuery('/api/admin/audit',{target_kind:attempt.kind,target_id:attempt.id,request_key:attempt.key,page:1,page_size:1}));
  return matchesReceipt(attempt,ledger.items[0]);
}

/** Publish one exact revision with its known receipt key. */
export function publishAttempt(attempt:Attempt):Promise<Receipt> {
  return request(`/api/admin/items/${attempt.id}/publish`,'POST',{expected_revision:attempt.revision,request_key:attempt.key});
}

/** A missing audit entry is not proof of failure; never send a new key or bypass operator confirmation. */
export async function reconcileAttempt(attempt:Attempt, confirmRetry:()=>boolean):Promise<Receipt|null> {
  const receipt=await verifyAttempt(attempt);
  return receipt ?? (confirmRetry() ? await publishAttempt(attempt) : null);
}
