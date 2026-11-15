import {setupReader} from './reader-client.mjs?v=settings-v1';
const root=document.querySelector('.reader-surface');if(root)setupReader(root,{manageProgress:true});
