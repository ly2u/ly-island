export const sceneState=island=>Object.fromEntries(['phase','lighting','layouts','scenery','decorations'].map(key=>[key,structuredClone(island[key])]));
export class LayoutHistory {
 constructor(value,limit=30){this.limit=Math.max(2,Math.min(100,limit));this.reset(value);}
 reset(value){this.saved=JSON.stringify(value);this.entries=[this.saved];this.index=0;}
 record(value){const next=JSON.stringify(value);if(next===this.entries[this.index])return false;this.entries=this.entries.slice(0,this.index+1);this.entries.push(next);if(this.entries.length>this.limit)this.entries.shift();this.index=this.entries.length-1;return true;}
 get canUndo(){return this.index>0;}
 get canRedo(){return this.index<this.entries.length-1;}
 undo(){if(!this.canUndo)return null;return JSON.parse(this.entries[--this.index]);}
 redo(){if(!this.canRedo)return null;return JSON.parse(this.entries[++this.index]);}
 get baseline(){return JSON.parse(this.saved);}
}
