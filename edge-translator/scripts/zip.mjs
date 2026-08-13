/**
 * 把 dist 打包成可分发的 zip（Windows，使用系统 PowerShell）。
 * 产物：edge-translator.zip（解压后直接是 manifest.json 所在目录）。
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const zipPath = resolve(root, 'edge-translator.zip');
const psCommand =
  `Compress-Archive -Path '${resolve(root, 'dist')}\\*' -DestinationPath '${zipPath}' -Force`;

const result = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-Command', psCommand],
  { stdio: 'inherit' },
);

if (result.status !== 0) {
  console.error('zip failed');
  process.exit(result.status ?? 1);
}
console.log(`created ${zipPath}`);
