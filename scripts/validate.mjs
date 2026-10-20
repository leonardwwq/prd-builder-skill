#!/usr/bin/env node
/**
 * validate.mjs —— 需求工作区自检。没有错误才算能交付。
 *
 * 用法：
 *   node validate.mjs <页面目录>   # 检查单页（同时做所在版本目录的版本级检查）
 *   node validate.mjs <版本目录>   # 检查版本下所有 NN-* 页面 + 版本级检查
 *
 * 依赖：零。Node 18+。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  OLD_ID_RE, read, resolveTarget, pageNo, yamlSections, definedIds, mentionedIds, pageIndex, listPageDirs,
  versionDecisionIds, parseGlossary,
} from './lib.mjs';

const target = process.argv[2];
if (!target) {
  console.error('用法: node validate.mjs <页面目录或版本目录>');
  process.exit(2);
}

const { mode, versionDir, pages } = resolveTarget(target);
const version = path.basename(versionDir);
const index = pageIndex(versionDir);
const indexText = read(path.join(versionDir, 'index.md')) || '';
const versionDecisions = versionDecisionIds(indexText);
const versionDecisionSet = new Set(versionDecisions);
/* 术语表：版本 index + 工作区根 readme（versions/<版本号>/ → 上两级；老结构 <版本号>/ → 上一级） */
const workspaceRoot = path.basename(path.dirname(versionDir)) === 'versions'
  ? path.dirname(path.dirname(versionDir))
  : path.dirname(versionDir);
const glossary = [
  ...parseGlossary(indexText),
  ...parseGlossary(read(path.join(workspaceRoot, 'readme.md')) || ''),
];
const aliasMap = new Map(); // 别名 → 标准叫法
for (const { term, aliases } of glossary) for (const a of aliases) if (a !== term) aliasMap.set(a, term);
const standardTerms = [...new Set(glossary.map((g) => g.term))].sort((a, b) => b.length - a.length);

let totalErr = 0;
let totalWarn = 0;
const blocks = [];

/* ================= 版本级检查 ================= */
{
  const errors = [];
  const warns = [];
  const oks = [];

  const allPages = listPageDirs(versionDir);
  if (mode === 'version' && !allPages.length) {
    if (fs.existsSync(path.join(versionDir, 'index.md')) || fs.existsSync(path.join(versionDir, 'WORKLOG.md'))) {
      warns.push('还没有任何 NN-<页面名> 页面目录（梳理阶段正常；交付前必须有）');
    } else {
      errors.push('这个目录下没有任何 NN-<页面名> 页面目录，也不像版本目录（没有 index.md / WORKLOG.md）');
    }
  }

  for (const [no, list] of index) {
    if (list.length > 1) errors.push(`页号 ${no} 重复：${list.map((p) => p.name).join('、')}`);
    if (no === '00') errors.push(`页号 00 表示版本级（总控），不能用作页面目录：${list.map((p) => p.name).join('、')}`);
  }

  const idxPath = path.join(versionDir, 'index.md');
  const idx = read(idxPath);
  if (!idx) {
    (mode === 'version' ? errors : warns).push(`版本目录缺 index.md（${idxPath}）`);
  } else {
    oks.push('版本 index.md 存在');
    if (path.basename(path.dirname(versionDir)) !== 'versions') {
      warns.push('版本目录没放在工作区的 versions/ 下（新结构是 versions/<版本号>/；征得用户同意后整体挪进去并修相对链接）');
    }
    const unlisted = allPages.map((d) => path.basename(d)).filter((n) => !idx.includes(n));
    if (unlisted.length) warns.push(`版本 index.md 没列出这些页面目录：${unlisted.join('、')}`);
    for (const h of ['页面清单', '共用定义', '交付与修订']) {
      if (!idx.includes(h)) warns.push(`版本 index.md 缺「${h}」区块`);
    }
    for (const h of ['版本级决策', '术语', '存量数据']) {
      if (!idx.includes(h)) warns.push(`版本 index.md 缺「${h}」区块（总纲建议有，见 templates/version-index.md）`);
    }
    const dupD = [...new Set(versionDecisions.filter((x, i) => versionDecisions.indexOf(x) !== i))];
    if (dupD.length) errors.push(`版本 index.md 里版本级决策重复定义：${dupD.join('、')}`);
    else if (versionDecisions.length) oks.push(`版本级决策 ${versionDecisions.length} 条`);
    if (glossary.length) {
      oks.push(`术语表 ${glossary.length} 条，禁用别名 ${aliasMap.size} 个`);
      const clash = glossary.flatMap((g) => g.aliases.filter((a) => standardTerms.includes(a)).map((a) => `${a}（既是标准叫法又是「${g.term}」的禁用别名）`));
      if (clash.length) errors.push(`术语表自相矛盾：${clash.join('、')}`);
    }
    // index 可以引用 WORKLOG 里的 00 号事项；其他页号必须真实存在
    const bad = checkRefs(mentionedIds(idx).filter((m) => m.page !== '00').map((m) => m.id), null);
    if (bad.length) errors.push(`版本 index.md 引用了不存在的编号：${bad.join('、')}`);
  }

  const wl = path.join(versionDir, 'WORKLOG.md');
  if (fs.existsSync(wl)) {
    const g = gitStatus(versionDir, 'WORKLOG.md');
    if (g === 'tracked') errors.push('WORKLOG.md 已被 Git 跟踪：它不进 Git，需从仓库移除并加入 .gitignore（先征得用户同意）');
    else if (g === 'not-ignored') errors.push('WORKLOG.md 在 Git 仓库里但没被忽略：建议在 .gitignore 加一行 WORKLOG.md（先征得用户同意）');
    else if (g === 'ignored') oks.push('WORKLOG.md 已被 Git 忽略');
    else oks.push('不在 Git 仓库内，跳过 WORKLOG 入库检查');
  }

  blocks.push({ title: `版本目录：${versionDir}`, errors, warns, oks });
}

/* ================= 页面级检查 ================= */
for (const dir of pages) blocks.push(checkPage(dir));

/* ================= 报告 ================= */
for (const b of blocks) {
  console.log(`\n▸ ${b.title}`);
  for (const o of b.oks) console.log(`  ✅ ${o}`);
  for (const w of b.warns) console.log(`  ⚠️  ${w}`);
  for (const e of b.errors) console.log(`  ✗  ${e}`);
  totalErr += b.errors.length;
  totalWarn += b.warns.length;
}
console.log('');
if (totalErr) {
  console.log(`结论：${totalErr} 个错误、${totalWarn} 个提醒 —— 先改完再交付。`);
  process.exit(1);
}
console.log(`结论：通过（${totalWarn} 个提醒）。${totalWarn ? '提醒不影响交付，但看一眼。' : '可以直接交技术了。'}`);
process.exit(0);

/* ================= 函数 ================= */

/** 返回不存在的编号列表。ownNo 为本页页号（本页编号另行检查）；00 视为非法 */
function checkRefs(ids, ownNo) {
  const bad = [];
  for (const id of new Set(ids)) {
    const no = id.split('-')[1];
    if (no === ownNo) continue;
    if (no === '00') {
      if (!id.startsWith('D-')) bad.push(`${id}（00 号只有 D-00 可被页面引用；Q-00 留在版本 WORKLOG，定了再引用 D-00 或本页编号）`);
      else if (!versionDecisionSet.has(id)) bad.push(`${id}（版本 index.md「版本级决策」里没有）`);
      continue;
    }
    const list = index.get(no);
    if (!list || !list.length) { bad.push(`${id}（没有 ${no} 号页面）`); continue; }
    if (!list.some((p) => p.ids.has(id))) bad.push(`${id}（${list[0].name} 的 spec 里没定义）`);
  }
  return bad;
}

function gitStatus(cwd, rel) {
  try {
    execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { stdio: 'pipe' });
  } catch {
    return 'no-repo';
  }
  try {
    const out = execFileSync('git', ['-C', cwd, 'ls-files', '--', rel], { stdio: 'pipe' }).toString().trim();
    if (out) return 'tracked';
  } catch { /* ignore */ }
  try {
    execFileSync('git', ['-C', cwd, 'check-ignore', '-q', '--', rel], { stdio: 'pipe' });
    return 'ignored';
  } catch {
    return 'not-ignored';
  }
}

function walkHtml(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkHtml(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

function checkPage(root) {
  const errors = [];
  const warns = [];
  const oks = [];
  const name = path.basename(root);
  const no = pageNo(root);
  const res = { title: `页面：${name}`, errors, warns, oks };

  const prdPath = path.join(root, 'PRD.md');
  const specPath = path.join(root, 'spec.yaml');
  const reviewPath = path.join(root, 'review.html');
  const prd = read(prdPath);
  const spec = read(specPath);

  const pwl = path.join(root, 'WORKLOG.md');
  if (fs.existsSync(pwl)) {
    const g = gitStatus(root, 'WORKLOG.md');
    if (g === 'tracked') errors.push('本页 WORKLOG.md 已被 Git 跟踪：它不进 Git，需从仓库移除并加入 .gitignore（先征得用户同意）');
    else if (g === 'not-ignored') errors.push('本页 WORKLOG.md 在 Git 仓库里但没被忽略：建议 .gitignore 加一行 WORKLOG.md（先征得用户同意）');
  }

  if (!prd) errors.push('缺 PRD.md');
  if (!spec) errors.push('缺 spec.yaml');
  if (!prd || !spec) return res;
  oks.push('PRD.md、spec.yaml 存在');

  /* ---- spec 结构 ---- */
  const S = yamlSections(spec);
  const REQUIRED = ['meta', 'scope', 'rules', 'acceptance', 'open_questions'];
  const missing = REQUIRED.filter((s) => !S.names.includes(s));
  if (missing.length) errors.push(`spec.yaml 缺必填段：${missing.join('、')}`);
  else oks.push(`spec.yaml 必填段齐全（${REQUIRED.join(' / ')}）`);

  for (const seg of S.names) {
    const ph = (S.get(seg) || '').match(/<[^>\n]{1,40}>/g);
    if (ph) errors.push(`spec.yaml 的 ${seg} 段还有占位符没填：${[...new Set(ph)].slice(0, 5).join(' ')}`);
  }

  const metaField = (k) => {
    const m = (S.get('meta') || '').match(new RegExp(`^\\s*${k}:\\s*(.+)$`, 'm'));
    return m ? m[1].replace(/#.*$/, '').replace(/["']/g, '').trim() : '';
  };
  const v = metaField('version');
  if (!v) errors.push('spec.yaml → meta.version 缺失');
  else if (v !== version) errors.push(`meta.version（${v}）与版本目录名（${version}）不一致`);
  else oks.push(`版本号与目录名一致：${version}`);
  const pg = metaField('page');
  if (!pg) warns.push('spec.yaml → meta.page 缺失，建议写成页面目录名');
  else if (pg !== name) errors.push(`meta.page（${pg}）与页面目录名（${name}）不一致`);

  const isEmpty = (seg) => {
    const body = S.get(seg);
    if (body == null) return false;
    const t = body.split('\n').filter((l) => l.trim()).join('').trim();
    return !t || /^\[\s*\]$/.test(t);
  };
  if (isEmpty('rules')) errors.push('spec.yaml → rules 是空的，至少一条业务规则');
  if (isEmpty('acceptance')) errors.push('spec.yaml → acceptance 是空的，至少一条验收标准');
  const scopeOut = (S.get('scope') || '').match(/^\s*out:\s*(.+)$/m);
  if (scopeOut && /^\[\s*\]$/.test(scopeOut[1].trim())) {
    warns.push('scope.out 是空的：没写「这次不做什么」，范围容易越界');
  }

  /* ---- 编号 ---- */
  const defs = definedIds(spec);
  const defSet = new Set(defs);
  const dup = [...new Set(defs.filter((x, i) => defs.indexOf(x) !== i))];
  if (dup.length) errors.push(`spec.yaml 里编号重复定义：${dup.join('、')}`);
  const wrongPrefix = defs.filter((x) => x.split('-')[1] !== no);
  if (wrongPrefix.length) errors.push(`spec.yaml 定义的编号页号必须是 ${no}：${[...new Set(wrongPrefix)].join('、')}`);

  const oldIds = [...new Set([...(prd.match(OLD_ID_RE) || []), ...(S.text.match(OLD_ID_RE) || [])])];
  if (oldIds.length) errors.push(`发现不带页号的旧格式编号，应改为 <类型>-${no}-<序号>：${oldIds.slice(0, 8).join('、')}`);

  const prdM = mentionedIds(prd);
  const specM = mentionedIds(S.text);
  const own = (arr) => arr.filter((m) => m.page === no);
  const prdOwn = new Set(own(prdM).map((m) => m.id));
  const specOwnRG = [...defSet].filter((x) => /^[RG]-/.test(x) && x.split('-')[1] === no);

  const onlySpec = specOwnRG.filter((x) => !prdOwn.has(x));
  const onlyPrd = [...prdOwn].filter((x) => !defSet.has(x));
  const specUndef = [...new Set(own(specM).map((m) => m.id))].filter((x) => !defSet.has(x));
  if (onlySpec.length) errors.push(`这些编号只在 spec.yaml 定义、PRD.md 没写：${onlySpec.join('、')}`);
  if (onlyPrd.length) errors.push(`这些编号 PRD.md 里有、spec.yaml 没定义：${onlyPrd.join('、')}`);
  if (specUndef.length) errors.push(`spec.yaml 里引用了本页未定义的编号：${specUndef.join('、')}`);
  if (!onlySpec.length && !onlyPrd.length && specOwnRG.length) {
    oks.push(`本页编号交叉一致：R/G 共 ${specOwnRG.length} 个`);
  }

  const crossIds = [...prdM, ...specM].filter((m) => m.page !== no).map((m) => m.id);
  const badCross = checkRefs(crossIds, no);
  if (badCross.length) errors.push(`跨页引用对不上：${badCross.join('、')}`);
  else if (crossIds.length) oks.push(`跨页引用 ${new Set(crossIds).size} 个，都能找到定义`);

  /* ---- refs ---- */
  const refsBody = S.get('refs');
  if (refsBody) {
    for (const m of refsBody.matchAll(/page:\s*["']?([^,}\s"']+)["']?([^}]*)/g)) {
      const refPage = m[1];
      const rest = m[2];
      const target = (index.get((refPage.match(/^(\d{2})-/) || [])[1]) || []).find((p) => p.name === refPage);
      if (!target) { errors.push(`refs 指向的页面不存在：${refPage}`); continue; }
      const ent = rest.match(/entity:\s*["']?([^,}"']+)/);
      if (ent) {
        const e = ent[1].trim();
        const T = yamlSections(target.spec);
        const where = `${T.get('flows') || ''}\n${T.get('entities') || ''}`;
        const re = new RegExp(`(entity|name):\\s*["']?${e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*($|,|})`, 'm');
        if (!re.test(where)) errors.push(`refs：${refPage} 的 spec 里没有定义实体 / 状态机「${e}」`);
      }
    }
  }

  /* ---- 任务依赖 ---- */
  const taskBody = S.get('tasks') || '';
  const edges = {};
  for (const m of taskBody.matchAll(/\bid:\s*(T-\d{2}-\d{2,3})[\s\S]*?depends_on:\s*\[([^\]]*)\]/g)) {
    edges[m[1]] = m[2].split(',').map((s) => s.trim()).filter(Boolean);
  }
  for (const [id, deps] of Object.entries(edges)) {
    for (const d of deps) {
      if (d.split('-')[1] === no && !defSet.has(d)) errors.push(`${id} 依赖的 ${d} 不存在`);
    }
  }
  const state = {};
  const dfs = (id, stack) => {
    if (state[id] === 'done') return;
    if (state[id] === 'visiting') { errors.push(`任务依赖成环：${[...stack, id].join(' → ')}`); return; }
    state[id] = 'visiting';
    for (const d of edges[id] || []) if (edges[d]) dfs(d, [...stack, id]);
    state[id] = 'done';
  };
  Object.keys(edges).forEach((id) => dfs(id, []));
  if (Object.keys(edges).length) oks.push(`实现任务 ${Object.keys(edges).length} 条，依赖可解析`);

  /* ---- PRD 结构 ---- */
  let h2 = '';
  const h2s = [];
  const blocksIn = [];
  for (const m of prd.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
    if (m[1].length === 2) { h2 = m[2].trim(); h2s.push(h2); }
    if (m[1].length === 3 && /详细需求/.test(h2)) blocksIn.push(m[2].trim());
  }
  if (!h2s.some((t) => /整体概述/.test(t))) errors.push('PRD.md 缺「整体概述」章节');
  if (!h2s.some((t) => /详细需求/.test(t))) errors.push('PRD.md 缺「详细需求」章节');
  else if (!blocksIn.length) errors.push('PRD.md「详细需求」下没有任何区块（### 级标题）');
  else oks.push(`PRD.md 结构完整，区块 ${blocksIn.length} 个：${blocksIn.join('、')}`);
  if ((prd.match(/^```/gm) || []).length % 2) errors.push('PRD.md 代码块 ``` 没闭合');

  const filler = ['优化体验', '提升效率', '友好的提示', '友好提示', '体验更好', '性能优化', '功能正常', '尽量', '等等'];
  const hits = filler.filter((w) => prd.includes(w));
  if (hits.length) warns.push(`PRD.md 里有落不了地的词，改成可观测行为：${hits.join('、')}`);

  /* ---- mock ---- */
  const markers = [...prd.matchAll(/^<!--\s*mock:\s*([\s\S]*?)-->\s*$/gm)].map((m) => {
    const raw = m[1].trim();
    const bar = raw.indexOf('|');
    return (bar === -1 ? raw : raw.slice(0, bar)).trim();
  });
  const mockFiles = walkHtml(path.join(root, 'mocks'));
  if (!markers.length) {
    if (mockFiles.length) warns.push('mocks/ 里有文件，但 PRD.md 没有任何 mock 锚点');
  } else {
    const miss = markers.filter((rel) => !fs.existsSync(path.join(root, rel)));
    if (miss.length) errors.push(`mock 文件不存在：${miss.join('、')}`);
    else oks.push(`mock 锚点 ${markers.length} 个，文件都在`);
    for (const rel of markers) if (!/^mocks\//.test(rel)) warns.push(`mock 锚点路径不在 mocks/ 下：${rel}`);
  }
  const markerAbs = new Set(markers.map((m) => path.join(root, m)));
  const orphan = mockFiles.filter((f) => !markerAbs.has(f)).map((f) => path.relative(root, f));
  if (orphan.length) warns.push(`mocks/ 里有没被 PRD.md 引用的文件：${orphan.join('、')}`);
  for (const f of mockFiles) {
    const body = fs.readFileSync(f, 'utf8');
    const rel = path.relative(root, f);
    if (/<(script|link|img)[^>]+(src|href)=["']https?:/i.test(body) || /@import\s+url\(["']?https?:/i.test(body)) {
      errors.push(`${rel} 引了外链资源，必须内联，否则离线 / 内网打不开`);
    }
    if (!/data-note=/.test(body)) warns.push(`${rel} 里没有改动点标注（data-note）`);
  }

  /* ---- 术语：禁用别名 ---- */
  if (aliasMap.size) {
    const files = [['PRD.md', prd], ['spec.yaml', spec], ...mockFiles.map((f) => [path.relative(root, f), fs.readFileSync(f, 'utf8')])];
    const hits = [];
    for (const [rel, body] of files) {
      body.split('\n').forEach((line, i) => {
        if (line.includes('alias-ok')) return;
        let masked = line;
        for (const t of standardTerms) masked = masked.split(t).join('\u0000');
        for (const [a, t] of aliasMap) if (masked.includes(a)) hits.push(`${rel}:${i + 1}「${a}」→「${t}」`);
      });
    }
    if (hits.length) {
      errors.push(`用了术语表里的禁用别名（改成标准叫法；确需写旧名的行加 alias-ok）共 ${hits.length} 处：${hits.slice(0, 12).join('；')}${hits.length > 12 ? ' …' : ''}`);
    } else oks.push('没有禁用别名');
  }

  /* ---- review.html ---- */
  if (!fs.existsSync(reviewPath)) {
    warns.push('还没有 review.html，跑一下 build_review.mjs');
  } else {
    const rt = fs.statSync(reviewPath).mtimeMs;
    const newer = [prdPath, specPath, ...markerAbs]
      .filter((p) => fs.existsSync(p) && fs.statSync(p).mtimeMs > rt)
      .map((p) => path.relative(root, p));
    if (newer.length) warns.push(`review.html 比这些文件旧，重新生成：${newer.join('、')}`);
    else oks.push('review.html 是最新的');
  }

  return res;
}
