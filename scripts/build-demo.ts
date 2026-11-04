/** Build the selected virtual workshop without shell-specific environment syntax. */
import {spawn} from 'node:child_process';
const child=spawn(process.platform==='win32'?'npm.cmd':'npm',['run','build'],{stdio:'inherit',shell:process.platform==='win32',env:{...process.env,VITE_VIRTUAL_ENVIRONMENT:'model-maker-studio',VITE_STUDIO_LAYOUT:'bench-demo'}});
child.once('error',error=>{console.error(error.message);process.exitCode=1;});
child.once('exit',(code,signal)=>{process.exitCode=signal?1:code??1;});
process.once('SIGINT',()=>{child.kill('SIGINT');});
process.once('SIGTERM',()=>{child.kill('SIGTERM');});
