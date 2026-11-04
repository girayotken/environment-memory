/** Dependency-free: show a useful error before TypeScript or node:sqlite loads. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function supportedNode(version) {
  const match = /^(\d+)\.\d+\.\d+$/.exec(version);
  return Boolean(match && Number(match[1]) >= 24 && Number(match[1]) < 27);
}

export function checkNode(version = process.versions.node) {
  if (supportedNode(version)) return true;
  console.error(`Environment Memory requires Node.js 24–26. Detected Node.js ${version}.\nInstall or switch to Node.js 24, then run the command again.\nIf you use nvm: nvm install && nvm use (this project includes .nvmrc).\nThe application uses node:sqlite; older Node versions cannot run this project.`);
  return false;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!checkNode()) process.exitCode = 1;
}
