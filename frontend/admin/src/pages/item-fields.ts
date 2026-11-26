import { text, type Body, type Issue } from '../../../shared/contracts.ts';

// The editor and read-only viewer use the same field captions and asset slots.
export const basicFields=[{key:'name',label:'产品名称'},{key:'english_name',label:'英文名称（选填）'},{key:'formula_no',label:'配方编号'}];
export const detailFields=[
  {key:'benefit',label:'功效',rows:6},
  {key:'ingredients',label:'核心成分',rows:8},
  {key:'highlights',label:'产品亮点',rows:10},
];
export const caseBasicFields=[{key:'brand_name',label:'品牌名称'},{key:'product_name',label:'案例产品名称'}];
export const caseExtraFields=[{key:'case_no',label:'案例编号（选填）'},{key:'series',label:'系列（选填）'}];
export const caseDetails=[{key:'highlight',label:'案例亮点'},{key:'description',label:'案例说明（选填）'}];
export const productMedia=[
  {key:'thumbnail_asset_id',label:'目录方图',hint:'用于产品目录卡片，建议上传 1:1 白底产品图。'},
  {key:'cover_asset_id',label:'产品封面图',hint:'用于产品详情页顶部，建议使用 16:9 横图。'},
];
export const caseMedia=[{key:'image_asset_id',label:'案例图片'}];

export const productDetailPictureLimit = 3;

/** Read the saved order, treating an explicitly empty gallery as a removal of the old image. */
export function productDetailAssets(body: Body | null | undefined): string[] {
  const images = Array.isArray(body?.detail_asset_ids) ? body.detail_asset_ids : [body?.detail_asset_id];
  return images.filter((id): id is string => typeof id === 'string' && /^[1-9][0-9]*$/.test(id));
}

type ItemKind = 'product' | 'case';
const editorFields = {
  product: [
    [...basicFields.map(field => field.key), 'production_status', 'short_benefit'],
    detailFields.map(field => field.key),
    [...productMedia.map(field => field.key), 'detail_asset_ids', 'place_ids'],
  ],
  case: [
    [...caseBasicFields.map(field => field.key), 'category_key', 'related_product_id', ...caseExtraFields.map(field => field.key)],
    [...caseDetails.map(field => field.key), ...caseMedia.map(field => field.key), 'sort_order'],
  ],
};
const requiredEditorFields = {
  product: ['name', 'formula_no', 'production_status', 'short_benefit', ...detailFields.map(field => field.key),
    'cover_asset_id', 'detail_asset_ids', 'place_ids'],
  case: [...caseBasicFields.map(field => field.key), 'highlight', 'image_asset_id'],
};

/** Identify the saved-draft fields that need a value, including grouped controls. */
export function isDraftFieldRequired(kind: ItemKind, field: string): boolean {
  return requiredEditorFields[kind].includes(field);
}

/** Check missing draft fields before a request. Image and directory validity still belong to the API. */
export function requiredDraftIssues(kind: ItemKind, body: Body, placements: readonly string[]): Issue[] {
  const missing: Record<string, string> = {};
  for (const field of requiredEditorFields[kind]) {
    if (!text(body[field]).trim()) missing[field] = '请填写此必填项';
  }
  if (kind === 'product') {
    if (productDetailAssets(body).length) delete missing.detail_asset_ids;
    else missing.detail_asset_ids = '请上传至少 1 张详情竖图';
    if (placements.length) delete missing.place_ids;
    else missing.place_ids = '请选择至少 1 个展示位置';
    if (missing.cover_asset_id) missing.cover_asset_id = '请上传产品封面图';
  } else if (missing.image_asset_id) {
    missing.image_asset_id = '请上传案例图片';
  }
  return Object.entries(missing).map(([field, reason]) => ({field, reason}));
}

/** Match API paths to their editor controls, including indexed issues in the legacy/current gallery. */
export function draftIssueLocations(kind: ItemKind, issues: readonly Issue[]) {
  const fields = editorFields[kind];
  const errors: Record<string, string> = {};
  const unmapped: Issue[] = [];
  for (const issue of issues) {
    const root = issue.field.replace(/^(?:body\.)+/, '').split('.')[0];
    const field = root === 'detail_asset_id' ? 'detail_asset_ids' : root;
    if (fields.some(step => step.includes(field))) errors[field] ??= issue.reason;
    else unmapped.push(issue);
  }
  for (const [step, keys] of fields.entries()) {
    const field = keys.find(key => errors[key]);
    if (field) return {errors, unmapped, first: {field, step}};
  }
  return {errors, unmapped, first: null};
}
