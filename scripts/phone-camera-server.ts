/** Local-only capture workspace. No dotenv, model provider, relay, or paid APIs. */
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createScanReviewApp,safeScanFile} from '../src/server/scan-review.ts';
import {initializeEmptyScanWorkspace} from '../src/server/empty-scan-workspace.ts';

// Usage: npx tsx scripts/phone-camera-server.ts [PORT=7447]
// Workspace: data/phone-preview, or PHONE_CAMERA_WORKSPACE (relative to cwd).
// PHONE_CAMERA_DIST_DIR overrides dist. Build with npm run build:phone.
const [portArg='7447',...extra]=process.argv.slice(2),port=Number(portArg);
if(extra.length||!Number.isInteger(port)||port<1||port>65535)throw new Error('Usage: phone-camera-server.ts [PORT=7447]');
process.env.ENABLE_SCAN_TEXT_AGENT='false';
process.env.ENABLE_SCAN_DETECTION='false';
process.env.ENABLE_ROOM_OBSERVER='false';
for(const key of ['MODEL_API_KEY','META_CREDITS_CONFIRMED','SCAN_AGENT_BUDGET_DIR','SCAN_DETECTION_BUDGET_DIR','ROOM_OBSERVER_BUDGET_DIR'])delete process.env[key];
const workspace=resolve(process.env.PHONE_CAMERA_WORKSPACE||'data/phone-preview');
const dist=resolve(process.env.PHONE_CAMERA_DIST_DIR||'dist');
if(!existsSync(join(dist,'index.html')))throw new Error(`Missing phone camera build: ${join(dist,'index.html')}`);
mkdirSync(dirname(workspace),{recursive:true});
if(!existsSync(workspace))initializeEmptyScanWorkspace(workspace);
const app=createScanReviewApp(workspace,{port,roomObserver:{},captureSourceKind:'device-camera'});
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
console.log(`Phone camera: http://127.0.0.1:${port}/mobile\nWorkspace: ${workspace}`);
let stopping=false;const shutdown=async()=>{if(stopping)return;stopping=true;await app.close();process.exitCode=0;};
process.once('SIGINT',()=>{void shutdown();});process.once('SIGTERM',()=>{void shutdown();});
