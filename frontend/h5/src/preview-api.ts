import { readResponse, sameOriginApiPath, type Body, type PreviewSnapshot, type PublicItem } from '../../shared/contracts.ts';

/** Reject incomplete or malformed item and revision parameters without sending a request. */
export function validSelection(id:string,revision:string):boolean {
  return /^[1-9]\d{0,18}$/.test(id)&&/^(0|[1-9]\d{0,18})$/.test(revision)&&BigInt(id)<=9223372036854775807n&&BigInt(revision)<=9223372036854775807n;
}

/** A stale response is ignored even when the user switches away and back to the same draft. */
export function requestMatches(current:{id:string;revision:string;generation:number}, delivered:typeof current):boolean {
  return current.id===delivered.id && current.revision===delivered.revision && current.generation===delivered.generation;
}

/** Use the protected same-origin route and never fall back to the public client. */
export async function loadPreview(id:string,revision:string,signal?:AbortSignal):Promise<PreviewSnapshot> {
  if(!validSelection(id,revision))throw new TypeError('指定修订无效，请从后台重新打开预览。');
  const path=sameOriginApiPath(`/api/admin/items/${id}/preview?revision=${revision}`,'/api/admin/');
  const data=await readResponse<PreviewSnapshot>(await fetch(path,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal}));
  if(!data||data.id!==id||data.revision!==revision)throw new TypeError('预览响应和请求修订不一致。');
  return data;
}

/** Map saved asset IDs to the same view shape as public data without widening their permissions. */
export function previewItem(snapshot:PreviewSnapshot):PublicItem {
  function remap(record:Body):Body {
    const output:Body={};
    for(const [key,val] of Object.entries(record)){
      if(key.endsWith('_asset_id')&&typeof val==='string')output[key.slice(0,-3)+'_url']=snapshot.media_urls[val];
      else if(key.endsWith('_asset_ids')&&Array.isArray(val))output[key.slice(0,-4)+'_urls']=val.flatMap(id=>typeof id==='string'&&snapshot.media_urls[id]?[snapshot.media_urls[id]]:[]);
      else if(Array.isArray(val))output[key]=val.map(row=>row&&typeof row==='object'&&!Array.isArray(row)?remap(row as Body):row);
      else output[key]=val;
    }
    return output;
  }
  return {id:snapshot.id,body:remap(snapshot.body)};
}
