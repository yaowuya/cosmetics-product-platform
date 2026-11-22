import {strict as assert} from 'node:assert';
import {readFile, stat} from 'node:fs/promises';
import {test} from 'node:test';

test('两端的发布包不依赖本地设计稿、模拟身份或演示图片数据',async()=>{
 for(const dir of ['../admin/dist/','../h5/dist/build/h5/']){
   const base=new URL(dir,import.meta.url),html=await readFile(new URL('index.html',base),'utf8');
   assert.doesNotMatch(html,/__FP_PROTOTYPE__|demoAssets|prototype\.html|fp-docs\/changes/);
   const entries=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]; assert.ok(entries.length);
   for(const [,src] of entries){const file=new URL(src.replace(/^\/(?:admin\/)?/,''),base);assert.ok((await stat(file)).isFile());assert.doesNotMatch(await readFile(file,'utf8'),/__FP_PROTOTYPE__|重置演示数据|切换模拟身份/);}
 }
});
