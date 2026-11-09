import {setupReader} from './reader-client.mjs?v=seo-v1';
const root=document.querySelector('.reader-surface');if(root)setupReader(root,{manageProgress:true});
