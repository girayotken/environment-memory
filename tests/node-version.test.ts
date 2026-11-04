import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const run=(code:string)=>spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});
test('Node guard permits supported majors and rejects unsupported or malformed versions',()=>{
 const r=run(`import {supportedNode} from './scripts/check-node.mjs'; console.log(JSON.stringify(['20.19.0','22.0.0','23.11.0','24.0.0','24.22.1','25.0.0','26.0.0','27.0.0','garbage'].map(supportedNode)));`);
 assert.equal(r.status,0,r.stderr);
 assert.deepEqual(JSON.parse(r.stdout),[false,false,false,true,true,true,true,false,false]);
});
test('Unsupported Node reports an actionable message before dependencies load',()=>{
 const r=run(`import {checkNode} from './scripts/check-node.mjs'; if (!checkNode('20.19.0')) process.exitCode=1;`);
 assert.equal(r.status,1);assert.match(r.stderr,/requires Node.js 24–26/);assert.match(r.stderr,/Detected Node.js 20.19.0/);assert.match(r.stderr,/node:sqlite/);
});
test('Install and all user-facing npm commands run the Node guard first',()=>{
 const {scripts}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 for(const name of ['install','dev','dev:client','dev:server','start','build','build:demo','build:phone','demo','demo:phone','test','check','mcp:memory'])assert.equal(scripts[`pre${name}`],'node scripts/check-node.mjs',name);
});
