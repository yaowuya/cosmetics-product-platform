import { withQuery, type CatalogNode } from '../../shared/contracts.ts';

/** Use the current node's complete enabled path, not a guessed label or demo hierarchy. */
export function children(nodes:CatalogNode[],id:string|null) {
  return nodes.filter(node=>(node.parent_id||null)===id&&node.enabled!==false).sort((a,b)=>a.sort_order-b.sort_order);
}

/** Keyword search is scoped to the current board, not the previously selected category. */
export function queryFor(board:string,node:string,keyword:string,page=1) {
  return withQuery('/api/public/products',{board_id:board,node_id:keyword.trim()?undefined:node,q:keyword.trim(),page,page_size:20});
}

/** Allow a late response to update only the request that actually triggered it. */
export function acceptResponse(previous:number,current:number):boolean {return previous===current;}

/** uni-input emits detail.value rather than a native HTMLInputElement as currentTarget. */
export function inputText(event: unknown): string {
  const input = event as { detail?: { value?: unknown }; target?: { value?: unknown } };
  const value = input.detail?.value ?? input.target?.value;
  return typeof value === 'string' ? value : '';
}

/** Only effective directory nodes are ever restored when switching boards. */
export interface BoardView { category:string; fine:string; q:string; left:number; right:number }
export function selectBoard(nodes:CatalogNode[], board:string, saved?:Partial<BoardView>):BoardView {
  const list=children(nodes,board);
  const category=list.find(n=>n.id===saved?.category)?.id??list[0]?.id??'';
  const fine=children(nodes,category).find(n=>n.id===saved?.fine)?.id??'';
  const offset=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:0;
  return {category,fine,q:typeof saved?.q==='string'?saved.q:'',left:offset(saved?.left),right:offset(saved?.right)};
}

export const CATALOG_KEY='showcase/catalog-view';
export const CASE_KEY='showcase/cases-view';
/** Persist only browse preferences for this tab, never content, identities or capabilities. */
export function prefs<T>(key:string,fallback:T):T {
  try { const value=sessionStorage.getItem(key);return value?{...fallback,...JSON.parse(value) as T}:fallback; } catch{return fallback;}
}
/** Keep the current tab's filters and scroll position for shallow detail return. */
export function remember(key:string,value:unknown) {try{sessionStorage.setItem(key,JSON.stringify(value));}catch{/* Storage is optional. */}}

/** Normalize query parameters from browser history aliases. */
export function queryValue(name:string):string {
  return typeof window==='undefined'?'':new URLSearchParams(window.location.search).get(name)??'';
}
