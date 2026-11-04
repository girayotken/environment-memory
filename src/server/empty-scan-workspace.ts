import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {ScanStore} from './scan-store.ts';

/** Create only a new empty workspace; never modify or replace an existing directory. */
export function initializeEmptyScanWorkspace(directory:string):string{
 const root=resolve(directory);
 mkdirSync(root); // EEXIST protects every pre-existing workspace, including empty ones.
 try{
  const store=new ScanStore(root);store.close();
  const manifest={schemaVersion:1,purpose:'Empty workspace; no imported observations.',networkCalls:0,inputHash:createHash('sha256').update('').digest('hex'),cards:[]};
  writeFileSync(join(root,'scan-review-manifest.json'),JSON.stringify(manifest),{flag:'wx'});
  return root;
 }catch(error){rmSync(root,{recursive:true,force:true});throw error;}
}
