import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {PNG} from 'pngjs';

test('offline import verifies exact source RGB even if a forged crop has a consistent new hash and region ID',()=>{
 const root=mkdtempSync(join(tmpdir(),'belief-import-')),hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
 try{
  const packet=join(root,'packet'),trial=join(root,'trial');mkdirSync(join(packet,'predictor'),{recursive:true});mkdirSync(join(trial,'call-1'),{recursive:true});
  const source=new PNG({width:3,height:3});for(let i=0;i<9;i++)source.data.set([i+20,50,80,255],i*4);
  const sourceBytes=PNG.sync.write(source),sourceHash=hash(sourceBytes),b={left:1,top:1,right:3,bottom:3};
  writeFileSync(join(packet,'predictor/frame.png'),sourceBytes);
  writeFileSync(join(packet,'predictor/inputs.json'),JSON.stringify({frames:[{id:'frame',image:'frame.png',sha256:sourceHash,width:3,height:3,split:'development',sequence:'declared-sequence'}]}));
  writeFileSync(join(trial,'ledger.json'),JSON.stringify([{key:sourceHash+':discover',status:'completed'}]));
  writeFileSync(join(trial,'call-1/response.json'),JSON.stringify({created_at:1793188328}));
  const crop=new PNG({width:2,height:2});for(let y=0;y<2;y++)for(let x=0;x<2;x++)source.data.copy(crop.data,(y*2+x)*4,((y+1)*3+x+1)*4,((y+1)*3+x+1)*4+4);
  function save(){const bytes=PNG.sync.write(crop),id=hash(sourceHash+JSON.stringify([1,1,3,3])+hash(bytes));
   writeFileSync(join(trial,id+'.png'),bytes);writeFileSync(join(trial,id+'.json'),JSON.stringify({id,frame:'frame',sourceSha256:sourceHash,bounds:b,foregroundPixels:4,method:'automatic-sam-proposal'}));return id;}
  function run(output:string){return spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/belief-import-smoke.ts',packet,trial,output],{encoding:'utf8'});}
  const original=save(),good=join(root,'good.json'),passed=run(good);assert.equal(passed.status,0,passed.stderr);
  const event=JSON.parse(readFileSync(good,'utf8')).events[0];assert.equal(event.observations.length,1);assert.equal(event.observations[0].scope,'unknown');
  rmSync(join(trial,original+'.json'));rmSync(join(trial,original+'.png'));crop.data[0]^=8;save();
  const bad=join(root,'bad.json'),failed=run(bad);assert.notEqual(failed.status,0);assert.match(failed.stderr,/Crop RGB differs from source/);assert.equal(existsSync(bad),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
