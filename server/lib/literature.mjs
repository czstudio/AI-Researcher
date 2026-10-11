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
