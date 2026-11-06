import {plainText} from './search-core.mjs';
export function noteTitle(body,date=''){
 const first=String(body||'').split(/\r?\n/).map(line=>plainText(line).trim()).find(Boolean)||('随手记录'+(date?' · '+date:''));
 let title='';for(const char of first){if(title.length+char.length>80)break;title+=char;}return title;
}
