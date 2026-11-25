import type { Body } from '../../../shared/contracts.ts';

// The editor and read-only viewer use the same field captions and asset slots.
export const basicFields=[{key:'name',label:'产品名称'},{key:'english_name',label:'英文名称（选填）'},{key:'formula_no',label:'配方编号'}];
export const detailFields=[{key:'benefit',label:'功效'},{key:'ingredients',label:'核心成分'},{key:'highlights',label:'产品亮点'}];
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
