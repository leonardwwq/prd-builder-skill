#!/usr/bin/env node
/**
 * commit_paths.mjs —— 多会话共用一个 Git 仓库时，只提交指定路径。
 *
 * 用临时暂存区（GIT_INDEX_FILE）从 HEAD 出发，只 add 指定路径后一次性提交，
 * 不读也不改共享暂存区里别人 add 的东西；提交后把这些路径在共享暂存区里同步到新 HEAD。
 * 遵守 .gitignore（WORKLOG.md 不会被带进去）。不推送。
 *
 * 用法：
 *   node commit_paths.mjs -m "<提交说明>" [--dry-run] -- <路径…>
 *
 * 依赖：零。Node 18+，git。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
let msg = '';
let dry = false;
const paths = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '-m') msg = argv[++i] || '';
  else if (a === '--dry-run') dry = true;
  else if (a === '--') { paths.push(...argv.slice(i + 1)); break; }
  else paths.push(a);
}
if (!paths.length || (!msg && !dry)) {
  console.error('用法: node commit_paths.mjs -m "<提交说明>" [--dry-run] -- <路径…>');
  process.exit(2);
}

const git = (args, env, opts = {}) =>
  execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env }, ...opts }).toString();

let top;
try {
  top = git(['rev-parse', '--show-toplevel']).trim();
} catch {
  console.error('当前目录不在 Git 仓库里。');
  process.exit(2);
}
const rel = paths.map((p) => {
  const r = path.relative(top, path.resolve(p)).split(path.sep).join('/');
  if (r.startsWith('..')) {
    console.error(`路径不在仓库内：${p}`);
    process.exit(2);
  }
  return r || '.';
});

let hasHead = true;
try { git(['rev-parse', '--verify', '-q', 'HEAD'], {}, { cwd: top }); } catch { hasHead = false; }

const tmpIndex = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'commit-paths-')), 'index');
const env = { GIT_INDEX_FILE: tmpIndex };
const cleanup = () => fs.rmSync(path.dirname(tmpIndex), { recursive: true, force: true });

try {
  if (hasHead) git(['read-tree', 'HEAD'], env, { cwd: top });
  git(['add', '-A', '--', ...rel], env, { cwd: top });
  const changes = git(['diff', '--cached', '--name-status', ...(hasHead ? ['HEAD'] : []), '--', ...rel], env, { cwd: top }).trim();
  if (!changes) {
    console.log('这些路径相对 HEAD 没有改动，不提交。');
    cleanup();
    process.exit(0);
  }
  console.log(`将提交（只含指定路径，${changes.split('\n').length} 个文件）：\n${changes}`);
  if (dry) {
    console.log('\n--dry-run：未提交。');
    cleanup();
    process.exit(0);
  }
  git(['commit', '-q', '-m', msg], env, { cwd: top });
  const head = git(['log', '-1', '--format=%h %s'], {}, { cwd: top }).trim();
  console.log(`\n已提交：${head}`);
} catch (e) {
  cleanup();
  console.error(`提交失败：${(e.stderr || e.message || '').toString().trim()}`);
  process.exit(1);
}
cleanup();

// 共享暂存区里这些路径同步到新 HEAD，避免 git status 显示成「已暂存的反向改动」
try {
  git(['reset', '-q', 'HEAD', '--', ...rel], {}, { cwd: top });
} catch (e) {
  console.warn(`提交已完成，但同步共享暂存区失败（可能有别的会话正占用）：稍后执行 git reset -q HEAD -- ${rel.join(' ')}\n${(e.stderr || '').toString().trim()}`);
}
console.log('未推送；需要时先 git log origin/<分支>..HEAD 看清再推。');
