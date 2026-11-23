/** Use the system clipboard when permitted; display the selected-text fallback when unavailable. */
export async function copyText(value:string):Promise<boolean> {
  try{if(!value||!navigator.clipboard)return false;await navigator.clipboard.writeText(value);return true;}catch{return false;}
}

/** Return from an actual same-origin visit; deep links retain a reliable named fallback. */
export function goBack(fallback:string) {
  if(document.referrer && new URL(document.referrer).origin===window.location.origin && history.length>1) history.back();
  else window.location.assign(fallback);
}

/** Only show device options for genuinely reachable telephone or email values. */
export function phoneHref(number:string):string {return `tel:${number.replace(/[^\d+]/g,'')}`;}
