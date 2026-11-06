// Only the camera moves. Buildings, paths and saved island coordinates stay put.
export function readingFrame(width) {
 if(width<1100)return null;
 const paper=Math.min(1040,width-360),shore=width-paper-24;
 return {x:(width-shore)/width/2,y:0,zoom:1.65};
}
const mix=(a,b,t)=>a+(b-a)*t;
const vector=(a,b,t)=>a.map((v,i)=>mix(v,b[i],t));

export class SceneFocus {
 constructor(camera,controls){this.camera=camera;this.controls=controls;this.home=null;this.transition=null;}
 viewport(width,height,normal){
  this.size={width,height};this.normal={...normal};
  if(this.home)this.home.offset={...normal};
  if(this.transition?.returning)this.transition.to.offset={...normal};
  if(!this.home)this.offset(normal);
 }
 offset(value){const {width,height}=this.size;this.camera.setViewOffset(width,height,value.x*width,value.y*height,width,height);}
 snapshot(){const c=this.camera,v=c.view;return {position:c.position.toArray(),target:this.controls.target.toArray(),zoom:c.zoom,offset:v?.enabled?{x:v.offsetX/v.fullWidth,y:v.offsetY/v.fullHeight}:{x:0,y:0}};}
 apply(state){
  this.camera.position.fromArray(state.position);this.controls.target.fromArray(state.target);this.camera.zoom=state.zoom;this.offset(state.offset);
  this.camera.updateProjectionMatrix();this.controls.update();
 }
 focus(target,frame,{now=performance.now(),immediate=false}={}){
  // Flush any residual orbit inertia before taking the return position.
  const damping=this.controls.enableDamping;this.controls.enableDamping=false;this.controls.update();this.controls.enableDamping=damping;
  this.home??=this.snapshot();
  const delta=this.home.position.map((p,i)=>p-this.home.target[i]);
  this.move({position:target.map((v,i)=>v+delta[i]),target:[...target],zoom:frame.zoom,offset:{x:frame.x,y:frame.y}},{now,immediate,returning:false});
 }
 restore({now=performance.now(),immediate=false}={}){if(this.home)this.move({...this.home,offset:{...this.normal}},{now,immediate,returning:true});}
 move(to,{now,immediate,returning}){
  this.transition={from:this.snapshot(),to,start:now,returning};
  if(immediate){this.apply(to);this.transition=null;if(returning)this.home=null;}
 }
 step(now){
  const motion=this.transition;if(!motion)return false;
  const fraction=Math.max(0,Math.min(1,(now-motion.start)/420)),t=fraction*fraction*(3-2*fraction),a=motion.from,b=motion.to;
  this.apply(fraction===1?b:{position:vector(a.position,b.position,t),target:vector(a.target,b.target,t),zoom:mix(a.zoom,b.zoom,t),offset:{x:mix(a.offset.x,b.offset.x,t),y:mix(a.offset.y,b.offset.y,t)}});
  if(fraction===1){this.transition=null;if(motion.returning)this.home=null;}
  return true;
 }
}
