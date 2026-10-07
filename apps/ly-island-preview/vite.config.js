import {defineConfig} from 'vite';
export default defineConfig({base:'/island/',build:{target:'es2022',rolldownOptions:{preserveEntrySignatures:'strict',input:{island:'index.html',adminScene:'src/admin-scene.js'},output:{entryFileNames:chunk=>chunk.name==='adminScene'?'admin-scene.js':'assets/[name]-[hash].js',chunkFileNames:'assets/[name]-[hash].js'}}}});
