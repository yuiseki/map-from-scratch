// The part of YAML that spec.yaml uses, parsed without dependencies:
// block mappings and sequences, plain and quoted scalars, flow [..] and {..},
// folded (>) and literal (|) block scalars, comments. No anchors, tags or
// multi-document streams; anything outside the subset is an error.

export type Yaml = null | boolean | number | string | Yaml[] | { [key: string]: Yaml };
interface Line { indent: number; text: string; no: number }

const NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

function scalar(s: string): Yaml {
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (NUMBER.test(s)) return Number(s);
  return s;
}

// Strip a trailing comment: '#' at the start or after whitespace, outside quotes.
function stripComment(text: string): string {
  let q: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s[{,:]/.test(text[i - 1])) q = c;
    } else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}

// Flow collections and quoted scalars, from position i of s.
function parseFlow(s: string, i: number, stops: string, lineNo: number): [Yaml, number] {
  const fail = (m: string): never => { throw new Error(`yaml line ${lineNo}: ${m}`); };
  const ws = () => { while (s[i] === ' ') i++; };
  ws();
  const c = s[i];
  if (c === '"') {
    let out = '';
    for (i++; i < s.length && s[i] !== '"'; i++) {
      if (s[i] === '\\') {
        const e = s[++i];
        if (e === 'n') out += '\n';
        else if (e === 't') out += '\t';
        else if (e === 'u') { out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16)); i += 4; }
        else out += e;
      } else out += s[i];
    }
    if (s[i] !== '"') fail('unterminated "string"');
    return [out, i + 1];
  }
  if (c === "'") {
    let out = '';
    for (i++; i < s.length; i++) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") { out += "'"; i++; } else break;
      } else out += s[i];
    }
    if (s[i] !== "'") fail("unterminated 'string'");
    return [out, i + 1];
  }
  if (c === '[' || c === '{') {
    const isMap = c === '{', close = isMap ? '}' : ']';
    const out: Yaml = isMap ? {} : [];
    i++;
    ws();
    if (s[i] === close) return [out, i + 1];
    for (;;) {
      let key: Yaml = null;
      if (isMap) {
        [key, i] = parseFlow(s, i, ':', lineNo);
        ws();
        if (s[i] !== ':') fail('expected ":" in flow mapping');
        i++;
      }
      let v: Yaml;
      [v, i] = parseFlow(s, i, `,${close}`, lineNo);
      if (Array.isArray(out)) out.push(v); else (out as Record<string, Yaml>)[String(key)] = v;
      ws();
      if (s[i] === ',') { i++; ws(); continue; }
      if (s[i] === close) return [out, i + 1];
      fail(`expected "," or "${close}"`);
    }
  }
  const start = i;
  while (i < s.length && !stops.includes(s[i])) i++;
  return [scalar(s.slice(start, i).trim()), i];
}

function inline(text: string, lineNo: number): Yaml {
  const t = text.trim();
  if (t[0] === '[' || t[0] === '{' || t[0] === '"' || t[0] === "'") {
    const [v, end] = parseFlow(t, 0, '', lineNo);
    if (t.slice(end).trim() !== '') throw new Error(`yaml line ${lineNo}: unexpected text after value`);
    return v;
  }
  if (/^[&*!|>@%`]/.test(t)) {
    throw new Error(`yaml line ${lineNo}: plain scalar starts with a reserved YAML indicator; quote it`);
  }
  return scalar(t);
}

const KEY = /^("[^"]*"|'[^']*'|[^\s"'[\]{}#-][^:]*?|-[^\s:][^:]*?):(\s+|$)/;
const ITEM = /^-(\s+|$)/;

export function parseYaml(src: string): Yaml {
  const raw = src.replace(/\r\n?/g, '\n').split('\n');
  const lines: Line[] = raw.map((r, n) => {
    const m = r.match(/^( *)(\t*)/)!;
    const text = stripComment(r.slice(m[1].length));
    if (m[2] && text) throw new Error(`yaml line ${n + 1}: tab in indentation`);
    return { indent: m[1].length, text, no: n + 1 };
  });
  let i = 0;
  const skip = () => { while (i < lines.length && lines[i].text === '') i++; };

  function block(indent: number): Yaml {
    skip();
    if (i >= lines.length) return null;
    return ITEM.test(lines[i].text) ? seq(lines[i].indent) : map(lines[i].indent);
  }

  // A value that starts on the line after "key:" or "-".
  function nested(parentIndent: number, allowSeqAtSameIndent: boolean): Yaml {
    skip();
    if (i >= lines.length) return null;
    const l = lines[i];
    if (l.indent > parentIndent) return block(l.indent);
    if (allowSeqAtSameIndent && l.indent === parentIndent && ITEM.test(l.text)) return seq(parentIndent);
    return null;
  }

  function blockScalar(header: string, parentIndent: number): string {
    const literal = header[0] === '|', chomp = header.includes('-') ? 'strip' : 'clip';
    const body: string[] = [];
    let indent: number | null = null;
    for (; i < lines.length; i++) {
      const r = raw[i];
      if (r.trim() === '') { body.push(''); continue; }
      const ind = r.match(/^ */)![0].length;
      if (ind <= parentIndent) break;
      if (indent === null) indent = ind;
      body.push(r.slice(indent));
    }
    while (body.length && body[body.length - 1] === '') body.pop();
    let text;
    if (literal) text = body.join('\n');
    else {
      text = '';
      for (let k = 0; k < body.length; k++) {
        if (body[k] === '') text += '\n';
        else text += (k > 0 && body[k - 1] !== '' ? ' ' : '') + body[k];
      }
    }
    return chomp === 'strip' ? text : `${text}\n`;
  }

  function map(indent: number): Yaml {
    const out: Record<string, Yaml> = {};
    for (skip(); i < lines.length; skip()) {
      const l = lines[i];
      if (l.indent < indent) break;
      if (l.indent > indent) throw new Error(`yaml line ${l.no}: bad indentation`);
      if (ITEM.test(l.text)) break;
      const m = l.text.match(KEY);
      if (!m) throw new Error(`yaml line ${l.no}: expected "key: value"`);
      const key = String(m[1][0] === '"' || m[1][0] === "'" ? inline(m[1], l.no) : m[1].trim());
      const rest = l.text.slice(m[0].length).trim();
      i++;
      if (rest === '') out[key] = nested(indent, true);
      else if (/^[|>][-+]?$/.test(rest)) out[key] = blockScalar(rest, indent);
      else out[key] = inline(rest, l.no);
    }
    return out;
  }

  function seq(indent: number): Yaml {
    const out: Yaml[] = [];
    for (skip(); i < lines.length; skip()) {
      const l = lines[i];
      if (l.indent < indent) break;
      if (l.indent > indent) throw new Error(`yaml line ${l.no}: bad indentation`);
      const m = l.text.match(ITEM);
      if (!m) break;
      const content = l.text.slice(m[0].length);
      const at = indent + m[0].length;
      if (content === '') { i++; out.push(nested(indent, false)); continue; }
      if (ITEM.test(content) || KEY.test(content)) {
        // "- key: v" or "- - x": the rest of the item continues at the column of its content.
        lines[i] = { indent: at, text: content, no: l.no };
        out.push(ITEM.test(content) ? seq(at) : map(at));
        continue;
      }
      i++;
      out.push(/^[|>][-+]?$/.test(content) ? blockScalar(content, indent) : inline(content, l.no));
    }
    return out;
  }

  const v = block(0);
  skip();
  if (i < lines.length) throw new Error(`yaml line ${lines[i].no}: bad indentation`);
  return v ?? {};
}
