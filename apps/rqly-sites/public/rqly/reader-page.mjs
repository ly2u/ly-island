import {setupReader} from './reader-client.mjs';
const root=document.querySelector('.reader-surface');if(root)setupReader(root,{manageProgress:true});
