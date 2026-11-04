import {initializeEmptyScanWorkspace} from '../src/server/empty-scan-workspace.ts';
const directory=process.argv[2];
if(!directory||process.argv.length!==3)throw new Error('Usage: tsx scripts/initialize-empty-workspace.ts NEW_DIRECTORY');
console.log(initializeEmptyScanWorkspace(directory));
