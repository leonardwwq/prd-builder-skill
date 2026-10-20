/**
 * lib.mjs —— build_review.mjs / validate.mjs 共用的目录与编号解析。零依赖，Node 18+。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 页面目录名：两位页号 + 连字符 + 名称 */
export const PAGE_DIR_RE = /^(\d{2})-.+/;
/** 新格式编号：类型-页号-序号 */
export const ID_RE = /\b([RGTDQ])-(\d{2})-(\d{2,3})\b/g;
/** 旧格式编号（不带页号），用于报错提示 */
export const OLD_ID_RE = /\b[RGTDQ]-\d{2,3}\b(?!-\d)/g;

export const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

export const isPageDir = (d) =>
  PAGE_DIR_RE.test(path.basename(d)) &&
  (fs.existsSync(path.join(d, 'PRD.md')) || fs.existsSync(path.join(d, 'spec.yaml')));

/** 版本目录下所有 NN-* 子目录 */
export function listPageDirs(versionDir) {
  if (!fs.existsSync(versionDir)) return [];
  return fs
    .readdirSync(versionDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && PAGE_DIR_RE.test(e.name))
    .map((e) => path.join(versionDir, e.name))
    .sort();
}

/**
 * 解析传入路径：页面目录 → 只处理这一页；否则视为版本目录 → 处理其下所有页面。
 */
export function resolveTarget(target) {
  const root = path.resolve(target);
  if (isPageDir(root)) {
    return { mode: 'page', versionDir: path.dirname(root), pages: [root] };
  }
  return { mode: 'version', versionDir: root, pages: listPageDirs(root) };
}

export const pageNo = (dir) => (path.basename(dir).match(PAGE_DIR_RE) || [])[1];

/** 去掉 YAML 注释行（整行以 # 开头），避免注释里的示例被当成内容 */
export const stripYamlComments = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

/** 按顶层 key 切段 */
export function yamlSections(specText) {
  const text = stripYamlComments(specText || '');
  const starts = [...text.matchAll(/^([a-z_]+):/gm)].map((m) => ({ name: m[1], at: m.index }));
  const get = (name) => {
    const idx = starts.findIndex((s) => s.name === name);
    if (idx === -1) return null;
    const start = starts[idx].at + name.length + 1;
    const end = idx + 1 < starts.length ? starts[idx + 1].at : text.length;
    return text.slice(start, end);
  };
  return { text, names: starts.map((s) => s.name), get };
}

/** spec 里通过 `id:` 定义的编号（含重复，用于查重） */
export function definedIds(specText) {
  const text = stripYamlComments(specText || '');
  return [...text.matchAll(/\bid:\s*["']?([RGTDQ]-\d{2}-\d{2,3})\b/g)].map((m) => m[1]);
}

/** 一段文本里出现的所有新格式编号 */
export function mentionedIds(text) {
  return [...(text || '').matchAll(ID_RE)].map((m) => ({ id: m[0], type: m[1], page: m[2] }));
}

/** 版本目录内：页号 → { dir, name, spec, ids:Set } */
export function pageIndex(versionDir) {
  const map = new Map();
  for (const dir of listPageDirs(versionDir)) {
    const no = pageNo(dir);
    const spec = read(path.join(dir, 'spec.yaml')) || '';
    const entry = { dir, name: path.basename(dir), spec, ids: new Set(definedIds(spec)) };
    if (!map.has(no)) map.set(no, []);
    map.get(no).push(entry);
  }
  return map;
}

/** 拆 Markdown 表格行 */
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/**
 * 版本 index「版本级决策」里定义的 D-00 编号：表格行首列为 D-00-xx 的算定义（含重复，用于查重）。
 */
export function versionDecisionIds(indexText) {
  const out = [];
  for (const line of (indexText || '').split('\n')) {
    if (!/^\s*\|/.test(line)) continue;
    const m = cells(line)[0].replace(/[`*]/g, '').match(/^D-00-\d{2,3}$/);
    if (m) out.push(m[0]);
  }
  return out;
}

/**
 * 术语表：任意表头同时含「标准叫法」「禁用别名」的 Markdown 表格。
 * 返回 [{ term, aliases: [] }]；别名用 、 ， , / ; 分隔，「—」「-」「无」视为空。
 */
export function parseGlossary(text) {
  const out = [];
  const lines = (text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const head = cells(lines[i]);
    const ti = head.findIndex((h) => h.includes('标准叫法'));
    const ai = head.findIndex((h) => h.includes('禁用别名'));
    if (ti === -1 || ai === -1) continue;
    let j = i + 1;
    if (j < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[j])) j++;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const row = cells(lines[j]);
      const clean = (s) => (s || '').replace(/[`*「」“”"']/g, '').trim();
      const term = clean(row[ti]);
      const aliases = clean(row[ai])
        .split(/[、，,/;；]/)
        .map((s) => s.trim())
        .filter((s) => s && !/^(—|-|–|无)$/.test(s) && !/^<.*>$/.test(s));
      if (term && !/^<.*>$/.test(term)) out.push({ term, aliases });
    }
    i = j - 1;
  }
  return out;
}

export const relPosix = (from, to) => path.relative(from, to).split(path.sep).join('/');
