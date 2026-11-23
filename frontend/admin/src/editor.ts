import { onBeforeRouteLeave } from 'vue-router';
import { computed, ref } from 'vue';
import { ApiError, message, object, type Body, type Item } from '../../shared/contracts.ts';
import { request } from './session.ts';

export const slots = [
  ['home_posters','首页海报'],['catalog_cover','目录封面'],['case_header','案例页头'],['services','服务说明'],['business_contact','商务联系'],
] as const;

/** Daily-list cleanup follows publication history, not just the current live pointer. */
export function canDelete(row: Pick<Item,'draft'|'has_history'|'live_id'|'archived_at'>):boolean {
  return Boolean(row.draft && !row.has_history && !row.live_id && !row.archived_at);
}
export function canArchive(row: Pick<Item,'has_history'|'live_id'|'archived_at'>):boolean {
  return Boolean(row.has_history && !row.live_id && !row.archived_at);
}

export interface AffectedCase {id:string; brand_name?:string|null; product_name?:string|null}

/** Related drafts can be unnamed and different cases can share a brand; keep the stable case ID visible. */
export function affectedCaseLabel(entry:AffectedCase):string {
  const brand=entry.brand_name?.trim();
  const name=entry.product_name?.trim() || '未命名案例';
  return `${brand ? `${brand} · ` : ''}${name}（#${entry.id}）`;
}

/** Present the actual directory path for a stable ID, including renamed ancestors. */
export function nodePath(nodes:readonly {id:string;name:string;parent_id?:string|null}[], id:string):string {
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const seen=new Set<string>(), names:string[]=[];
  let node=byId.get(id);
  while(node && !seen.has(node.id)) {names.unshift(node.name);seen.add(node.id);node=node.parent_id?byId.get(node.parent_id):undefined;}
  return names.join(' › ') || `位置 ${id}`;
}

/** Bind a restore to the revision shown in its confirmation dialog. */
export function restoreConfirmation(row:Pick<Item,'draft'|'revision'>,overwrite:boolean) {
  if(row.draft && !overwrite)return null;
  return {expected_revision:row.revision,confirm_overwrite:Boolean(row.draft)&&overwrite};
}

/** Copy only the fields belonging to the view, without mutating the last server snapshot. */
export function editableBody(item: Pick<Item,'draft'|'live'>): Body {
  return JSON.parse(JSON.stringify(item.draft ?? item.live ?? {})) as Body;
}

/** Rearrange only this parent's siblings and update the API's persisted sort order. */
export function moveWithinParent<T extends {id:string; parent_id?:string|null; sort_order:number}>(list:T[], id:string, step:-1|1): T[] {
  const target=list.find(row=>row.id===id); if(!target)return list;
  const peers=list.filter(row=>(row.parent_id||null)===(target.parent_id||null)).sort((a,b)=>a.sort_order-b.sort_order);
  const index=peers.findIndex(row=>row.id===id); if(!peers[index+step])return list;
  [peers[index],peers[index+step]]=[peers[index+step],peers[index]];
  const order=new Map(peers.map((row,i)=>[row.id,i]));
  return list.map(row=>order.has(row.id)?{...row,sort_order:order.get(row.id)!}:row);
}

/** Present the correct credential-bound URL for pending uploads or this saved draft. */
export function draftImage(item:Item|null, value:unknown, pending:Record<string,string>):string {
  if(typeof value!=='string'||!/^\d+$/.test(value))return '';
  if(pending[value])return pending[value];
  if(item?.draft)return `/api/admin/media/${value}?item_id=${item.id}&revision=${item.revision}`;
  return item?.live_id ? `/api/public/media/${value}` : '';
}

/** Upload bytes using the current editor identity without publishing them. */
export async function upload(file:File):Promise<{id:string;url:string}> {
  const data=new FormData();data.append('file',file);
  return request('/api/admin/media','POST',data);
}

/** Keep the working copy intact on 409; the user must explicitly reload or merge. */
export function useEditor() {
  const item=ref<Item|null>(null), body=ref<Body>({}), places=ref<string[]>([]), pending=ref<Record<string,string>>({});
  const busy=ref(false), error=ref(''), note=ref(''), conflict=ref(false);
  const dirty=computed(()=>JSON.stringify(body.value)!==JSON.stringify(editableBody(item.value??{draft:null,live:null}))||JSON.stringify(places.value)!==JSON.stringify(item.value?.place_ids??[]));
  onBeforeRouteLeave(()=>!dirty.value||globalThis.confirm('还有未保存的修改。确定离开吗？'));
  function accept(next:Item){item.value=next;body.value=editableBody(next);places.value=[...next.place_ids];pending.value={};conflict.value=false;}
  async function load(path:string){busy.value=true;error.value='';try{accept(await request<Item>(path));}catch(cause){error.value=message(cause);}finally{busy.value=false;}}
  async function save(collection?:'products'|'cases'){
    busy.value=true;error.value='';note.value='';conflict.value=false;
    try{
      const next=item.value?await request<Item>(`/api/admin/items/${item.value.id}/draft`,'PUT',{expected_revision:item.value.revision,body:body.value,place_ids:places.value}):await request<Item>(`/api/admin/${collection}`,'POST',{body:body.value,place_ids:places.value});
      accept(next);note.value='草稿已保存，线上版本未改变。';return next;
    }catch(cause){error.value=message(cause);conflict.value=cause instanceof ApiError&&cause.status===409;return null;}
    finally{busy.value=false;}
  }
  async function choose(event:Event, apply:(id:string)=>void){
    const input=event.currentTarget as HTMLInputElement, file=input.files?.[0]; if(!file)return;
    busy.value=true;error.value='';
    try{const next=await upload(file);pending.value={...pending.value,[next.id]:next.url};apply(next.id);}
    catch(cause){error.value=message(cause);}finally{busy.value=false;input.value='';}
  }
  return {item,body,places,pending,busy,error,note,conflict,dirty,accept,load,save,choose};
}

/** Read a typed field used by a shared form input. */
export const field = (body:Body,key:string) => object(body)[key];
