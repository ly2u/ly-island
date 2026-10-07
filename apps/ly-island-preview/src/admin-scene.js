import {IslandScene} from './scene.js';
export function createAdminScene(canvas,options){
 const scene=new IslandScene(canvas,{...options,centered:true},options.island,options.rules);
 scene.setPaused(true);scene.setArrange(true);
 const resize=new ResizeObserver(()=>{if(canvas.clientWidth&&canvas.clientHeight)scene.resize(true);});resize.observe(canvas);
 return scene;
}
