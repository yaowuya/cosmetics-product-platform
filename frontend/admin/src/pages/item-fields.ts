// The editor and read-only viewer use the same field captions and asset slots.
export const basicFields=[{key:'name',label:'产品名称'},{key:'english_name',label:'英文名称（选填）'},{key:'formula_no',label:'配方编号'}];
export const detailFields=[{key:'benefit',label:'功效'},{key:'ingredients',label:'核心成分'},{key:'highlights',label:'产品亮点'}];
export const caseBasicFields=[{key:'brand_name',label:'品牌名称'},{key:'product_name',label:'案例产品名称'}];
export const caseExtraFields=[{key:'case_no',label:'案例编号（选填）'},{key:'series',label:'系列（选填）'}];
export const caseDetails=[{key:'highlight',label:'案例亮点'},{key:'description',label:'案例说明（选填）'}];
export const productMedia=[
  {key:'cover_asset_id',label:'产品封面图',hint:'用于 H5 列表和详情页顶部，建议 16:9。'},
  {key:'detail_asset_id',label:'产品详情长图',hint:'展示在详情页文字下方。'},
];
export const caseMedia=[{key:'image_asset_id',label:'案例图片'}];
