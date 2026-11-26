import {setupReader} from './reader-client.mjs?v=editorial-v2';
const root=document.querySelector('.reader-surface');if(root)setupReader(root,{manageProgress:true});
