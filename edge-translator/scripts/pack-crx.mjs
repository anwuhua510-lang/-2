/**
 * 用 Edge（Chromium）的 --pack-extension 生成签名 .crx。
 *
 * 密钥（.pem）只生成一次，保存在 edge-translator/.keys/ 下；
 * 后续重新打包必须复用同一把密钥，否则扩展 ID 会变化。
 * .keys/、*.pem、*.crx 均不入库。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const keysDir = resolve(root, '.keys');
const keyPath = join(keysDir, 'edge-ai-translator.pem');
const crxOut = resolve(root, 'edge-ai-translator.crx');

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter((path) => typeof path === 'string' && path.length > 0);

const edge = EDGE_CANDIDATES.find((path) => existsSync(path));
if (!edge) {
  console.error('未找到 msedge.exe，请设置环境变量 EDGE_PATH 后重试');
  process.exit(1);
}
if (!existsSync(dist)) {
  console.error('dist 不存在，请先运行 npm run build');
  process.exit(1);
}

mkdirSync(keysDir, { recursive: true });

const args = [`--pack-extension=${dist}`];
if (existsSync(keyPath)) {
  args.push(`--pack-extension-key=${keyPath}`);
}

console.log(`打包 .crx：${edge}`);
const result = spawnSync(edge, args, { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('crx 打包失败');
  process.exit(result.status ?? 1);
}

const generatedCrx = resolve(root, 'dist.crx');
const generatedPem = resolve(root, 'dist.pem');

if (!existsSync(keyPath) && existsSync(generatedPem)) {
  renameSync(generatedPem, keyPath);
  console.log(`已生成并保存签名密钥：${keyPath}`);
  console.log('请妥善保管该密钥（丢失后扩展 ID 会变化，朋友需要重新安装）');
}

if (existsSync(generatedCrx)) {
  rmSync(crxOut, { force: true });
  renameSync(generatedCrx, crxOut);
  console.log(`已生成：${crxOut}`);
}
