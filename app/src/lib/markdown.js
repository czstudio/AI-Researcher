// Minimal streaming-safe markdown renderer (no dependencies).

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  out = out.replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>');
  return out;
}

// ANSI escape -> html spans (used for terminal blocks coming off the sandbox).
export function ansiToHtml(text) {
  const map = { 30: 'black', 31: 'red', 32: 'green', 33: 'yellow', 34: 'blue', 35: 'magenta', 36: 'cyan', 37: 'white' };
  let out = esc(text);
  out = out.replace(/\[([0-9;]*)m/g, (_, codes) => {
    if (!codes) return '</span>';
    const parts = codes.split(';').filter(Boolean);
    const cls = [];
    for (const c of parts) {
      if (map[c]) cls.push(`ansi-fg-${map[c]}`);
      else if (c === '1') cls.push('ansi-b');
      else if (c === '0') return '</span>';
    }
    return cls.length ? `<span class="${cls.join(' ')}">` : '';
  });
  return out;
}

export function renderMarkdown(src) {
  const text = String(src || '');
  const lines = text.split('\n');
  let html = '';
  let i = 0;

  const flushList = (items, ordered) =>
    `<${ordered ? 'ol' : 'ul'}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      const code = buf.join('\n');
      if (lang === 'ansi') html += `<div class="ansi">${ansiToHtml(code)}</div>`;
      else html += `<pre><code data-lang="${esc(lang)}">${esc(code)}</code></pre>`;
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = Math.min(h[1].length, 4);
      html += `<h${lvl}>${inline(h[2])}</h${lvl}>`;
      i++;
      continue;
    }

    // hr
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      html += '<hr/>';
      i++;
      continue;
    }

    // table
    if (/^\|.*\|$/.test(line.trim()) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const head = line.trim().slice(1, -1).split('|').map((s) => s.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        rows.push(lines[i].trim().slice(1, -1).split('|').map((s) => s.trim()));
        i++;
      }
      html += `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;
      continue;
    }

    // lists
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      html += flushList(items, false);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      html += flushList(items, true);
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      html += `<blockquote>${inline(buf.join(' '))}</blockquote>`;
      continue;
    }

    // blank
    if (!line.trim()) {
      i++;
      continue;
    }

    // paragraph
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|[-*+]\s|\d+\.\s|\|)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    html += `<p>${inline(para.join('\n'))}</p>`;
  }
  return html;
}
