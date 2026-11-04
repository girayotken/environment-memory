import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('phone launcher isolates its workspace and disables observer even with hostile environment',async()=>{
 const root=mkdtempSync(join(tmpdir(),'phone-launch-')),dist=join(root,'dist');mkdirSync(dist);writeFileSync(join(dist,'index.html'),'phone fixture');
 writeFileSync(join(root,'.env'),'ENABLE_ROOM_OBSERVER=true\nMODEL_API_KEY=fixture\nMETA_CREDITS_CONFIRMED=true\n');
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=(socket.address() as {port:number}).port;await new Promise<void>(r=>socket.close(()=>r()));
 const child=spawn(process.execPath,['--import',import.meta.resolve('tsx'),resolve('scripts/phone-camera-server.ts'),String(port)],{cwd:root,env:{...process.env,PHONE_CAMERA_DIST_DIR:dist,ENABLE_ROOM_OBSERVER:'true',ENABLE_SCAN_TEXT_AGENT:'true',ENABLE_SCAN_DETECTION:'true',MODEL_API_KEY:'fixture',META_CREDITS_CONFIRMED:'true'},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 try{
  for(let i=0;i<100&&!output.includes('Phone camera:');i++){if(child.exitCode!==null)throw new Error(output);await new Promise(r=>setTimeout(r,50));}
  assert.match(output,/Phone camera:/);const base=`http://127.0.0.1:${port}`;
  assert.equal(await (await fetch(`${base}/mobile`)).text(),'phone fixture');
  assert.deepEqual(await (await fetch(`${base}/api/scan/captures`)).json(),{frames:[]});
  const state=await (await fetch(`${base}/api/scan/room-memory/automation`)).json();
  assert.deepEqual(state.provider,{name:null,enabled:false,reason:'Room observer is not configured.'});
  assert.ok(existsSync(join(root,'data/phone-preview/scan-workspace.sqlite')));
 }finally{child.kill('SIGTERM');if(child.exitCode===null)await once(child,'exit');rmSync(root,{recursive:true,force:true});}
});
