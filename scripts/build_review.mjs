#!/usr/bin/env node
/**
 * build_review.mjs —— 把页面 PRD.md 渲染成人读版 review.html，并把每个 mock 内嵌到对应区块下方。
 *
 * 用法：
 *   node build_review.mjs <页面目录>   # 只生成这一页
 *   node build_review.mjs <版本目录>   # 生成版本下所有 NN-* 页面
 *
 * 依赖：零。Node 18+。
 * 说明：mock 以 iframe srcdoc 内联，review.html 是单文件，发给别人也不会掉图。
 *       引用其他页面的编号（如 R-01-003）会链接到对应页面的 review.html。
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveTarget, pageNo, pageIndex, yamlSections, definedIds, mentionedIds, relPosix } from './lib.mjs';

const target = process.argv[2];
if (!target) {
  console.error('用法: node build_review.mjs <页面目录或版本目录>');
  process.exit(2);
}
const { versionDir, pages } = resolveTarget(target);
if (!pages.length) {
  console.error(`✗ ${path.resolve(target)} 既不是页面目录，下面也没有 NN-<页面名> 页面目录`);
  process.exit(2);
}
const index = pageIndex(versionDir);
let failed = 0;
for (const dir of pages) {
  if (!fs.existsSync(path.join(dir, 'PRD.md'))) {
    console.error(`✗ 没找到 ${path.join(dir, 'PRD.md')}，跳过`);
    failed++;
    continue;
  }
  buildPage(dir);
}
process.exit(failed ? 1 : 0);

/* ---------------- 工具 ---------------- */

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function isTableSep(l) {
  return /^\|[\s:|-]+\|?\s*$/.test(l) && l.includes('-');
}
function splitRow(l) {
  return l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

/* ---------------- 单页生成 ---------------- */

function buildPage(root) {
  const md = fs.readFileSync(path.join(root, 'PRD.md'), 'utf8');
  const specText = readIfExists(path.join(root, 'spec.yaml'));
  const ownNo = pageNo(root);
  const pageName = path.basename(root);

  /** 跨页编号 → 链接到对方 review.html */
  function linkIds(html) {
    return html.replace(/\b([RGTDQ])-(\d{2})-(\d{2,3})\b/g, (m, _t, no) => {
      if (no === ownNo) return m;
      if (no === '00') {
        // 版本级决策 → 链到版本总纲 index.md
        const href = relPosix(root, path.join(versionDir, 'index.md'));
        return `<a class="xref" href="${escAttr(href)}" title="版本总纲 · 版本级决策">${m}</a>`;
      }
      const p = (index.get(no) || [])[0];
      if (!p) return m;
      const href = relPosix(root, path.join(p.dir, 'review.html'));
      return `<a class="xref" href="${escAttr(href)}" title="${escAttr(p.name)}">${m}</a>`;
    });
  }

  function inline(s) {
    // 行内 HTML 注释（如 <!-- alias-ok -->）不渲染
    let t = esc(s.replace(/<!--[\s\S]*?-->/g, '').trimEnd());
    // 行内代码、链接先挖出来，避免被后续替换误伤
    const codes = [];
    t = t.replace(/`([^`]+)`/g, (_, c) => {
      codes.push(c);
      return `\u0000C${codes.length - 1}\u0000`;
    });
    const links = [];
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, a, b) => {
      links.push(`<a href="${b}" target="_blank" rel="noreferrer">${a}</a>`);
      return `\u0000L${links.length - 1}\u0000`;
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(?<![*\w])\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    t = linkIds(t);
    t = t.replace(/\u0000L(\d+)\u0000/g, (_, i) => links[Number(i)]);
    t = t.replace(/\u0000C(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
    return t;
  }

  /* ---- Markdown → HTML ---- */
  const lines = md.split(/\r?\n/);
  const out = [];
  const toc = [];
  const mocks = [];
  const missing = [];
  const para = [];
  let h2 = 0;
  let i = 0;

  const flushParagraph = () => {
    if (!para.length) return;
    out.push(`<p>${inline(para.join(' '))}</p>`);
    para.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flushParagraph();
      const lang = line.slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code data-lang="${escAttr(lang)}">${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    const mockMatch = line.match(/^<!--\s*mock:\s*([\s\S]*?)-->\s*$/);
    if (mockMatch) {
      flushParagraph();
      const raw = mockMatch[1].trim();
      const bar = raw.indexOf('|');
      const rel = (bar === -1 ? raw : raw.slice(0, bar)).trim();
      const caption = bar === -1 ? '' : raw.slice(bar + 1).trim();
      const abs = path.join(root, rel);
      let body = '';
      if (fs.existsSync(abs)) body = fs.readFileSync(abs, 'utf8');
      else missing.push(rel);
      const nb = mocks.length + 1;
      mocks.push({ rel, caption });
      out.push(
        body
          ? `<figure class="mock" data-mode="pc" id="mock-${nb}">
  <figcaption><span class="tag">示意 ${nb}</span>${esc(caption || rel)}<span class="src">${esc(rel)}</span></figcaption>
  <div class="mock-tools">
    <button data-w="pc" class="on">PC 1440</button>
    <button data-w="mobile">移动 375</button>
    <button data-w="full">全宽长图</button>
    <button data-open>新窗口打开</button>
  </div>
  <div class="mock-frame"><iframe title="${escAttr(caption || rel)}" srcdoc="${escAttr(body)}"></iframe></div>
</figure>`
          : `<div class="mock-missing">✗ 找不到 mock 文件：<code>${esc(rel)}</code>（先画出来，再跑一次本脚本）</div>`
      );
      i++;
      continue;
    }

    // 其他 HTML 注释：不渲染
    if (/^\s*<!--/.test(line)) {
      flushParagraph();
      while (i < lines.length && !/-->/.test(lines[i])) i++;
      i++;
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushParagraph();
      const lv = h[1].length;
      const text = h[2].trim();
      if (lv === 1) {
        out.push(`<h1>${inline(text)}</h1>`);
      } else if (lv === 2) {
        h2++;
        out.push(`<h2 id="s${h2}">${inline(text)}</h2>`);
        toc.push({ id: `s${h2}`, text, lv: 2 });
      } else if (lv === 3) {
        const id = `s${h2}-${toc.filter((t) => t.lv === 3 && t.owner === h2).length + 1}`;
        out.push(`<h3 id="${id}">${inline(text)}</h3>`);
        toc.push({ id, text, lv: 3, owner: h2 });
      } else {
        out.push(`<h${lv}>${inline(text)}</h${lv}>`);
      }
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph();
      out.push('<hr>');
      i++;
      continue;
    }

    if (/^\s*\|/.test(line) && isTableSep(lines[i + 1] || '')) {
      flushParagraph();
      const head = splitRow(lines[i].trim());
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++].trim()));
      out.push(
        `<div class="tw"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
          '</tbody></table></div>'
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      const body = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${body.map((b) => inline(b)).join('<br>')}</blockquote>`);
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      flushParagraph();
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          item += ' ' + lines[i].trim();
          i++;
        }
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushParagraph();
      i++;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushParagraph();

  /* ---- spec.yaml 摘要 ---- */
  const S = yamlSections(specText);
  const metaField = (key) => {
    const m = (S.get('meta') || '').match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].replace(/#.*$/, '').replace(/["']/g, '').trim() : '';
  };
  const meta = {
    feature: metaField('feature') || pageName,
    product: metaField('product'),
    version: metaField('version') || path.basename(versionDir),
    page: metaField('page') || pageName,
    date: metaField('date'),
    status: metaField('status') || '草稿',
  };

  const openQ = [];
  for (const m of (S.get('open_questions') || '').matchAll(/\{\s*id:\s*(Q-\d{2}-\d{2,3})[\s\S]*?question:\s*([^,}]+)/g)) {
    openQ.push({ id: m[1], text: m[2].trim() });
  }

  // 本页 R/G 交叉提示
  const defs = new Set(definedIds(specText));
  const prdOwn = new Set(
    mentionedIds(md).filter((x) => x.page === ownNo && /^[RG]$/.test(x.type)).map((x) => x.id)
  );
  const specOwn = [...defs].filter((x) => /^[RG]-/.test(x) && x.split('-')[1] === ownNo);
  const onlyPrd = [...prdOwn].filter((x) => !defs.has(x));
  const onlySpec = specOwn.filter((x) => !prdOwn.has(x));

  /* ---- 输出 ---- */
  const tocHtml = toc
    .map((t) => `<a class="${t.lv === 2 ? 't2' : 't3'}" href="#${t.id}">${esc(t.text)}</a>`)
    .join('\n');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.feature)} ${esc(meta.version)} · 评审版</title>
<style>
  :root{--line:#e5e7eb;--text:#111827;--sub:#6b7280;--bg:#f9fafb;--brand:#3b82f6;--warn:#dc2626}
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.75 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--text);background:var(--bg)}
  header.top{position:sticky;top:0;z-index:50;background:#111827;color:#fff;padding:12px 24px;display:flex;gap:18px;align-items:baseline;flex-wrap:wrap}
  header.top h1{font-size:16px;margin:0}
  header.top .pill{font-size:12px;border:1px solid #4b5563;border-radius:99px;padding:2px 10px;color:#d1d5db}
  .wrap{display:flex;align-items:flex-start;gap:28px;max-width:1800px;margin:0 auto;padding:24px}
  nav{position:sticky;top:64px;width:280px;flex:0 0 280px;max-height:calc(100vh - 90px);overflow:auto;background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px}
  nav h2{font-size:12px;color:var(--sub);margin:0 0 8px;letter-spacing:.08em}
  nav a{display:block;text-decoration:none;color:#374151;font-size:13px;padding:5px 8px;border-radius:6px;line-height:1.4}
  nav a:hover{background:#eff6ff;color:#1d4ed8}
  nav a.t3{padding-left:20px;color:var(--sub);font-size:12.5px}
  main{flex:1;min-width:0;background:#fff;border:1px solid var(--line);border-radius:10px;padding:36px 44px 60px}
  main h1{font-size:26px;margin:0 0 18px}
  main h2{font-size:20px;margin:44px 0 14px;padding-bottom:8px;border-bottom:2px solid #e5e7eb}
  main h3{font-size:16.5px;margin:30px 0 10px}
  main h4{font-size:15px;margin:22px 0 8px;color:#374151}
  main p{margin:10px 0}
  main a{color:#1d4ed8}
  main a.xref{background:#eef2ff;border-radius:4px;padding:0 4px;text-decoration:none}
  main code{background:#f3f4f6;border:1px solid #e5e7eb;border-radius:4px;padding:1px 5px;font-size:13px;font-family:ui-monospace,Menlo,Consolas,monospace}
  main pre{background:#111827;color:#e5e7eb;border-radius:8px;padding:14px 16px;overflow:auto}
  main pre code{background:none;border:0;color:inherit;padding:0}
  main blockquote{border-left:3px solid var(--brand);background:#eff6ff;margin:12px 0;padding:10px 16px;color:#1e3a8a;border-radius:0 6px 6px 0}
  main hr{border:0;border-top:1px dashed var(--line);margin:28px 0}
  .tw{overflow:auto;margin:14px 0}
  table{border-collapse:collapse;width:100%;font-size:13.5px}
  th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
  th{background:#f3f4f6;font-weight:600;white-space:nowrap}
  tbody tr:nth-child(even){background:#fcfcfd}
  ul,ol{padding-left:24px;margin:10px 0}
  li{margin:4px 0}
  .banner{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin:0 0 24px}
  .banner b{color:var(--warn)}
  .banner ul{margin:6px 0 0}
  .warnbox{background:#fffbeb;border:1px dashed #f59e0b;border-radius:8px;padding:12px 16px;margin:18px 0;font-size:13.5px}
  .warnbox li{font-size:13px}
  figure.mock{margin:22px 0 34px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff}
  figure.mock figcaption{display:flex;align-items:center;gap:10px;padding:11px 16px;background:#f8fafc;border-bottom:1px solid var(--line);font-size:14px;font-weight:600}
  figure.mock figcaption .tag{background:var(--brand);color:#fff;font-size:11px;border-radius:4px;padding:2px 8px;font-weight:600}
  figure.mock figcaption .src{margin-left:auto;font-weight:400;color:var(--sub);font-size:12px;font-family:ui-monospace,Menlo,monospace}
  .mock-tools{display:flex;gap:8px;padding:9px 16px;border-bottom:1px solid var(--line);background:#fff}
  .mock-tools button{font:inherit;font-size:12.5px;padding:4px 12px;border:1px solid var(--line);background:#fff;border-radius:6px;cursor:pointer;color:#374151}
  .mock-tools button.on{background:var(--brand);border-color:var(--brand);color:#fff}
  .mock-frame{background:#f3f4f6;padding:0;display:flex;justify-content:center}
  .mock-frame iframe{border:0;background:#fff;display:block}
  figure.mock[data-mode="pc"] .mock-frame iframe{width:100%;height:760px}
  figure.mock[data-mode="mobile"] .mock-frame iframe{width:420px;height:760px;box-shadow:0 0 0 1px var(--line)}
  figure.mock[data-mode="full"] .mock-frame iframe{width:100%;height:1000px}
  .mock-missing{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:14px 18px;margin:18px 0;font-size:14px}
  @media (max-width:1100px){nav{display:none}.wrap{padding:14px}main{padding:22px}}
</style>
</head>
<body>
<header class="top">
  <h1>${esc(meta.feature)}</h1>
  <span class="pill">${esc(meta.version)}</span>
  <span class="pill">${esc(meta.page)}</span>
  <span class="pill">${esc(meta.product || '—')}</span>
  <span class="pill">状态：${esc(meta.status)}</span>
  <span class="pill">${esc(meta.date || '')}</span>
  <span class="pill">评审版 · 由 PRD.md 自动生成，勿手改</span>
</header>

<div class="wrap">
  <nav>
    <h2>目录</h2>
    ${tocHtml || '<a class="t3">（PRD.md 还没有二级标题）</a>'}
    ${
      mocks.length
        ? `<h2 style="margin-top:16px">内嵌示意（${mocks.length}）</h2>` +
          mocks.map((m, n) => `<a class="t3" href="#mock-${n + 1}">${n + 1}. ${esc(m.caption || m.rel)}</a>`).join('')
        : ''
    }
  </nav>

  <main>
    ${
      openQ.length
        ? `<div class="banner"><b>⚠ ${openQ.length} 项未定，先别开跑：</b><ul>${openQ
            .map((q) => `<li><code>${esc(q.id)}</code> ${esc(q.text)}</li>`)
            .join('')}</ul></div>`
        : ''
    }
    ${
      onlyPrd.length || onlySpec.length
        ? `<div class="warnbox"><b>编号对不上（PRD.md 与 spec.yaml 不一致）：</b><ul>${
            onlyPrd.length ? `<li>只在 PRD.md 出现：${onlyPrd.map(esc).join('、')}</li>` : ''
          }${onlySpec.length ? `<li>只在 spec.yaml 出现：${onlySpec.map(esc).join('、')}</li>` : ''}</ul></div>`
        : ''
    }
    ${out.join('\n')}
  </main>
</div>

<script>
document.querySelectorAll('figure.mock').forEach(function (fig) {
  fig.querySelectorAll('[data-w]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      fig.dataset.mode = btn.dataset.w;
      fig.querySelectorAll('[data-w]').forEach(function (b) { b.classList.toggle('on', b === btn); });
    });
  });
  var open = fig.querySelector('[data-open]');
  if (open) open.addEventListener('click', function () {
    var src = fig.querySelector('iframe').getAttribute('srcdoc');
    var w = window.open('about:blank');
    w.document.open(); w.document.write(src); w.document.close();
  });
});
</script>
</body>
</html>
`;

  const outPath = path.join(root, 'review.html');
  fs.writeFileSync(outPath, html, 'utf8');

  console.log(`✓ 生成 ${path.relative(process.cwd(), outPath)}`);
  console.log(`  · 正文块 ${out.length} 个，目录 ${toc.length} 条，内嵌 mock ${mocks.length} 个`);
  if (missing.length) console.log(`  ⚠ 以下 mock 文件不存在，已在页面里留红框占位：${missing.join('、')}`);
  if (onlyPrd.length) console.log(`  ⚠ 只在 PRD.md 出现的编号：${onlyPrd.join('、')}`);
  if (onlySpec.length) console.log(`  ⚠ 只在 spec.yaml 出现的编号：${onlySpec.join('、')}`);
  if (openQ.length) console.log(`  ⚠ 未定事项 ${openQ.length} 条，已在页面顶部标红`);
}
