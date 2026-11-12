/**
 * 文档解析：把上传的二进制文件转成纯文本
 * 支持 txt / md / csv / json / pdf / docx / pptx，并对旧版 doc / ppt 做尽力而为的抽取
 */
const path = require('path');

const SUPPORTED = ['.txt', '.md', '.markdown', '.csv', '.json', '.log', '.pdf', '.doc', '.docx', '.ppt', '.pptx'];

function extOf(filename) {
  return path.extname(filename || '').toLowerCase();
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

async function parsePdf(buffer) {
  // pdf-parse 1.x 直接 require 主入口会触发其内置测试文件，需引入内部模块
  let pdfParse;
  try {
    pdfParse = require('pdf-parse/lib/pdf-parse.js');
  } catch (e) {
    pdfParse = require('pdf-parse');
  }
  const data = await pdfParse(buffer);
  return (data.text || '').trim();
}

async function parseDocx(buffer) {
  const mammoth = require('mammoth');
  const res = await mammoth.extractRawText({ buffer });
  return (res.value || '').trim();
}

async function parsePptx(buffer) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));

  if (!names.length) throw new Error('PPTX 中未找到幻灯片内容');

  const pages = [];
  for (let i = 0; i < names.length; i++) {
    const xml = await zip.file(names[i]).async('string');
    const texts = (xml.match(/<a:t>[\s\S]*?<\/a:t>/g) || []).map((t) => decodeXml(t.replace(/<\/?a:t>/g, '')));
    pages.push('【第 ' + (i + 1) + ' 页】\n' + texts.join('\n'));
  }
  return pages.join('\n\n');
}

/** 旧版二进制 .doc/.ppt：按 UTF-16LE 与 Latin1 双通道提取可读片段 */
function parseLegacy(buffer) {
  const s16 = buffer.toString('utf16le');
  const s8 = buffer.toString('latin1');

  const pick = (str) => {
    const runs = str.match(/[\u4e00-\u9fa5A-Za-z0-9，。、；：？！（）《》“”‘’\-—,.()%\s]{6,}/g) || [];
    return runs
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => {
        const cn = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
        return cn >= 2 || s.length >= 12;
      });
  };

  const seen = new Set();
  const out = [];
  pick(s16).concat(pick(s8)).forEach((s) => {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  });

  const text = out.join('\n').trim();
  if (text.replace(/\s/g, '').length < 40) {
    throw new Error('旧版 .doc/.ppt 为二进制格式，未能提取有效文本，请另存为 .docx / .pptx 后重试');
  }
  return text;
}

async function parse(buffer, filename) {
  const ext = extOf(filename);
  if (!SUPPORTED.includes(ext)) {
    throw new Error('暂不支持的文件格式：' + ext + '（支持 ' + SUPPORTED.join(' ') + '）');
  }

  let text = '';
  if (ext === '.pdf') text = await parsePdf(buffer);
  else if (ext === '.docx') text = await parseDocx(buffer);
  else if (ext === '.pptx') text = await parsePptx(buffer);
  else if (ext === '.doc' || ext === '.ppt') text = parseLegacy(buffer);
  else text = buffer.toString('utf8');

  text = text.replace(/\u0000/g, '').trim();
  if (!text) throw new Error('未解析到文本内容（可能是扫描版 PDF 或纯图片文件）');
  return text;
}

module.exports = { parse, extOf, SUPPORTED };
