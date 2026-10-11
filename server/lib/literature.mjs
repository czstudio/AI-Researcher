// Literature search. arXiv + Crossref need no key; Semantic Scholar is optional.

import https from 'node:https';

function get(url, { timeout = 12000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location, { timeout, headers }).then(resolve, reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
  });
}

function strip(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Very small XML reader; keeps the server dependency-free.
function tagAll(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function tagOne(xml, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? m[1] : '';
}

export async function searchArxiv(query, { max = 8 } = {}) {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${max}&sortBy=relevance`;
  try {
    const { body } = await get(url);
    const entries = tagAll(body, 'entry');
    return entries.map((e) => {
      const idUrl = tagOne(e, 'id');
      const pdf = idUrl.replace('/abs/', '/pdf/');
      return {
        source: 'arxiv',
        key: idUrl.split('/abs/').pop(),
        title: strip(tagOne(e, 'title')),
        desc: strip(tagOne(e, 'summary')).slice(0, 400),
        abstract: strip(tagOne(e, 'summary')),
        author: tagAll(e, 'name')
          .slice(0, 6)
          .map(strip)
          .join(', '),
        time: tagOne(e, 'published').slice(0, 10),
        url: idUrl,
        pdfUrl: pdf,
      };
    });
  } catch {
    return [];
  }
}

export async function searchCrossref(query, { max = 8 } = {}) {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${max}&select=DOI,title,abstract,author,issued,URL`;
  try {
    const { body } = await get(url);
    const json = JSON.parse(body);
    return (json?.message?.items || []).map((it) => ({
      source: 'crossref',
      key: it.DOI,
      title: strip((it.title || [])[0]),
      desc: strip(it.abstract).slice(0, 400),
      abstract: strip(it.abstract),
      author: (it.author || [])
        .slice(0, 6)
        .map((a) => `${a.given || ''} ${a.family || ''}`.trim())
        .join(', '),
      time: it.issued?.['date-parts']?.[0]?.join('-') || '',
      url: it.URL || `https://doi.org/${it.DOI}`,
      pdfUrl: null,
    }));
  } catch {
    return [];
  }
}

export async function searchSemanticScholar(query, { max = 8 } = {}) {
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY || '';
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${max}&fields=title,abstract,authors,year,url,openAccessPdf,externalIds`;
  try {
    const { body } = await get(url, { headers: key ? { 'x-api-key': key } : {} });
    const json = JSON.parse(body);
    return (json?.data || []).map((it) => ({
      source: 's2',
      key: it.externalIds?.ArXiv || it.externalIds?.DOI || it.title,
      title: strip(it.title),
      desc: strip(it.abstract).slice(0, 400),
      abstract: strip(it.abstract),
      author: (it.authors || [])
        .slice(0, 6)
        .map((a) => a.name)
        .join(', '),
      time: String(it.year || ''),
      url: it.url,
      pdfUrl: it.openAccessPdf?.url || null,
    }));
  } catch {
    return [];
  }
}

export async function searchAll(query, { max = 8, sources = ['arxiv', 'crossref'] } = {}) {
  const tasks = [];
  if (sources.includes('arxiv')) tasks.push(searchArxiv(query, { max }));
  if (sources.includes('crossref')) tasks.push(searchCrossref(query, { max }));
  if (sources.includes('s2')) tasks.push(searchSemanticScholar(query, { max }));
  const results = await Promise.all(tasks);
  const merged = [];
  const seen = new Set();
  for (const list of results) {
    for (const item of list) {
      const norm = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      merged.push(item);
    }
  }
  return merged.slice(0, Math.max(max, 12));
}

export async function fetchArxivSource(identifier) {
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(identifier)}`;
  const { body } = await get(url);
  const entry = tagAll(body, 'entry')[0];
  if (!entry) return null;
  return {
    key: tagOne(entry, 'id').split('/abs/').pop(),
    title: strip(tagOne(entry, 'title')),
    abstract: strip(tagOne(entry, 'summary')),
    authors: tagAll(entry, 'name').map(strip),
    published: tagOne(entry, 'published'),
    pdfUrl: tagOne(entry, 'id').replace('/abs/', '/pdf/'),
  };
}

// ---- P0-4 检索三件套（线上工具面对齐 2026-10-10 GAP-LIST v2）----

/** arXiv PDF → 全文文本（挂 mcp__paper_search__get_paper_fulltext 工具） */
export async function fetchPaperFulltext(identifier, { maxChars = 12000 } = {}) {
  // 支持 arXiv ID（2309.17453 / 2309.17453v2）或 URL
  let arxivId = identifier;
  const m = String(identifier).match(/arxiv\.org\/(?:abs|pdf)\/([\d.]+(?:v\d+)?)/i);
  if (m) arxivId = m[1];
  if (!/^[\d.]+(v\d+)?$/i.test(arxivId)) {
    return { error: `not an arXiv id: ${identifier}`, text: null };
  }
  const pdfUrl = `https://arxiv.org/pdf/${arxivId}`;
  try {
    const res = await fetch(pdfUrl, { headers: { 'User-Agent': 'novix-open-research/1.0' }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { error: `arxiv ${res.status}`, text: null };
    const buf = Buffer.from(await res.arrayBuffer());
    const tmp = `/tmp/novix-paper-${Date.now()}.pdf`;
    const fs = await import('node:fs');
    fs.writeFileSync(tmp, buf);
    // pdftotext 提取
    const { execFile } = await import('node:child_process');
    const text = await new Promise((resolve) => {
      execFile('pdftotext', ['-l', '20', tmp, '-'], { maxBuffer: 4e6 }, (err, stdout) => {
        fs.rmSync(tmp, { force: true });
        resolve(err ? null : stdout);
      });
    });
    if (!text) return { error: 'pdftotext failed or not installed', text: null };
    return { arxivId, source: pdfUrl, chars: text.length, text: text.slice(0, maxChars) };
  } catch (e) {
    return { error: e.message, text: null };
  }
}

/** 真实 web 搜索（DuckDuckGo HTML 版——clawsgo workspace.mjs:857 同源实现） */
export async function webSearch({ query, limit = 5 } = {}) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await res.text();
    const results = [];
    const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snipRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    let m;
    while ((m = linkRe.exec(html)) && results.length < limit) {
      const snippetM = snipRe.exec(html);
      results.push({ url: m[1], title: strip(m[2]).slice(0, 120), snippet: snippetM ? strip(snippetM[1]).slice(0, 200) : '' });
    }
    return { query, results };
  } catch (e) {
    return { query, results: [], error: e.message };
  }
}

/** Google Scholar 搜索（Serper 风格解析——无 API key 时降级到 DuckDuckGo academic 前缀） */
export async function scholarSearch({ query, limit = 5 } = {}) {
  // Google Scholar 直爬易被墙——用 site:scholar.google.com 或学术关键词 DuckDuckGo 降级
  return webSearch({ query: `${query} site:arxiv.org OR site:semanticscholar.org OR "doi.org"`, limit });
}
