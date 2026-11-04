/** Local-only capture workspace. No dotenv, model provider, relay, or paid APIs. */
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createScanReviewApp,safeScanFile} from '../src/server/scan-review.ts';
import {initializeEmptyScanWorkspace} from '../src/server/empty-scan-workspace.ts';

// Capture-only preview: existing saved pixels are readable; no inference providers are configured.
const [portArg='7460',workspaceArg='data/mobile-preview',...extra]=process.argv.slice(2),port=Number(portArg);
if(extra.length||!Number.isInteger(port)||port<1||port>65535)throw new Error('Usage: mobile-preview.ts [PORT=7460] [WORKSPACE=data/mobile-preview]');
for(const key of ['ENABLE_LIVE_META_API','ENABLE_LIVE_VISIT_COMPARISON','ENABLE_SCAN_TEXT_AGENT','ENABLE_SCAN_DETECTION','ENABLE_ROOM_OBSERVER'])process.env[key]='false';
process.env.META_CREDITS_CONFIRMED='false';
for(const key of ['MODEL_API_KEY','META_API_KEY','OPENAI_API_KEY','SCAN_AGENT_BUDGET_DIR','SCAN_DETECTION_BUDGET_DIR','ROOM_OBSERVER_BUDGET_DIR'])delete process.env[key];
const workspace=resolve(workspaceArg),dist=resolve('dist');
if(!existsSync(join(dist,'index.html')))throw new Error('Missing demo build. Run npm run build:demo first.');
mkdirSync(dirname(workspace),{recursive:true});
if(!existsSync(workspace))initializeEmptyScanWorkspace(workspace);
const app=createScanReviewApp(workspace,{port,roomObserver:{}});
app.get('/',async(_request,reply)=>reply.redirect('/mobile'));
for(const route of ['/mobile','/scan-review'])app.get(route,async(_request,reply)=>reply.type('text/html').header('Cache-Control','no-store').send(readFileSync(safeScanFile(dist,'index.html'))));
app.get<{Params:{'*':string}}>('/assets/*',async(request,reply)=>{
 try{
  const name=request.params['*'];if(!/^[a-zA-Z0-9_.-]+$/.test(name))return reply.code(404).send();
  const mime:Record<string,string>={js:'text/javascript',css:'text/css',png:'image/png',svg:'image/svg+xml',woff2:'font/woff2'},ext=name.split('.').at(-1);
  if(!mime[ext!])return reply.code(404).send();
  return reply.type(mime[ext!]).send(readFileSync(safeScanFile(join(dist,'assets'),name)));
 }catch{return reply.code(404).send();}
});
await app.listen({host:'127.0.0.1',port});
console.log(`Capture-only preview: http://127.0.0.1:${port}/mobile\nWorkspace: ${workspace}\nRecognition and paid APIs are disabled. Saved views are not analyzed.`);
let stopping=false;const shutdown=async()=>{if(stopping)return;stopping=true;await app.close();process.exitCode=0;};
process.once('SIGINT',()=>{void shutdown();});process.once('SIGTERM',()=>{void shutdown();});
