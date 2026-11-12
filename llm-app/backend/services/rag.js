/**
 * RAG 检索：文本分块 + BM25 关键词检索（中文按字 bigram 切分，英文按词切分）
 */
const config = require('../config');
const store = require('./store');

let index = { chunks: [], df: Object.create(null), avgdl: 0 };

/** 文本清洗 + 语义分块（优先在句末断开，块间保留 overlap 重叠） */
function chunkText(input, size, overlap) {
  size = size || config.rag.chunkSize;
  overlap = overlap == null ? config.rag.overlap : overlap;

  const clean = String(input)
    .replace(/\r/g, '')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const chunks = [];
  let i = 0;
  let guard = 0;

  while (i < clean.length && guard++ < 5000) {
    let end = Math.min(clean.length, i + size);

    if (end < clean.length) {
      const seg = clean.slice(i, end);
      const cut = Math.max(
        seg.lastIndexOf('。'),
        seg.lastIndexOf('\n'),
        seg.lastIndexOf('；'),
        seg.lastIndexOf('！'),
        seg.lastIndexOf('？'),
        seg.lastIndexOf('. ')
      );
      if (cut > size * 0.45) end = i + cut + 1;
    }

    const piece = clean.slice(i, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;

    const next = end - overlap;
    i = next > i ? next : end;
  }

  return chunks;
}

function tokenize(text) {
  const s = String(text).toLowerCase();
  const tokens = s.match(/[a-z0-9_]+/g) || [];
  const cjk = s.match(/[\u4e00-\u9fa5]+/g) || [];

  cjk.forEach((seg) => {
    if (seg.length === 1) {
      tokens.push(seg);
      return;
    }
    for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2));
  });

  return tokens;
}

/** 从数据库加载所有分块并重建内存索引 */
async function rebuild() {
  const rows = await store.listAllChunks();
  const df = Object.create(null);
  const chunks = [];
  let totalLen = 0;

  rows.forEach((row) => {
    const toks = tokenize(row.content);
    const tf = Object.create(null);
    toks.forEach((t) => (tf[t] = (tf[t] || 0) + 1));
    Object.keys(tf).forEach((t) => (df[t] = (df[t] || 0) + 1));
    totalLen += toks.length;

    chunks.push({
      id: row.id,
      docId: row.doc_id,
      filename: row.filename,
      seq: row.seq,
      text: row.content,
      tf,
      len: toks.length
    });
  });

  index = { chunks, df, avgdl: chunks.length ? totalLen / chunks.length : 0 };
  console.log('[RAG] 索引重建完成：' + chunks.length + ' 个分块，平均长度 ' + index.avgdl.toFixed(1));
  return chunks.length;
}

/** BM25 检索，返回 [{ filename, seq, text, score, rel }] */
function retrieve(query, topK) {
  const N = index.chunks.length;
  if (!N) return [];

  const k = topK || config.rag.topK;
  const k1 = 1.5;
  const b = 0.75;
  const qToks = [...new Set(tokenize(query))];
  const scored = [];

  index.chunks.forEach((c) => {
    let score = 0;
    qToks.forEach((t) => {
      const f = c.tf[t];
      if (!f) return;
      const df = index.df[t] || 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * c.len) / (index.avgdl || 1)));
    });
    if (score > 0) scored.push({ chunk: c, score });
  });

  scored.sort((a, b2) => b2.score - a.score);
  const max = scored.length ? scored[0].score : 1;

  return scored.slice(0, k).map((s) => ({
    docId: s.chunk.docId,
    filename: s.chunk.filename,
    seq: s.chunk.seq,
    text: s.chunk.text,
    score: Number(s.score.toFixed(4)),
    rel: Number((s.score / max).toFixed(4))
  }));
}

/** 把检索结果拼成参考资料文本 */
function buildContext(hits) {
  if (!hits.length) return '';
  return hits
    .map((h, i) => '[' + (i + 1) + '] 来源：' + h.filename + '（第 ' + (h.seq + 1) + ' 段）\n' + h.text)
    .join('\n\n');
}

function stats() {
  return { chunks: index.chunks.length, docs: new Set(index.chunks.map((c) => c.docId)).size, avgdl: Math.round(index.avgdl) };
}

module.exports = { chunkText, tokenize, rebuild, retrieve, buildContext, stats };
