import {validRecordSlug} from './island-content.mjs';
export const articlePath=slug=>validRecordSlug(slug)?'/notes/'+encodeURIComponent(slug):'/notes';
export const inPlaceClick=event=>!event.defaultPrevented&&(event.button===undefined||event.button===0)&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey;
export function articleLink(label,cls,slug,navigate){
 const link=document.createElement('a');link.className=cls;link.textContent=label;link.href=articlePath(slug);
 link.addEventListener('click',event=>{if(inPlaceClick(event)){event.preventDefault();navigate();}});return link;
}
