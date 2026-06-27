const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const archiver = require('archiver');
const PDFDocument = require('pdfkit');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const app = express();

const CORS_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const OPS_ADMIN_USERNAME = (process.env.OPS_ADMIN_USERNAME || 'platform_admin').trim() || 'platform_admin';
const OPS_ADMIN_PASSWORD = (process.env.OPS_ADMIN_PASSWORD || '').trim();

app.use(cors(CORS_ORIGINS.length ? { origin: CORS_ORIGINS } : undefined));
app.use(express.json({ limit: '8mb' }));

const PORT = Number(process.env.PORT || 8088);
const PUBLIC_APP_BASE_URL = (process.env.PUBLIC_APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const NOTICE_ATTACHMENT_DIR = path.join(UPLOAD_DIR, 'notice-attachments');
const EXPORT_DIR = path.join(DATA_DIR, 'exports');
const DB_FILE = path.join(DATA_DIR, 'jiaxiao-sign.sqlite');
const DEFAULT_NOTICE_TYPE = '安全承诺书';
const PDF_FONT_CANDIDATES = [
  process.env.PDF_FONT_PATH,
  path.join(__dirname, 'assets', 'fonts', 'NotoSansSC-Regular.otf'),
  path.join(__dirname, 'assets', 'fonts', 'NotoSansSC-Regular.ttf'),
  'C:\\Windows\\Fonts\\simhei.ttf',
  'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf',
  'C:\\Windows\\Fonts\\Deng.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf',
  '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf',
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttf',
  '/usr/share/fonts/opentype/adobe-source-han-sans/SourceHanSansSC-Regular.otf',
];

for (const dir of [DATA_DIR, UPLOAD_DIR, NOTICE_ATTACHMENT_DIR, EXPORT_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parentPublicUrl(token) {
  return `${PUBLIC_APP_BASE_URL}/?t=${encodeURIComponent(token)}`;
}

function randomToken(len = 32) {
  return crypto.randomBytes(len).toString('hex');
}

function now() {
  return new Date().toISOString();
}

function normalizeText(v) {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
}

function normalizeNonNegativeInteger(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function normalizeLongText(v) {
  if (typeof v !== 'string') return '';
  return v
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/[ \t]+/g, ' '))
    .join('\n')
    .trim();
}

function normalizeFontPath(value) {
  const fontPath = normalizeText(value);
  if (!fontPath) return '';
  return path.isAbsolute(fontPath) ? fontPath : path.resolve(__dirname, fontPath);
}

function applyPdfFont(doc) {
  const failures = [];
  for (const candidate of PDF_FONT_CANDIDATES) {
    const fontPath = normalizeFontPath(candidate);
    if (!fontPath || !fs.existsSync(fontPath)) continue;
    try {
      doc.font(fontPath);
      return fontPath;
    } catch (err) {
      failures.push(`${fontPath}: ${err.message}`);
    }
  }
  const detail = failures.length ? `；已尝试但加载失败：${failures.join('；')}` : '';
  throw new Error(`未找到可用于中文 PDF 的 TTF/OTF 字体，请安装中文字体或设置 PDF_FONT_PATH${detail}`);
}

function isEmbeddablePng(buffer) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || !buffer.slice(0, 8).equals(pngSignature)) return false;
  let offset = 8;
  let hasIhdr = false;
  const idatChunks = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.slice(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const nextOffset = dataEnd + 4;
    if (length < 0 || nextOffset > buffer.length) return false;
    if (type === 'IHDR') {
      const width = buffer.readUInt32BE(dataStart);
      const height = buffer.readUInt32BE(dataStart + 4);
      hasIhdr = width > 0 && height > 0;
    }
    if (type === 'IDAT') idatChunks.push(buffer.slice(dataStart, dataEnd));
    if (type === 'IEND') break;
    offset = nextOffset;
  }
  if (!hasIhdr || !idatChunks.length) return false;
  zlib.inflateSync(Buffer.concat(idatChunks));
  return true;
}

function isEmbeddableJpeg(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length > 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[buffer.length - 2] === 0xff &&
    buffer[buffer.length - 1] === 0xd9
  );
}

function canEmbedSignatureImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) return false;
  try {
    const buffer = fs.readFileSync(filePath);
    return ext === '.png' ? isEmbeddablePng(buffer) : isEmbeddableJpeg(buffer);
  } catch (err) {
    return false;
  }
}

function isExpired(value) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= Date.now();
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripXmlTags(value) {
  return String(value || '').replace(/<[^>]+>/g, '');
}

function xmlText(value) {
  return decodeXmlEntities(stripXmlTags(value));
}

function bufferToText(buffer) {
  if (!Buffer.isBuffer(buffer)) return String(buffer || '').replace(/^\uFEFF/, '');
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.slice(2).toString('utf16le').replace(/^\uFEFF/, '');
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

function detectDelimiter(text) {
  const firstLine = String(text || '').split(/\r?\n/, 1)[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  return tabCount > commaCount ? '\t' : ',';
}

function parseDelimitedText(raw, delimiter = detectDelimiter(raw)) {
  const text = String(raw || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => normalizeText(value))) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushCell();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      pushRow();
    } else {
      cell += ch;
    }
  }

  if (cell || row.length) pushRow();
  return rows;
}

function normalizeHeaderKey(value) {
  return normalizeText(value).toLowerCase().replace(/[\s_-]/g, '');
}

function tableRowsToStudentRows(tableRows) {
  const rows = Array.isArray(tableRows) ? tableRows : [];
  const nonEmptyRows = rows.filter((row) => Array.isArray(row) && row.some((cell) => normalizeText(cell)));
  if (!nonEmptyRows.length) return [];

  const header = nonEmptyRows[0].map(normalizeHeaderKey);
  const nameIndex = header.findIndex((key) => key === '学生姓名' || key === '姓名' || key === 'studentname');
  const noIndex = header.findIndex((key) => key === '班内序号' || key === '序号' || key === 'studentno');
  const hasHeader = nameIndex >= 0 && noIndex >= 0;
  const sourceRows = hasHeader ? nonEmptyRows.slice(1) : nonEmptyRows;
  const finalNameIndex = hasHeader ? nameIndex : 0;
  const finalNoIndex = hasHeader ? noIndex : 1;

  return sourceRows.map((row) => ({
    studentName: normalizeText(row[finalNameIndex] || ''),
    studentNo: normalizeText(row[finalNoIndex] || ''),
  }));
}

function parseRowFromText(raw) {
  return tableRowsToStudentRows(parseDelimitedText(raw));
}

function parseExcelXmlRows(raw) {
  const text = bufferToText(raw);
  const rows = [];
  const rowRe = /<Row\b[^>]*>([\s\S]*?)<\/Row>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(text))) {
    const cells = [];
    const cellRe = /<Cell\b([^>]*)>([\s\S]*?)<\/Cell>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1] || '';
      const indexMatch = attrs.match(/\b(?:ss:)?Index="(\d+)"/i);
      if (indexMatch) {
        const oneBasedIndex = Number(indexMatch[1]);
        while (cells.length < oneBasedIndex - 1) cells.push('');
      }
      const dataMatch = cellMatch[2].match(/<Data\b[^>]*>([\s\S]*?)<\/Data>/i);
      cells.push(normalizeText(xmlText(dataMatch ? dataMatch[1] : cellMatch[2])));
    }
    if (cells.some((cell) => normalizeText(cell))) rows.push(cells);
  }
  if (!rows.length) {
    throw new Error('未识别到 Excel XML 表格行');
  }
  return rows;
}

function findZipEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 22 - 65535);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function readZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw new Error('XLSX 文件内容为空或格式不正确');
  }
  const eocdOffset = findZipEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw new Error('未识别到 XLSX 压缩目录');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  for (let i = 0; i < totalEntries; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('XLSX 压缩目录损坏');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileNameStart = offset + 46;
    const fileName = buffer
      .slice(fileNameStart, fileNameStart + fileNameLength)
      .toString('utf8')
      .replace(/\\/g, '/');
    entries.set(fileName, { method, compressedSize, localHeaderOffset });
    offset = fileNameStart + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipFile(buffer, entry) {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error('XLSX 本地文件头损坏');
  }
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.slice(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`暂不支持的 XLSX 压缩方式：${entry.method}`);
}

function parseSharedStrings(xml) {
  const values = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let siMatch;
  while ((siMatch = siRe.exec(xml))) {
    const parts = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
    let tMatch;
    while ((tMatch = tRe.exec(siMatch[1]))) {
      parts.push(xmlText(tMatch[1]));
    }
    values.push(normalizeText(parts.join('')));
  }
  return values;
}

function columnRefToIndex(ref) {
  let value = 0;
  for (const ch of String(ref || '').toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) continue;
    value = value * 26 + (code - 64);
  }
  return Math.max(0, value - 1);
}

function readWorksheetCell(attrs, body, sharedStrings) {
  const type = (attrs.match(/\bt="([^"]+)"/i) || [])[1] || '';
  if (type === 's') {
    const valueMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
    const index = Number(xmlText(valueMatch ? valueMatch[1] : ''));
    return Number.isFinite(index) ? sharedStrings[index] || '' : '';
  }
  if (type === 'inlineStr') {
    const parts = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
    let tMatch;
    while ((tMatch = tRe.exec(body))) {
      parts.push(xmlText(tMatch[1]));
    }
    return normalizeText(parts.join(''));
  }
  const valueMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
  return normalizeText(xmlText(valueMatch ? valueMatch[1] : ''));
}

function parseWorksheetXmlRows(xml, sharedStrings) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    const row = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
    let cellMatch;
    let nextIndex = 0;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1] || '';
      const refMatch = attrs.match(/\br="([A-Z]+)\d+"/i);
      const cellIndex = refMatch ? columnRefToIndex(refMatch[1]) : nextIndex;
      while (row.length < cellIndex) row.push('');
      row[cellIndex] = readWorksheetCell(attrs, cellMatch[2], sharedStrings);
      nextIndex = cellIndex + 1;
    }
    if (row.some((cell) => normalizeText(cell))) rows.push(row);
  }
  return rows;
}

function parseXlsxRows(buffer) {
  const entries = readZipEntries(buffer);
  const sheetName = Array.from(entries.keys())
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
  if (!sheetName) {
    throw new Error('XLSX 中未找到工作表');
  }
  const sharedEntry = entries.get('xl/sharedStrings.xml');
  const sharedStrings = sharedEntry ? parseSharedStrings(readZipFile(buffer, sharedEntry).toString('utf8')) : [];
  const rows = parseWorksheetXmlRows(readZipFile(buffer, entries.get(sheetName)).toString('utf8'), sharedStrings);
  if (!rows.length) {
    throw new Error('XLSX 工作表为空');
  }
  return rows;
}

function parseStudentRowsFromFile(buffer, fileName, contentType) {
  const safeFileName = normalizeText(path.basename(fileName || ''));
  const ext = path.extname(safeFileName).toLowerCase();
  const mime = normalizeText(contentType).toLowerCase();
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('上传文件为空');
  }
  if (ext === '.xlsx' || mime.includes('openxmlformats-officedocument') || buffer.slice(0, 2).toString('utf8') === 'PK') {
    return tableRowsToStudentRows(parseXlsxRows(buffer));
  }

  const text = bufferToText(buffer);
  const head = text.slice(0, 300).trim();
  if (ext === '.xls' || mime.includes('vnd.ms-excel') || /^<\?xml/i.test(head) || /<Workbook\b/i.test(head)) {
    return tableRowsToStudentRows(parseExcelXmlRows(text));
  }
  if (ext === '.csv' || ext === '.txt' || ext === '.tsv' || mime.startsWith('text/') || mime.includes('octet-stream')) {
    return parseRowFromText(text);
  }
  throw new Error('仅支持 xlsx、xls、csv 或 txt 文件');
}

function parseTableRowsFromFile(buffer, fileName, contentType) {
  const safeFileName = normalizeText(path.basename(fileName || ''));
  const ext = path.extname(safeFileName).toLowerCase();
  const mime = normalizeText(contentType).toLowerCase();
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('上传文件为空');
  }
  if (ext === '.xlsx' || mime.includes('openxmlformats-officedocument') || buffer.slice(0, 2).toString('utf8') === 'PK') {
    return parseXlsxRows(buffer);
  }

  const text = bufferToText(buffer);
  const head = text.slice(0, 300).trim();
  if (ext === '.xls' || mime.includes('vnd.ms-excel') || /^<\?xml/i.test(head) || /<Workbook\b/i.test(head)) {
    return parseExcelXmlRows(text);
  }
  if (ext === '.csv' || ext === '.txt' || ext === '.tsv' || mime.startsWith('text/') || mime.includes('octet-stream')) {
    return parseDelimitedText(text);
  }
  throw new Error('仅支持 xlsx、xls、csv 或 txt 文件');
}

function tableRowsToObjects(tableRows) {
  const rows = Array.isArray(tableRows) ? tableRows : [];
  const nonEmptyRows = rows.filter((row) => Array.isArray(row) && row.some((cell) => normalizeText(cell)));
  if (nonEmptyRows.length < 2) return [];
  const headers = nonEmptyRows[0].map((cell) => normalizeText(cell));
  return nonEmptyRows.slice(1).map((row, index) => {
    const item = { rowNumber: index + 2 };
    headers.forEach((header, headerIndex) => {
      if (header) item[header] = normalizeText(row[headerIndex] || '');
    });
    return item;
  });
}

function parseSchoolImportRowsFromFile(buffer, fileName, contentType) {
  return tableRowsToObjects(parseTableRowsFromFile(buffer, fileName, contentType));
}

function importCell(row, aliases) {
  const item = row && typeof row === 'object' ? row : {};
  const aliasSet = new Set(aliases.map(normalizeHeaderKey));
  for (const [key, value] of Object.entries(item)) {
    if (aliasSet.has(normalizeHeaderKey(key))) return normalizeText(value == null ? '' : String(value));
  }
  return '';
}

function normalizeClassLookupKey(value) {
  return normalizeText(value).replace(/[·\s]/g, '');
}

function roleFromImport(value) {
  const role = normalizeHeaderKey(value || '班主任');
  if (role === 'schooladmin' || role === '学校管理员' || role === '管理员') return 'school_admin';
  if (role === 'teacher' || role === 'homeroom' || role === '班主任' || role === '教师' || role === '老师') return 'teacher';
  return '';
}

function roleLabel(role) {
  return role === 'school_admin' ? '学校管理员' : '班主任';
}

function buildClassLookup(schoolId) {
  const rows = db.prepare('SELECT id, grade, name FROM classrooms WHERE school_id = ?').all(schoolId);
  const lookup = new Map();
  for (const row of rows) {
    lookup.set(normalizeClassLookupKey(`${row.grade}${row.name}`), row);
    lookup.set(normalizeClassLookupKey(`${row.grade} ${row.name}`), row);
    lookup.set(normalizeClassLookupKey(`${row.grade}·${row.name}`), row);
  }
  return lookup;
}

function buildSchoolImportPreview(schoolId, kind, inputRows) {
  const rows = Array.isArray(inputRows) ? inputRows : [];
  const result = { add: 0, update: 0, skip: 0 };
  const errors = [];
  const warnings = [];
  const normalized = [];

  if (kind === 'grades') {
    const exists = new Map(
      db.prepare('SELECT id, name, entry_year FROM school_grades WHERE school_id = ?').all(schoolId).map((row) => [row.name, row])
    );
    const seen = new Set();
    for (const raw of rows) {
      const rowNumber = Number(raw.rowNumber || raw._rowNumber || 0) || normalized.length + errors.length + 2;
      const name = importCell(raw, ['name', 'gradeName', 'grade', '年级名称', '年级']);
      const entryYear = importCell(raw, ['entryYear', 'entry_year', 'year', '入学年份', '年份']);
      if (!name) {
        errors.push({ rowNumber, reason: '年级名称不能为空' });
        continue;
      }
      if (seen.has(name)) {
        errors.push({ rowNumber, reason: '年级名称重复' });
        continue;
      }
      seen.add(name);
      const current = exists.get(name);
      const action = !current ? 'ADD' : normalizeText(current.entry_year || '') === entryYear ? 'SKIP' : 'UPDATE';
      result[action === 'ADD' ? 'add' : action === 'UPDATE' ? 'update' : 'skip'] += 1;
      normalized.push({
        rowNumber,
        action,
        name,
        entryYear,
        displayName: name,
        detail: entryYear || '未填写入学年份',
      });
    }
  } else if (kind === 'classes') {
    const exists = new Map(
      db
        .prepare('SELECT id, grade, name, capacity FROM classrooms WHERE school_id = ?')
        .all(schoolId)
        .map((row) => [`${row.grade}\u0000${row.name}`, row])
    );
    const seen = new Set();
    for (const raw of rows) {
      const rowNumber = Number(raw.rowNumber || raw._rowNumber || 0) || normalized.length + errors.length + 2;
      const grade = importCell(raw, ['grade', 'gradeName', '年级名称', '年级']);
      const name = importCell(raw, ['name', 'className', '班级名称', '班级']);
      const capacityText = importCell(raw, ['capacity', 'studentCount', '预计人数', '人数']);
      const capacity = capacityText ? Number(capacityText) : 0;
      if (!grade || !name) {
        errors.push({ rowNumber, reason: '年级名称和班级名称不能为空' });
        continue;
      }
      if (!Number.isFinite(capacity) || capacity < 0) {
        errors.push({ rowNumber, reason: '预计人数格式不正确' });
        continue;
      }
      const key = `${grade}\u0000${name}`;
      if (seen.has(key)) {
        errors.push({ rowNumber, reason: '班级重复' });
        continue;
      }
      seen.add(key);
      const current = exists.get(key);
      const action = !current ? 'ADD' : Number(current.capacity || 0) === capacity ? 'SKIP' : 'UPDATE';
      result[action === 'ADD' ? 'add' : action === 'UPDATE' ? 'update' : 'skip'] += 1;
      normalized.push({
        rowNumber,
        action,
        grade,
        name,
        capacity,
        displayName: `${grade}${name}`,
        detail: `预计人数 ${capacity}`,
      });
    }
  } else if (kind === 'accounts') {
    const schoolUsers = new Map(
      db.prepare('SELECT id, username, role, name, classroom_id, enabled FROM users WHERE school_id = ?').all(schoolId).map((row) => [row.username, row])
    );
    const allUsers = new Map(db.prepare('SELECT id, username, school_id FROM users').all().map((row) => [row.username, row]));
    const classes = buildClassLookup(schoolId);
    const seen = new Set();
    for (const raw of rows) {
      const rowNumber = Number(raw.rowNumber || raw._rowNumber || 0) || normalized.length + errors.length + 2;
      const name = importCell(raw, ['name', 'teacherName', '姓名', '教师姓名']);
      const username = importCell(raw, ['username', 'account', '登录账号', '账号']);
      const role = roleFromImport(importCell(raw, ['role', '角色']));
      const classLabel = importCell(raw, ['classLabel', 'className', '负责班级', '班级']);
      const initialPassword = importCell(raw, ['initialPassword', 'password', '初始密码', '登录密码', '自定义密码', '密码']);
      const classroom = classLabel ? classes.get(normalizeClassLookupKey(classLabel)) : null;
      if (!name || !username || !role) {
        errors.push({ rowNumber, reason: '姓名、登录账号和角色不能为空' });
        continue;
      }
      if (initialPassword && !validatePassword(initialPassword)) {
        errors.push({ rowNumber, reason: '初始密码需为 8 到 128 位' });
        continue;
      }
      if (seen.has(username)) {
        errors.push({ rowNumber, reason: '登录账号重复' });
        continue;
      }
      seen.add(username);
      const anyUser = allUsers.get(username);
      if (anyUser && anyUser.school_id !== schoolId) {
        errors.push({ rowNumber, reason: '登录账号已被其他学校使用' });
        continue;
      }
      if (role === 'teacher' && !classroom) {
        errors.push({ rowNumber, reason: '班主任必须填写已存在的负责班级' });
        continue;
      }
      const classroomId = role === 'teacher' ? classroom.id : null;
      const current = schoolUsers.get(username);
      const action = !current
        ? 'ADD'
        : current.name === name && current.role === role && (current.classroom_id || null) === classroomId
          ? 'SKIP'
          : 'UPDATE';
      if (initialPassword && current) {
        warnings.push({ rowNumber, reason: '账号已存在，导入不会修改密码；如需改密请使用重置密码' });
      }
      result[action === 'ADD' ? 'add' : action === 'UPDATE' ? 'update' : 'skip'] += 1;
      normalized.push({
        rowNumber,
        action,
        name,
        username,
        role,
        initialPassword: action === 'ADD' ? initialPassword : '',
        passwordSource: action === 'ADD' && initialPassword ? 'CUSTOM' : action === 'ADD' ? 'RANDOM' : '',
        classroomId,
        classLabel: role === 'teacher' ? `${classroom.grade}${classroom.name}` : '全校',
        displayName: name,
        detail: `${roleLabel(role)} · ${role === 'teacher' ? `${classroom.grade}${classroom.name}` : '全校'}${action === 'ADD' ? ` · ${initialPassword ? '自定义初始密码' : '系统生成密码'}` : ''}`,
      });
    }
  } else {
    errors.push({ reason: '不支持的导入类型' });
  }

  return {
    kind,
    result,
    warnings,
    errors,
    canSubmit: errors.length === 0,
    rows: normalized,
  };
}

function commitSchoolImport(schoolId, actorUserId, kind, preview) {
  const createdAccounts = [];
  const tx = db.transaction(() => {
    if (kind === 'grades') {
      const insert = db.prepare('INSERT INTO school_grades (school_id, name, entry_year, created_at) VALUES (?, ?, ?, ?)');
      const update = db.prepare('UPDATE school_grades SET entry_year = ? WHERE school_id = ? AND name = ?');
      for (const item of preview.rows) {
        if (item.action === 'ADD') insert.run(schoolId, item.name, item.entryYear || '', now());
        if (item.action === 'UPDATE') update.run(item.entryYear || '', schoolId, item.name);
      }
    } else if (kind === 'classes') {
      const insert = db.prepare('INSERT INTO classrooms (school_id, grade, name, capacity, created_at) VALUES (?, ?, ?, ?, ?)');
      const update = db.prepare('UPDATE classrooms SET capacity = ? WHERE school_id = ? AND grade = ? AND name = ?');
      const upsertGrade = db.prepare('INSERT OR IGNORE INTO school_grades (school_id, name, entry_year, created_at) VALUES (?, ?, ?, ?)');
      for (const item of preview.rows) {
        upsertGrade.run(schoolId, item.grade, '', now());
        if (item.action === 'ADD') insert.run(schoolId, item.grade, item.name, item.capacity || 0, now());
        if (item.action === 'UPDATE') update.run(item.capacity || 0, schoolId, item.grade, item.name);
      }
    } else if (kind === 'accounts') {
      const insert = db.prepare(
        `INSERT INTO users (school_id, username, password_hash, role, name, classroom_id, must_reset_password, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)`
      );
      const update = db.prepare('UPDATE users SET role = ?, name = ?, classroom_id = ? WHERE school_id = ? AND username = ?');
      for (const item of preview.rows) {
        if (item.action === 'ADD') {
          const initialPassword = normalizeText(item.initialPassword) || generateInitialPassword();
          insert.run(
            schoolId,
            item.username,
            bcrypt.hashSync(initialPassword, 10),
            item.role,
            item.name,
            item.classroomId || null,
            now()
          );
          createdAccounts.push({ username: item.username, name: item.name, initialPassword });
        }
        if (item.action === 'UPDATE') update.run(item.role, item.name, item.classroomId || null, schoolId, item.username);
      }
    }
  });
  tx();
  insertAudit(actorUserId, `import_${kind}`, `school=${schoolId}`, `rows=${preview.rows.length}; add=${preview.result.add}; update=${preview.result.update}`);
  return { createdAccounts };
}

function buildImportPreview(classId, inputRows) {
  const csvRows = Array.isArray(inputRows) ? inputRows : [];
  const normalized = [];
  const errors = [];
  const warnings = [];
  const exists = db.prepare('SELECT * FROM students WHERE classroom_id = ?').all(classId);
  const existingByNo = new Map();
  for (const row of exists) {
    existingByNo.set(row.student_no, row);
  }

  const seenNo = new Set();
  let add = 0;
  let update = 0;
  let skip = 0;
  let conflict = 0;
  for (const item of csvRows) {
    const studentName = normalizeText(item.studentName || item.student_name || item['学生姓名'] || item['姓名'] || item[0] || '');
    const studentNo = normalizeText(item.studentNo || item.student_no || item['班内序号'] || item['序号'] || item[1] || '');
    if (!studentName || !studentNo) {
      errors.push({ reason: '姓名或序号为空', row: item });
      continue;
    }
    if (seenNo.has(studentNo)) {
      errors.push({ reason: '班内序号重复', row: item });
      continue;
    }
    seenNo.add(studentNo);
    const current = existingByNo.get(studentNo);
    if (!current) {
      normalized.push({ studentName, studentNo, action: 'ADD' });
      add += 1;
    } else if (current.student_name === studentName) {
      normalized.push({ studentId: current.id, studentName, studentNo, action: 'SKIP' });
      skip += 1;
    } else {
      const validBinding = db
        .prepare(`SELECT COUNT(*) as cnt FROM parent_bindings WHERE student_id = ? AND status='VALID'`)
        .get(current.id).cnt;
      if (validBinding > 0) {
        normalized.push({ studentId: current.id, studentName, studentNo, action: 'CONFLICT' });
        conflict += 1;
        warnings.push({
          reason: '姓名变更且学生已有有效绑定',
          studentNo,
          studentName,
          oldName: current.student_name,
        });
      } else {
        normalized.push({ studentId: current.id, studentName, studentNo, action: 'UPDATE' });
        update += 1;
      }
    }
  }

  return {
    classId,
    result: { add, update, skip, conflict },
    warnings,
    errors,
    canSubmit: errors.length === 0 && conflict === 0,
    rows: normalized,
  };
}

function normalizeImportSource(source, fallbackType = 'UNKNOWN') {
  const raw = source && typeof source === 'object' ? source : {};
  const sourceType = normalizeText(raw.sourceType || raw.type || fallbackType).toUpperCase();
  const allowedTypes = new Set(['FILE', 'PASTE', 'API', 'UNKNOWN']);
  const fileName = normalizeText(raw.fileName) ? path.basename(normalizeText(raw.fileName)) : '';
  return {
    sourceType: allowedTypes.has(sourceType) ? sourceType : 'UNKNOWN',
    fileName,
  };
}

function serializeImportHistory(row) {
  return {
    id: row.id,
    classId: row.classroom_id,
    sourceType: row.source_type,
    fileName: row.file_name || '',
    rowCount: row.row_count,
    result: {
      add: row.add_count,
      update: row.update_count,
      skip: row.skip_count,
      conflict: row.conflict_count,
    },
    errors: row.error_count,
    warnings: row.warning_count,
    status: row.status,
    actor: row.actor_user_id
      ? {
          id: row.actor_user_id,
          username: row.actor_username || '',
          name: row.actor_name || '',
        }
      : null,
    createdAt: row.created_at,
  };
}

function validatePassword(password) {
  const normalized = normalizeText(password);
  return normalized.length >= 8 && normalized.length <= 128;
}

function generateInitialPassword() {
  return `Jx${randomToken(5)}`;
}

function insertAudit(actorUserId, action, target, detail) {
  db.prepare(
    `INSERT INTO audit_logs (actor_user_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(actorUserId, action, target, detail || '', now());
}

function getClassById(classroomId) {
  return db.prepare('SELECT * FROM classrooms WHERE id = ?').get(classroomId);
}

function formatClassLabel(classroom) {
  if (!classroom) return '';
  return `${classroom.grade || ''}${classroom.name || ''}`;
}

function serializeCurrentUser(user) {
  const school = db.prepare('SELECT id, name FROM schools WHERE id = ?').get(user.school_id);
  const classroom = user.classroom_id
    ? db.prepare('SELECT id, grade, name, capacity FROM classrooms WHERE id = ? AND school_id = ?').get(user.classroom_id, user.school_id)
    : null;
  const studentCount = classroom
    ? db.prepare('SELECT COUNT(*) as cnt FROM students WHERE classroom_id = ?').get(classroom.id).cnt
    : 0;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    classroomId: user.classroom_id || null,
    mustResetPassword: false,
    school: school ? { id: school.id, name: school.name } : null,
    classroom: classroom
      ? {
          id: classroom.id,
          grade: classroom.grade,
          name: classroom.name,
          label: formatClassLabel(classroom),
          capacity: classroom.capacity || 0,
          studentCount,
        }
      : null,
  };
}

function getNoticeById(noticeId) {
  return db.prepare('SELECT * FROM notices WHERE id = ?').get(noticeId);
}

function normalizeNoticeType(value) {
  const text = normalizeText(value || DEFAULT_NOTICE_TYPE);
  return (text || DEFAULT_NOTICE_TYPE).slice(0, 50);
}

function normalizeContentSource(value) {
  const source = normalizeText(value || 'TEXT').toUpperCase();
  return source === 'PDF' ? 'PDF' : 'TEXT';
}

function sanitizePdfFileName(value) {
  const baseName = path
    .basename(normalizeText(value || 'notice.pdf'))
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const parsed = path.parse(baseName || 'notice.pdf');
  const name = (parsed.name || 'notice').slice(0, 80);
  return `${name}.pdf`;
}

function isPdfBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 5 && buffer.slice(0, 5).toString('ascii') === '%PDF-';
}

function getNoticeAttachmentById(attachmentId) {
  if (!attachmentId) return null;
  return db.prepare('SELECT * FROM notice_attachments WHERE id = ?').get(attachmentId);
}

function getNoticeAttachment(notice) {
  if (!notice || !notice.attachment_id) return null;
  return getNoticeAttachmentById(notice.attachment_id);
}

function serializeNoticeAttachment(row, token) {
  if (!row) return null;
  return {
    id: row.id,
    fileName: row.file_name,
    fileSize: row.file_size || 0,
    mimeType: row.mime_type || 'application/pdf',
    sha256: row.sha256,
    createdAt: row.created_at,
    downloadUrl: token ? `/api/public/link/${encodeURIComponent(token)}/attachment` : null,
  };
}

function resolveAttachmentPath(row) {
  if (!row || !row.storage_path) return null;
  const absPath = path.resolve(UPLOAD_DIR, row.storage_path);
  const root = path.resolve(NOTICE_ATTACHMENT_DIR);
  if (absPath !== root && !absPath.startsWith(`${root}${path.sep}`)) return null;
  return absPath;
}

function validTokenForDemo(role) {
  if (process.env.NODE_ENV === 'production') return null;
  if (role === 'teacher') {
    return db
      .prepare(
        `SELECT u.*
           FROM users u
           JOIN schools sc ON sc.id = u.school_id
          WHERE u.role = ? AND u.enabled = 1 AND sc.enabled = 1
          LIMIT 1`
      )
      .get('teacher');
  }
  if (role === 'school_admin') {
    return db
      .prepare(
        `SELECT u.*
           FROM users u
           JOIN schools sc ON sc.id = u.school_id
          WHERE u.role = ? AND u.enabled = 1 AND sc.enabled = 1
          LIMIT 1`
      )
      .get('school_admin');
  }
  return null;
}

function getUserBySession(req) {
  const auth = req.headers.authorization || '';
  const raw = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const demoRole = normalizeText(req.headers['x-demo-user']);
  if (!raw && demoRole) {
    const user = validTokenForDemo(demoRole);
    if (!user) return null;
    user._isDemo = 1;
    return user;
  }
  if (!raw) return null;
  const row = db
    .prepare(
      `SELECT u.*
       FROM users u
       JOIN schools sc ON sc.id = u.school_id
       JOIN sessions s ON s.user_id = u.id
       WHERE s.token_hash = ? AND u.enabled = 1 AND sc.enabled = 1`
    )
    .get(sha(raw));
  const session = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(sha(raw));
  if (session && isExpired(session.expires_at)) return null;
  if (row) row._isDemo = 0;
  return row || null;
}

function getOpsBySession(req) {
  const auth = req.headers.authorization || '';
  const raw = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!raw) return null;
  const tokenHash = sha(raw);
  const row = db
    .prepare(
      `SELECT ou.*
         FROM ops_users ou
         JOIN ops_sessions os ON os.ops_user_id = ou.id
        WHERE os.token_hash = ? AND ou.enabled = 1`
    )
    .get(tokenHash);
  const session = db.prepare('SELECT expires_at FROM ops_sessions WHERE token_hash = ?').get(tokenHash);
  if (session && isExpired(session.expires_at)) return null;
  return row || null;
}

function requireRole(roles) {
  return (req, res, next) => {
    const user = getUserBySession(req);
    if (!user) {
      return res.status(401).json({
        code: 'FORBIDDEN',
        message: '请先登录或设置 x-demo-user 头（仅本地开发）',
      });
    }
    if (roles.length > 0 && !roles.includes(user.role)) {
      return res.status(403).json({ code: 'FORBIDDEN', message: '权限不足' });
    }
    req.user = user;
    next();
  };
}

function requireOps(req, res, next) {
  const user = getOpsBySession(req);
  if (!user) {
    return res.status(401).json({ code: 'FORBIDDEN', message: '请先登录运维后台' });
  }
  req.opsUser = user;
  next();
}

function requireTeacherManageClass(req, res, next) {
  const classId = Number(req.params.classId || req.body.classroomId);
  if (!classId) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '缺少班级参数' });
  }
  if (req.user.role === 'school_admin') {
    return next();
  }
  const cls = getClassById(classId);
  if (!cls) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '班级不存在' });
  if (req.user.classroom_id !== cls.id) {
    return res.status(403).json({ code: 'FORBIDDEN', message: '只能操作本人班级' });
  }
  next();
}

function getAccessToken(token, purpose) {
  const tokenHash = sha(token);
  const record = db
    .prepare(
      `SELECT * FROM access_tokens
       WHERE token_hash = ? AND purpose = ? AND revoked_at IS NULL`
    )
    .get(tokenHash, purpose);
  if (!record || isExpired(record.expires_at)) return null;
  return record;
}

function getAnyAccessToken(token, purposes) {
  for (const purpose of purposes) {
    const record = getAccessToken(token, purpose);
    if (record) return record;
  }
  return null;
}

function createAccessToken(scope) {
  const raw = randomToken(18);
  const tokenHash = sha(raw);
  const expiresAt =
    scope.expiresAt instanceof Date
      ? scope.expiresAt.toISOString()
      : scope.expiresAt === null
      ? null
      : scope.expiresAt;
  db.prepare(
    `INSERT INTO access_tokens (school_id, classroom_id, notice_id, purpose, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    scope.schoolId,
    scope.classroomId,
    scope.noticeId || null,
    scope.purpose,
    tokenHash,
    expiresAt,
    now()
  );
  return raw;
}

function getAccessTokenByRaw(token) {
  return db.prepare('SELECT * FROM access_tokens WHERE token_hash = ?').get(sha(token));
}

function revokeAccessTokens({ schoolId, classroomId, noticeId, purpose }) {
  db.prepare(
    `UPDATE access_tokens
       SET revoked_at = ?
     WHERE school_id = ? AND classroom_id = ? AND purpose = ?
       AND ( ? IS NULL OR notice_id = ? )
       AND revoked_at IS NULL`
  ).run(now(), schoolId, classroomId, purpose, noticeId || null, noticeId || null);
}

function ensureNoticeDelivery(noticeId, classroomId) {
  db.prepare(
    `INSERT OR IGNORE INTO notice_deliveries (notice_id, classroom_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`
  ).run(noticeId, classroomId, now(), now());
}

function getNoticeDelivery(noticeId, classroomId) {
  return db
    .prepare(
      `SELECT d.*, at.expires_at as token_expires_at, at.revoked_at as token_revoked_at, at.created_at as token_created_at
         FROM notice_deliveries d
         LEFT JOIN access_tokens at ON at.id = d.sign_access_token_id
        WHERE d.notice_id = ? AND d.classroom_id = ?`
    )
    .get(noticeId, classroomId);
}

function serializeDelivery(row) {
  if (!row) return null;
  const tokenStatus = row.sign_access_token_id
    ? row.token_revoked_at
      ? 'REVOKED'
      : isExpired(row.token_expires_at)
      ? 'EXPIRED'
      : 'ACTIVE'
    : 'MISSING';
  return {
    noticeId: row.notice_id,
    classroomId: row.classroom_id,
    forwardStatus: row.forward_status || 'PENDING',
    forwardedAt: row.forwarded_at || null,
    forwardedBy: row.forwarded_by || null,
    reminderCount: row.reminder_count || 0,
    remindedAt: row.reminded_at || null,
    remindedBy: row.reminded_by || null,
    tokenStatus,
    tokenCreatedAt: row.token_created_at || null,
    tokenExpiresAt: row.token_expires_at || null,
    tokenRevokedAt: row.token_revoked_at || null,
  };
}

function buildStudentProgress(noticeId, classroomId) {
  const notice = getNoticeById(noticeId);
  if (!notice) return [];
  const rows = db
    .prepare(
      `SELECT s.id as student_id, s.student_name, s.student_no
         FROM students s
        WHERE s.classroom_id = ?`
    )
    .all(classroomId);

  const dueAt = new Date(notice.due_at);
  return rows.map((student) => {
    const task = db
      .prepare(`SELECT id, status, signed_at FROM sign_tasks WHERE notice_id = ? AND student_id = ?`)
      .get(noticeId, student.student_id);
    const taskStatus = task ? task.status : 'MISSING_TASK';
    const signExceptionCount = task
      ? db
          .prepare(`SELECT COUNT(*) as cnt FROM sign_anomalies WHERE sign_task_id = ? AND status = 'PENDING'`)
          .get(task.id).cnt
      : 0;
    const validBinding = db
      .prepare(`SELECT COUNT(*) as cnt FROM parent_bindings WHERE student_id = ? AND status='VALID'`)
      .get(student.student_id).cnt;
    const pendingBinding = db
      .prepare(`SELECT COUNT(*) as cnt FROM parent_bindings WHERE student_id = ? AND status='PENDING_REVIEW'`)
      .get(student.student_id).cnt;
    const signRows = task
      ? db
          .prepare(
            `SELECT p.id, p.record_no, p.signed_at, pb.guardian_name, pb.relation, p.ip_address, p.user_agent
               FROM sign_records p
               JOIN parent_bindings pb ON pb.id = p.parent_binding_id
              WHERE p.sign_task_id = ?
              ORDER BY datetime(p.signed_at) ASC`
          )
          .all(task.id)
      : [];
    const reminderInfo = db
      .prepare(
        `SELECT COUNT(*) as cnt, MAX(created_at) as last_at
           FROM reminder_logs
          WHERE notice_id = ? AND classroom_id = ?
            AND (student_id = ? OR student_id IS NULL)`
      )
      .get(noticeId, classroomId, student.student_id);
    const signCount = signRows.length;
    const latestSign = signRows[0] ? signRows[0] : null;
    const nowAt = new Date();
    const overdue = task && nowAt > dueAt && signCount === 0;

    const bindingStatus =
      validBinding > 0 && pendingBinding > 0
        ? 'HAS_EXCEPTION'
        : validBinding > 0
        ? 'BOUND'
        : pendingBinding > 0
        ? 'PENDING'
        : 'UNBOUND';

    const signStatus = taskStatus === 'SIGNED'
      ? signExceptionCount > 0
        ? 'EXCEPTION'
        : 'SIGNED'
      : overdue
      ? 'OVERDUE_PENDING'
      : bindingStatus === 'UNBOUND'
      ? 'NO_BINDING'
      : signCount > 0
      ? 'PARTIAL'
      : 'PENDING';

    return {
      studentId: student.student_id,
      studentNo: student.student_no,
      studentName: student.student_name,
      bindingStatus,
      signStatus,
      signExceptionCount,
      signCount,
      latestSign,
      taskId: task ? task.id : null,
      taskStatus,
      signed: signCount > 0,
      overdue,
      reminderCount: reminderInfo ? reminderInfo.cnt : 0,
      lastReminderAt: reminderInfo ? reminderInfo.last_at : null,
    };
  });
}

function createNoticeTasks(noticeId, scopeClassIds = []) {
  const placeholders = scopeClassIds.map(() => '?').join(',');
  const students = db
    .prepare(
      `SELECT s.id
         FROM students s
        WHERE s.classroom_id IN (${placeholders || '0'})`
    )
    .all(...scopeClassIds);

  const addTask = db.prepare(
    `INSERT OR IGNORE INTO sign_tasks (notice_id, student_id, status, created_at) VALUES (?, ?, 'PENDING', ?)`
  );
  const createTx = db.transaction((list) => {
    for (const row of list) {
      addTask.run(noticeId, row.id, now());
    }
  });
  createTx(students);
}

function normalizeScopeClassIds(v) {
  if (!Array.isArray(v)) return [];
  return Array.from(new Set(v.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0))).sort((a, b) => a - b);
}

function writeSignatureFile(bindingType, raw, bindingId) {
  const payload = typeof raw === 'string' ? raw.trim() : '';
  if (!payload) return null;
  const match = payload.match(/^data:(.+?);base64,(.+)$/);
  const extByMime = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  const fileName = `${bindingType}-${bindingId}-${Date.now()}${match ? extByMime[match[1]] || '.bin' : '.txt'}`;
  const filePath = path.join(UPLOAD_DIR, fileName);
  if (match) {
    fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
  } else {
    fs.writeFileSync(filePath, payload, 'utf8');
  }
  return filePath;
}

function readSignatureDataUrl(filePath) {
  const target = normalizeText(filePath);
  if (!target || !fs.existsSync(target)) return null;
  const ext = path.extname(target).toLowerCase();
  const mimeByExt = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  const mime = mimeByExt[ext];
  if (!mime) return null;
  const stat = fs.statSync(target);
  if (stat.size > 2 * 1024 * 1024) return null;
  return `data:${mime};base64,${fs.readFileSync(target).toString('base64')}`;
}

function createBindingAnomaly(access, form, reason, detail, req) {
  const insert = db.prepare(
    `INSERT INTO binding_anomalies
       (school_id, classroom_id, notice_id, submitted_student_name, submitted_student_no,
        guardian_name, relation, phone, status, reason, detail, signature_path,
        ip_address, user_agent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, '', ?, ?, ?, ?)`
  );
  const result = insert.run(
    access.school_id,
    access.classroom_id,
    access.notice_id || null,
    form.studentName,
    form.studentNo,
    form.guardianName,
    form.relation,
    form.phone,
    reason,
    detail,
    req.ip,
    req.get('user-agent') || '',
    now(),
    now()
  );
  const anomalyId = result.lastInsertRowid;
  const signaturePath = writeSignatureFile('binding-anomaly', form.signatureData, anomalyId);
  if (signaturePath) {
    db.prepare('UPDATE binding_anomalies SET signature_path = ? WHERE id = ?').run(signaturePath, anomalyId);
  }
  insertAudit(null, 'binding_anomaly', `class=${access.classroom_id}`, `anomaly=${anomalyId};reason=${reason}`);
  return anomalyId;
}

function generateNoticeExportRows(noticeId, classroomId) {
  const notice = getNoticeById(noticeId);
  const classInfo = getClassById(classroomId);
  if (!notice || !classInfo) return [];

  const rows = db
    .prepare(
      `SELECT s.id as student_id, s.student_name, s.student_no,
              c.name as classroom_name, c.grade, sc.name as school_name
         FROM students s
         JOIN classrooms c ON c.id = s.classroom_id
         JOIN schools sc ON sc.id = c.school_id
        WHERE s.classroom_id = ?`
    )
    .all(classroomId);

  return rows.map((student) => {
    const validBinding = db
      .prepare(`SELECT COUNT(*) as cnt FROM parent_bindings WHERE student_id = ? AND status='VALID'`)
      .get(student.student_id).cnt;
    const pendingBinding = db
      .prepare(`SELECT COUNT(*) as cnt FROM parent_bindings WHERE student_id = ? AND status='PENDING_REVIEW'`)
      .get(student.student_id).cnt;
    const task = db
      .prepare(`SELECT id, status FROM sign_tasks WHERE notice_id = ? AND student_id = ?`)
      .get(noticeId, student.student_id);
    const signRows = task
      ? db
          .prepare(
            `SELECT sr.id, sr.record_no, sr.signed_at, pb.guardian_name, pb.relation, sr.ip_address, sr.user_agent
               FROM sign_records sr
               JOIN parent_bindings pb ON pb.id = sr.parent_binding_id
              WHERE sr.sign_task_id = ?
              ORDER BY datetime(sr.signed_at) ASC`
          )
          .all(task.id)
      : [];
    const firstSign = signRows[0] || null;
    const dueAt = new Date(notice.due_at);
    const hasSigned = signRows.length > 0;
    const signExceptionCount = task
      ? db
          .prepare(`SELECT COUNT(*) as cnt FROM sign_anomalies WHERE sign_task_id = ? AND status = 'PENDING'`)
          .get(task.id).cnt
      : 0;
    const isOverdue = !hasSigned && dueAt.getTime() < Date.now();
    return {
      school: student.school_name,
      grade: student.grade,
      classroom: student.classroom_name,
      studentNo: student.student_no,
      studentName: student.student_name,
      validGuardianCount: validBinding,
      pendingBindingCount: pendingBinding,
      signStatus: task ? task.status : 'NO_TASK',
      firstSignGuardianName: firstSign ? firstSign.guardian_name : '',
      firstSignRelation: firstSign ? firstSign.relation : '',
      firstSignTime: firstSign ? firstSign.signed_at : '',
      isOverdue,
      signCount: signRows.length,
      signExceptionCount,
      ip: firstSign ? firstSign.ip_address : '',
      userAgent: firstSign ? firstSign.user_agent : '',
      anomaly: pendingBinding > 0 ? 'binding_pending' : signExceptionCount > 0 ? 'sign_exception' : '',
      taskId: task ? task.id : '',
    };
  });
}

function createExport(task) {
  const id = randomToken(16);
  db.prepare(
    `INSERT INTO export_tasks (id, actor_user_id, type, notice_id, class_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'RUNNING', ?)`
  ).run(id, task.actorUserId, task.type, task.noticeId || null, task.classroomId || null, now());
  return id;
}

function updateExportStatus(id, status, extra = {}) {
  db.prepare(
    `UPDATE export_tasks
        SET status = ?, file_path = ?, error = ?, finished_at = ?
      WHERE id = ?`
  ).run(status, extra.filePath || null, extra.error || null, status === 'RUNNING' ? null : now(), id);
}

function getTaskScope(taskId) {
  return db
    .prepare(
      `SELECT st.id as task_id, st.notice_id, s.classroom_id, c.school_id
         FROM sign_tasks st
         JOIN students s ON s.id = st.student_id
         JOIN classrooms c ON c.id = s.classroom_id
        WHERE st.id = ?`
    )
    .get(taskId);
}

function assertNoticeAndClassScope(user, noticeId, classroomId) {
  const notice = noticeId ? getNoticeById(noticeId) : null;
  const classInfo = classroomId ? getClassById(classroomId) : null;
  if (noticeId && !notice) {
    return { ok: false, status: 404, message: '通知不存在' };
  }
  if (classroomId && !classInfo) {
    return { ok: false, status: 404, message: '班级不存在' };
  }
  if (notice && notice.school_id !== user.school_id) {
    return { ok: false, status: 403, message: '不能访问非本校通知' };
  }
  if (classInfo && classInfo.school_id !== user.school_id) {
    return { ok: false, status: 403, message: '不能访问非本校班级' };
  }
  if (noticeId && classroomId) {
    const inScope = db
      .prepare('SELECT 1 FROM notice_scope_classes WHERE notice_id = ? AND classroom_id = ?')
      .get(noticeId, classroomId);
    if (!inScope) {
      return { ok: false, status: 403, message: '通知未覆盖该班级' };
    }
  }
  if (user.role === 'teacher' && classroomId && classroomId !== user.classroom_id) {
    return { ok: false, status: 403, message: '只能访问本人班级数据' };
  }
  return { ok: true };
}

function canAccessExportTask(user, task) {
  if (!task) return false;
  if (user.role === 'teacher') {
    return task.class_id === user.classroom_id;
  }
  if (user.role === 'school_admin') {
    if (task.class_id) {
      const classInfo = getClassById(task.class_id);
      return !!classInfo && classInfo.school_id === user.school_id;
    }
    if (task.notice_id) {
      const notice = getNoticeById(task.notice_id);
      return !!notice && notice.school_id === user.school_id;
    }
    return task.actor_user_id === user.id;
  }
  return false;
}

function csvEscape(v) {
  const text = v === null || v === undefined ? '' : String(v);
  if (text.includes(',') || text.includes('\n') || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(filePath, dataRows) {
  if (!dataRows.length) {
    fs.writeFileSync(filePath, '');
    return;
  }
  const headers = Object.keys(dataRows[0]);
  const lines = [headers.join(',')];
  for (const row of dataRows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function xmlEscape(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function writeExcelXml(filePath, dataRows, sheetName = 'Sheet1') {
  const headers = dataRows.length ? Object.keys(dataRows[0]) : ['学生姓名', '班内序号'];
  const rows = [
    headers,
    ...dataRows.map((row) => headers.map((header) => row[header])),
  ];
  const rowXml = rows
    .map((row) => {
      const cells = row
        .map((value) => `<Cell><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`)
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${xmlEscape(sheetName)}">
  <Table>${rowXml}</Table>
 </Worksheet>
</Workbook>`;
  fs.writeFileSync(filePath, xml, 'utf8');
}

function formatPdfDate(value) {
  if (!value) return '未填写';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(/\//g, '-');
}

function pdfValue(value, fallback = '未填写') {
  const text = normalizeText(value);
  return text || fallback;
}

function writeStudentPdf(filePath, notice, classInfo, studentRow, signRows) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    applyPdfFont(doc);
    const stream = fs.createWriteStream(filePath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = doc.page.height - doc.page.margins.bottom;
    const grade = pdfValue(classInfo.grade);
    const className = pdfValue(classInfo.className || classInfo.class_name || classInfo.name);
    const noticeTitle = pdfValue(notice.title);
    const contentSource = notice.content_source || 'TEXT';
    const body = normalizeLongText(notice.body || '');
    const attachment = getNoticeAttachment(notice);

    const ensureSpace = (height) => {
      if (doc.y + height > bottom) doc.addPage();
    };
    const line = () => {
      const y = doc.y;
      doc.save().strokeColor('#d8dedb').lineWidth(1).moveTo(left, y).lineTo(left + width, y).stroke().restore();
      doc.moveDown(0.8);
    };
    const section = (title) => {
      doc.moveDown(0.8);
      ensureSpace(42);
      doc.fontSize(15).fillColor('#111827').text(title);
      doc.moveDown(0.35);
      line();
    };
    const row = (label, value) => {
      doc.fontSize(11.5).fillColor('#4b5563').text(`${label}：`, { continued: true });
      doc.fillColor('#111827').text(pdfValue(value));
    };

    doc.fontSize(22).fillColor('#111827').text('家校签收通 · 签收归档', { align: 'center' });
    doc.moveDown(1);

    section('签收事项');
    row('学校', notice.school_name || 'N/A');
    row('年级', grade);
    row('班级', className);
    row('签收事项', noticeTitle);
    row('事项类型', notice.notice_type || DEFAULT_NOTICE_TYPE);
    row('截止时间', formatPdfDate(notice.due_at));
    if (contentSource === 'PDF' && attachment) {
      row('通知原件', `${attachment.file_name}（附件原件由系统保存）`);
    }
    if (body) {
      doc.moveDown(0.5);
      doc.fontSize(11.5).fillColor('#4b5563').text(`${contentSource === 'PDF' ? '签收说明' : '通知摘要'}：`);
      doc.moveDown(0.15);
      doc.fontSize(11).fillColor('#111827').text(body, { lineGap: 3 });
    }

    section('学生信息');
    row('学生姓名', studentRow.studentName);
    row('班内序号', studentRow.studentNo);
    row('所在年级', grade);
    row('所在班级', className);

    section('家长签收信息');
    doc.fontSize(11.5).fillColor('#111827').text(`有效签收：${signRows.length} 条`);

    for (const item of signRows) {
      ensureSpace(220);
      doc.moveDown(0.9);
      doc.save().roundedRect(left, doc.y, width, 190, 6).strokeColor('#d8dedb').lineWidth(1).stroke().restore();
      const boxTop = doc.y;
      doc.x = left + 14;
      doc.y = boxTop + 12;
      row('家长姓名', item.guardian_name);
      row('监护关系', item.relation);
      row('联系电话', item.phone || '未填写');
      row('签收时间', formatPdfDate(item.signed_at));
      row('签收状态', item.is_overdue || item.is_late ? '逾期签收' : '按时签收');
      doc.moveDown(0.35);
      doc.fontSize(11.5).fillColor('#4b5563').text('家长签字：');
      const signatureX = left + 92;
      const signatureY = boxTop + 104;
      const signatureWidth = Math.min(310, width - 112);
      const signatureHeight = 72;
      doc.save().rect(signatureX, signatureY, signatureWidth, signatureHeight).strokeColor('#e5e7eb').lineWidth(1).stroke().restore();
      if (item.signature_path && fs.existsSync(item.signature_path) && /\.(png|jpe?g)$/i.test(item.signature_path)) {
        try {
          if (canEmbedSignatureImage(item.signature_path)) {
            doc.image(item.signature_path, signatureX + 8, signatureY + 8, { fit: [signatureWidth - 16, signatureHeight - 16] });
          } else {
            doc.fontSize(10).fillColor('#6b7280').text('签名图片无法嵌入，请联系班主任核对', signatureX + 12, signatureY + 26);
          }
        } catch (err) {
          doc.fontSize(10).fillColor('#6b7280').text('签名图片无法嵌入，请联系班主任核对', signatureX + 12, signatureY + 26);
        }
      } else {
        doc.fontSize(10).fillColor('#6b7280').text('未找到签名图片', signatureX + 12, signatureY + 26);
      }
      doc.x = left;
      doc.y = boxTop + 200;
    }
    doc.moveDown(0.4);
    doc.fontSize(9.5).fillColor('#6b7280').text(`本页由系统根据学校后台签收记录生成，生成时间：${formatPdfDate(now())}`, {
      align: 'center',
    });
    doc.end();
  });
}

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((col) => col.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function buildSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS school_grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      entry_year TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(school_id, name),
      FOREIGN KEY (school_id) REFERENCES schools(id)
    );

    CREATE TABLE IF NOT EXISTS classrooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      grade TEXT NOT NULL,
      name TEXT NOT NULL,
      capacity INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (school_id) REFERENCES schools(id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('school_admin','teacher')),
      name TEXT NOT NULL,
      classroom_id INTEGER,
      must_reset_password INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (school_id) REFERENCES schools(id),
      FOREIGN KEY (classroom_id) REFERENCES classrooms(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS ops_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ops_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ops_user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (ops_user_id) REFERENCES ops_users(id)
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classroom_id INTEGER NOT NULL,
      student_name TEXT NOT NULL,
      student_no TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (classroom_id) REFERENCES classrooms(id),
      UNIQUE(classroom_id, student_no)
    );

    CREATE TABLE IF NOT EXISTS student_import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      classroom_id INTEGER NOT NULL,
      actor_user_id INTEGER,
      source_type TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(source_type IN ('FILE','PASTE','API','UNKNOWN')),
      file_name TEXT,
      row_count INTEGER DEFAULT 0,
      add_count INTEGER DEFAULT 0,
      update_count INTEGER DEFAULT 0,
      skip_count INTEGER DEFAULT 0,
      conflict_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      warning_count INTEGER DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('SUCCEEDED','FAILED')),
      detail TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (school_id) REFERENCES schools(id),
      FOREIGN KEY (classroom_id) REFERENCES classrooms(id),
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      notice_type TEXT NOT NULL DEFAULT '安全承诺书',
      content_source TEXT NOT NULL DEFAULT 'TEXT',
      attachment_id INTEGER,
      status TEXT NOT NULL CHECK(status IN ('DRAFT','PUBLISHED')),
      version INTEGER DEFAULT 1,
      due_at TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'CLASS',
      require_signature INTEGER DEFAULT 1,
      allow_multi_guardian INTEGER DEFAULT 1,
      published_at TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (school_id) REFERENCES schools(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notice_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      uploader_user_id INTEGER NOT NULL,
      notice_id INTEGER,
      file_name TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (school_id) REFERENCES schools(id),
      FOREIGN KEY (uploader_user_id) REFERENCES users(id),
      FOREIGN KEY (notice_id) REFERENCES notices(id)
    );

    CREATE TABLE IF NOT EXISTS access_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      classroom_id INTEGER NOT NULL,
      notice_id INTEGER,
      purpose TEXT NOT NULL CHECK(purpose IN ('BINDING','SIGN')),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (school_id) REFERENCES schools(id),
      FOREIGN KEY (classroom_id) REFERENCES classrooms(id),
      FOREIGN KEY (notice_id) REFERENCES notices(id)
    );

    CREATE TABLE IF NOT EXISTS notice_scope_classes (
      notice_id INTEGER NOT NULL,
      classroom_id INTEGER NOT NULL,
      PRIMARY KEY (notice_id, classroom_id),
      FOREIGN KEY (notice_id) REFERENCES notices(id),
      FOREIGN KEY (classroom_id) REFERENCES classrooms(id)
    );

    CREATE TABLE IF NOT EXISTS notice_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notice_id INTEGER NOT NULL,
      classroom_id INTEGER NOT NULL,
      sign_access_token_id INTEGER,
      forward_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(forward_status IN ('PENDING','FORWARDED')),
      forwarded_at TEXT,
      forwarded_by INTEGER,
      reminded_at TEXT,
      reminded_by INTEGER,
      reminder_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(notice_id, classroom_id),
      FOREIGN KEY (notice_id) REFERENCES notices(id),
      FOREIGN KEY (classroom_id) REFERENCES classrooms(id),
      FOREIGN KEY (sign_access_token_id) REFERENCES access_tokens(id),
      FOREIGN KEY (forwarded_by) REFERENCES users(id),
      FOREIGN KEY (reminded_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sign_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notice_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING','SIGNED')),
      signed_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (notice_id, student_id),
      FOREIGN KEY (notice_id) REFERENCES notices(id),
      FOREIGN KEY (student_id) REFERENCES students(id)
    );

    CREATE TABLE IF NOT EXISTS parent_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      guardian_name TEXT NOT NULL,
      relation TEXT NOT NULL,
      phone TEXT,
      status TEXT NOT NULL CHECK(status IN ('VALID','PENDING_REVIEW','REJECTED','REVOKED')),
      signature_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      privacy_notice_version TEXT DEFAULT 'v2026-06-01',
      FOREIGN KEY (student_id) REFERENCES students(id)
    );

    CREATE TABLE IF NOT EXISTS binding_anomalies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL,
      classroom_id INTEGER NOT NULL,
      notice_id INTEGER,
      submitted_student_name TEXT NOT NULL,
      submitted_student_no TEXT NOT NULL,
      guardian_name TEXT NOT NULL,
      relation TEXT NOT NULL,
      phone TEXT,
      status TEXT NOT NULL CHECK(status IN ('PENDING','RESOLVED_APPROVE','RESOLVED_REJECT')),
      reason TEXT,
      detail TEXT,
      signature_path TEXT,
      ip_address TEXT,
      user_agent TEXT,
      resolved_by INTEGER,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (school_id) REFERENCES schools(id),
      FOREIGN KEY (classroom_id) REFERENCES classrooms(id),
      FOREIGN KEY (notice_id) REFERENCES notices(id),
      FOREIGN KEY (resolved_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sign_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sign_task_id INTEGER NOT NULL,
      parent_binding_id INTEGER NOT NULL,
      record_no TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      is_late INTEGER DEFAULT 0,
      ip_address TEXT,
      user_agent TEXT,
      signature_path TEXT,
      detail TEXT,
      FOREIGN KEY (sign_task_id) REFERENCES sign_tasks(id),
      FOREIGN KEY (parent_binding_id) REFERENCES parent_bindings(id)
    );

    CREATE TABLE IF NOT EXISTS sign_anomalies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sign_task_id INTEGER NOT NULL,
      notice_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      parent_binding_id INTEGER,
      anomaly_type TEXT NOT NULL CHECK(anomaly_type IN ('REPEAT_SIGN','INFO_CONFLICT','WRONG_STUDENT','OTHER')),
      status TEXT NOT NULL CHECK(status IN ('PENDING','RESOLVED_APPROVE','RESOLVED_REJECT')),
      reason TEXT,
      detail TEXT,
      signature_path TEXT,
      ip_address TEXT,
      user_agent TEXT,
      resolved_by INTEGER,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (sign_task_id, parent_binding_id, anomaly_type, status),
      FOREIGN KEY (sign_task_id) REFERENCES sign_tasks(id),
      FOREIGN KEY (notice_id) REFERENCES notices(id),
      FOREIGN KEY (student_id) REFERENCES students(id),
      FOREIGN KEY (parent_binding_id) REFERENCES parent_bindings(id),
      FOREIGN KEY (resolved_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS reminder_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notice_id INTEGER NOT NULL,
      classroom_id INTEGER NOT NULL,
      student_id INTEGER,
      actor_user_id INTEGER,
      remark TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (notice_id) REFERENCES notices(id),
      FOREIGN KEY (classroom_id) REFERENCES classrooms(id),
      FOREIGN KEY (student_id) REFERENCES students(id),
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS export_tasks (
      id TEXT PRIMARY KEY,
      actor_user_id INTEGER,
      type TEXT NOT NULL CHECK(type IN ('excel','student_pdf','class_zip')),
      notice_id INTEGER,
      class_id INTEGER,
      status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
      file_path TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
    );
  `);
  ensureColumn('schools', 'enabled', 'INTEGER DEFAULT 1');
  ensureColumn('notices', 'notice_type', "TEXT DEFAULT '安全承诺书'");
  ensureColumn('notices', 'content_source', "TEXT DEFAULT 'TEXT'");
  ensureColumn('notices', 'attachment_id', 'INTEGER');
  db.prepare('UPDATE notices SET notice_type = ? WHERE notice_type IS NULL OR notice_type = ?').run(DEFAULT_NOTICE_TYPE, '');
  db.prepare("UPDATE notices SET content_source = 'TEXT' WHERE content_source IS NULL OR content_source = ''").run();
  db.prepare(
    `INSERT OR IGNORE INTO notice_deliveries (notice_id, classroom_id, created_at, updated_at)
     SELECT notice_id, classroom_id, ?, ? FROM notice_scope_classes`
  ).run(now(), now());
  db.prepare(
    `INSERT OR IGNORE INTO school_grades (school_id, name, entry_year, created_at)
     SELECT DISTINCT school_id, grade, NULL, ? FROM classrooms`
  ).run(now());
  db.prepare('UPDATE users SET must_reset_password = 0 WHERE must_reset_password != 0').run();
}

function seed() {
  if (process.env.JIAXIAO_SEED_DEMO !== '1') return;
  const cnt = db.prepare('SELECT COUNT(*) as cnt FROM schools').get().cnt;
  if (cnt > 0) return;

  const school = db.prepare('INSERT INTO schools (name, created_at) VALUES (?, ?)').run(
    '示例中学',
    now()
  );
  const schoolId = school.lastInsertRowid;
  const classId = db
    .prepare('INSERT INTO classrooms (school_id, grade, name, capacity, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(schoolId, '五', '（1）班', 40, now()).lastInsertRowid;
  db.prepare('INSERT OR IGNORE INTO school_grades (school_id, name, entry_year, created_at) VALUES (?, ?, ?, ?)').run(
    schoolId,
    '五',
    '',
    now()
  );

  const adminPwd = bcrypt.hashSync('admin123', 10);
  const teacherPwd = bcrypt.hashSync('teacher123', 10);
  const adminId = db
    .prepare(
      `INSERT INTO users (school_id, username, password_hash, role, name, classroom_id, must_reset_password, created_at)
       VALUES (?, ?, ?, 'school_admin', ?, NULL, 0, ?)`
    )
    .run(schoolId, 'school_admin_demo', adminPwd, '学校管理员', now()).lastInsertRowid;
  const teacherId = db
    .prepare(
      `INSERT INTO users (school_id, username, password_hash, role, name, classroom_id, must_reset_password, created_at)
       VALUES (?, ?, ?, 'teacher', ?, ?, 0, ?)`
    )
    .run(schoolId, 'teacher_demo', teacherPwd, '班主任张老师', classId, now()).lastInsertRowid;

  const students = [
    ['李雷', '01'],
    ['韩梅梅', '02'],
    ['周杰', '03'],
    ['王宇', '04'],
    ['张明', '05'],
  ];
  const insertStudent = db.prepare(
    `INSERT INTO students (classroom_id, student_name, student_no, created_at) VALUES (?, ?, ?, ?)`
  );
  for (const [name, no] of students) {
    insertStudent.run(classId, name, no, now());
  }

  const dueAt = new Date();
  dueAt.setDate(dueAt.getDate() + 3);
  const noticeId = db
    .prepare(
      `INSERT INTO notices
         (school_id, title, body, status, version, due_at, scope, require_signature, allow_multi_guardian, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'PUBLISHED', 1, ?, 'CLASS', 1, 1, ?, ?, ?)`
    )
    .run(schoolId, '2026 年暑假安全承诺书', '请按要求签署。', dueAt.toISOString(), adminId, now(), now()).lastInsertRowid;
  db.prepare('INSERT INTO notice_scope_classes (notice_id, classroom_id) VALUES (?, ?)').run(noticeId, classId);
  ensureNoticeDelivery(noticeId, classId);

  const studentsNow = db.prepare('SELECT id FROM students WHERE classroom_id = ?').all(classId);
  const taskStmt = db.prepare(
    `INSERT OR IGNORE INTO sign_tasks (notice_id, student_id, status, created_at) VALUES (?, ?, 'PENDING', ?)`
  );
  for (const row of studentsNow) {
    taskStmt.run(noticeId, row.id, now());
  }

  insertAudit(adminId, 'bootstrap', 'system_seed', `school=${schoolId},class=${classId},notice=${noticeId}`);
}

function seedOps() {
  const defaultUser = db.prepare('SELECT id FROM ops_users WHERE username = ?').get(OPS_ADMIN_USERNAME);
  if (defaultUser) {
    db.prepare('UPDATE ops_users SET name = ?, enabled = 1 WHERE id = ?').run('平台运维', defaultUser.id);
    return;
  }
  const cnt = db.prepare('SELECT COUNT(*) as cnt FROM ops_users').get().cnt;
  if (cnt > 0) return;
  const initialPassword = OPS_ADMIN_PASSWORD || generateInitialPassword();
  if (!validatePassword(initialPassword)) {
    throw new Error('OPS_ADMIN_PASSWORD 长度必须为 8 到 128 位');
  }
  const defaultPasswordHash = bcrypt.hashSync(initialPassword, 10);
  db.prepare(
    `INSERT INTO ops_users (username, password_hash, name, enabled, created_at)
     VALUES (?, ?, ?, 1, ?)`
  ).run(OPS_ADMIN_USERNAME, defaultPasswordHash, '平台运维', now());
  if (OPS_ADMIN_PASSWORD) {
    console.log(`已创建平台运维账号：${OPS_ADMIN_USERNAME}，密码来自 OPS_ADMIN_PASSWORD`);
  } else {
    console.warn(`已创建平台运维账号：${OPS_ADMIN_USERNAME}，一次性初始密码：${initialPassword}`);
  }
}

buildSchema();
seed();
seedOps();

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: now() });
});

app.post('/api/ops/login', (req, res) => {
  const username = normalizeText(req.body.username);
  const password = normalizeText(req.body.password);
  if (!username || !password) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '缺少用户名或密码' });
  }
  const user = db.prepare('SELECT * FROM ops_users WHERE username = ? AND enabled = 1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    insertAudit(null, 'ops_login_failed', `username=${username}`, `ip=${req.ip}`);
    return res.status(401).json({ code: 'FORBIDDEN', message: '用户名或密码错误' });
  }
  const token = randomToken(24);
  const expire = new Date();
  expire.setHours(expire.getHours() + 12);
  db.prepare(
    `INSERT INTO ops_sessions (ops_user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`
  ).run(user.id, sha(token), expire.toISOString(), now());
  insertAudit(null, 'ops_login_success', `ops=${user.id}`, `ip=${req.ip}`);
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: 'platform_admin',
    },
  });
});

app.get('/api/ops/schools', requireOps, (req, res) => {
  const schools = db
    .prepare('SELECT id, name, enabled, created_at FROM schools ORDER BY datetime(created_at) DESC')
    .all()
    .map((school) => {
      const firstAdmin = db
        .prepare(
          `SELECT id, username, name, enabled, created_at
             FROM users
            WHERE school_id = ? AND role = 'school_admin'
            ORDER BY id ASC
            LIMIT 1`
        )
        .get(school.id);
      return {
        id: school.id,
        name: school.name,
        enabled: !!school.enabled,
        createdAt: school.created_at,
        classCount: db.prepare('SELECT COUNT(*) as cnt FROM classrooms WHERE school_id = ?').get(school.id).cnt,
        teacherCount: db.prepare("SELECT COUNT(*) as cnt FROM users WHERE school_id = ? AND role = 'teacher'").get(school.id).cnt,
        firstAdmin: firstAdmin
          ? {
              id: firstAdmin.id,
              username: firstAdmin.username,
              name: firstAdmin.name,
              enabled: !!firstAdmin.enabled,
              createdAt: firstAdmin.created_at,
            }
          : null,
      };
    });
  res.json({ schools });
});

app.post('/api/ops/schools', requireOps, (req, res) => {
  const schoolName = normalizeText(req.body.schoolName || req.body.name || '待完善学校');
  const adminUsername = normalizeText(req.body.adminUsername);
  const adminName = normalizeText(req.body.adminName || '学校管理员');
  const initialPassword = normalizeText(req.body.initialPassword || generateInitialPassword());
  if (!adminUsername) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '首个学校管理员账号不能为空' });
  }
  if (!validatePassword(initialPassword)) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '初始密码至少 8 位' });
  }
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(adminUsername);
  if (exists) {
    return res.status(409).json({ code: 'VALIDATION_ERROR', message: '账号已存在' });
  }
  const tx = db.transaction(() => {
    const schoolId = db
      .prepare('INSERT INTO schools (name, enabled, created_at) VALUES (?, 1, ?)')
      .run(schoolName, now()).lastInsertRowid;
    const adminId = db
      .prepare(
        `INSERT INTO users (school_id, username, password_hash, role, name, classroom_id, must_reset_password, enabled, created_at)
         VALUES (?, ?, ?, 'school_admin', ?, NULL, 0, 1, ?)`
      )
      .run(schoolId, adminUsername, bcrypt.hashSync(initialPassword, 10), adminName, now()).lastInsertRowid;
    insertAudit(null, 'ops_school_create', `school=${schoolId}`, `admin=${adminUsername};ops=${req.opsUser.id}`);
    return { schoolId, adminId };
  });
  const result = tx();
  res.status(201).json({
    schoolId: result.schoolId,
    schoolName,
    firstAdmin: {
      id: result.adminId,
      username: adminUsername,
      name: adminName,
      initialPassword,
    },
  });
});

app.post('/api/ops/schools/:schoolId/reset-admin-password', requireOps, (req, res) => {
  const schoolId = Number(req.params.schoolId);
  const reason = normalizeText(req.body.reason);
  const newPassword = normalizeText(req.body.newPassword || generateInitialPassword());
  if (!reason) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '请填写重置原因' });
  }
  if (!validatePassword(newPassword)) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '新密码至少 8 位' });
  }
  const admin = db
    .prepare(
      `SELECT id, username, name
         FROM users
        WHERE school_id = ? AND role = 'school_admin'
        ORDER BY id ASC
        LIMIT 1`
    )
    .get(schoolId);
  if (!admin) {
    return res.status(404).json({ code: 'VALIDATION_ERROR', message: '学校管理员账号不存在' });
  }
  db.prepare('UPDATE users SET password_hash = ?, must_reset_password = 0, enabled = 1 WHERE id = ?').run(
    bcrypt.hashSync(newPassword, 10),
    admin.id
  );
  insertAudit(null, 'ops_admin_password_reset', `user=${admin.id}`, `reason=${reason};ops=${req.opsUser.id}`);
  res.json({
    schoolId,
    firstAdmin: {
      id: admin.id,
      username: admin.username,
      name: admin.name,
      initialPassword: newPassword,
    },
  });
});

app.patch('/api/ops/schools/:schoolId/status', requireOps, (req, res) => {
  const schoolId = Number(req.params.schoolId);
  const enabled = req.body.enabled;
  const reason = normalizeText(req.body.reason || (enabled ? '运维恢复学校空间。' : '运维停用学校空间。'));
  if (!Number.isInteger(schoolId) || schoolId <= 0) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '学校空间参数不合法' });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '请提交 enabled 布尔值' });
  }
  if (!enabled && !reason) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '停用学校空间需填写原因' });
  }
  const school = db.prepare('SELECT id, name, enabled FROM schools WHERE id = ?').get(schoolId);
  if (!school) {
    return res.status(404).json({ code: 'VALIDATION_ERROR', message: '学校空间不存在' });
  }
  db.prepare('UPDATE schools SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, schoolId);
  insertAudit(null, 'ops_school_status_update', `school=${schoolId}`, `enabled=${enabled ? 1 : 0};reason=${reason};ops=${req.opsUser.id}`);
  res.json({
    schoolId,
    schoolName: school.name,
    enabled,
  });
});

app.post('/api/login', (req, res) => {
  const username = normalizeText(req.body.username);
  const password = normalizeText(req.body.password);
  if (!username || !password) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '缺少用户名或密码' });
  }
  const user = db
    .prepare(
      `SELECT u.*
         FROM users u
         JOIN schools sc ON sc.id = u.school_id
        WHERE u.username = ? AND u.enabled = 1 AND sc.enabled = 1`
    )
    .get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    insertAudit(null, 'login_failed', `username=${username}`, `ip=${req.ip}`);
    return res.status(401).json({ code: 'FORBIDDEN', message: '用户名或密码错误' });
  }
  const token = randomToken(24);
  const tokenHash = sha(token);
  const expire = new Date();
  expire.setHours(expire.getHours() + 12);
  db.prepare(
    `INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`
  ).run(user.id, tokenHash, expire.toISOString(), now());

  insertAudit(user.id, 'login_success', `username=${username}`, `ip=${req.ip}`);
  res.json({
    token,
    user: serializeCurrentUser(user),
  });
});

app.get('/api/teacher/context', requireRole(['teacher']), (req, res) => {
  res.json({ user: serializeCurrentUser(req.user) });
});

app.post('/api/user/change-password', requireRole(['school_admin', 'teacher']), (req, res) => {
  const body = req.body || {};
  const oldPassword = body.oldPassword;
  const newPassword = body.newPassword;
  const confirmPassword = body.confirmPassword;

  if (!oldPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '请输入原密码、 新密码和确认密码' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '两次新密码输入不一致' });
  }
  if (!validatePassword(newPassword)) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '新密码至少 8 位' });
  }

  const user = db
    .prepare('SELECT id, password_hash, must_reset_password FROM users WHERE id = ? AND enabled = 1')
    .get(req.user.id);
  if (!user) {
    return res.status(404).json({ code: 'VALIDATION_ERROR', message: '用户不存在' });
  }
  if (!bcrypt.compareSync(oldPassword, user.password_hash)) {
    return res.status(401).json({ code: 'FORBIDDEN', message: '原密码错误' });
  }
  if (oldPassword === newPassword) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '新密码不能与原密码相同' });
  }

  const newPasswordHash = bcrypt.hashSync(normalizeText(newPassword), 10);
  db.prepare('UPDATE users SET password_hash = ?, must_reset_password = 0 WHERE id = ?').run(newPasswordHash, req.user.id);
  insertAudit(user.id, 'change_password', `user=${user.id}`, `reset=${user.must_reset_password}`);
  res.json({ message: '密码修改成功', mustResetPassword: false });
});

app.get('/api/school-admin/overview', requireRole(['school_admin']), (req, res) => {
  const schoolId = req.user.school_id;
  const classes = db
    .prepare(
      `SELECT c.id, c.grade, c.name, c.capacity,
              u.id as teacher_id, u.name as teacher_name, u.username as teacher_username
         FROM classrooms c
         LEFT JOIN users u ON u.id = (
              SELECT id
                FROM users
               WHERE role = 'teacher' AND classroom_id = c.id
               ORDER BY enabled DESC, id ASC
               LIMIT 1
            )
        WHERE c.school_id = ?
        ORDER BY c.grade, c.name, c.id`
    )
    .all(schoolId);
  const classStudentCounts = db
    .prepare(
      `SELECT c.id as class_id, COUNT(s.id) as cnt
         FROM classrooms c
         LEFT JOIN students s ON s.classroom_id = c.id
        WHERE c.school_id = ?
        GROUP BY c.id`
    )
    .all(schoolId);
  const classStudentCountMap = new Map(classStudentCounts.map((row) => [row.class_id, row.cnt]));
  const notices = db
    .prepare(
      `SELECT n.id, n.title, n.due_at, n.status, n.version
         FROM notices n
        WHERE n.school_id = ?
        ORDER BY datetime(n.created_at) DESC`
    )
    .all(schoolId);

  const classMap = new Map(
    classes.map((c) => [
      c.id,
      {
        id: c.id,
        grade: c.grade || "",
        name: c.name || "",
        expectedCount: Math.max(classStudentCountMap.get(c.id) || 0, c.capacity || 0),
        capacity: c.capacity || 0,
        userCount: 0,
        teacher: c.teacher_id
          ? {
              id: c.teacher_id,
              name: c.teacher_name || "",
              username: c.teacher_username || "",
            }
          : null,
      },
    ])
  );

  const countTasksForNoticeClass = db.prepare(
    `SELECT COUNT(*) as c
       FROM sign_tasks st
      WHERE st.notice_id = ?
        AND st.student_id IN (SELECT id FROM students WHERE classroom_id = ?)`
  );
  const countSignedForNoticeClass = db.prepare(
    `SELECT COUNT(DISTINCT st.student_id) as c
       FROM sign_records sr
       JOIN sign_tasks st ON st.id = sr.sign_task_id
      WHERE st.notice_id = ?
        AND st.student_id IN (SELECT id FROM students WHERE classroom_id = ?)`
  );
  const countUnboundForNoticeClass = db.prepare(
    `SELECT COUNT(*) as c
       FROM students s
      WHERE s.classroom_id = ?
        AND NOT EXISTS (SELECT 1 FROM parent_bindings pb WHERE pb.student_id = s.id AND pb.status='VALID')`
  );
  const countExceptionForNoticeClass = db.prepare(
    `SELECT COUNT(*) as c
       FROM (
         SELECT s.id AS student_id
           FROM students s
          WHERE s.classroom_id = ?
            AND EXISTS (SELECT 1 FROM parent_bindings pb WHERE pb.student_id = s.id AND pb.status='PENDING_REVIEW')
         UNION
         SELECT st.student_id
           FROM sign_anomalies sa
           JOIN sign_tasks st ON st.id = sa.sign_task_id
          WHERE st.notice_id = ?
            AND st.student_id IN (SELECT id FROM students WHERE classroom_id = ?)
            AND sa.status='PENDING'
       ) x`
  );
  const countBindingAnomalyForNoticeClass = db.prepare(
    `SELECT COUNT(*) as cnt
       FROM binding_anomalies
      WHERE notice_id = ? AND classroom_id = ? AND status = 'PENDING'`
  );
  const countOverdueForNoticeClass = db.prepare(
    `SELECT COUNT(*) as c
       FROM sign_tasks st
      WHERE st.notice_id = ?
        AND st.student_id IN (SELECT id FROM students WHERE classroom_id = ?)
        AND NOT EXISTS (SELECT 1 FROM sign_records sr WHERE sr.sign_task_id = st.id)`
  );

  const overviewRows = [];
  for (const notice of notices) {
    const scopeClasses = db
      .prepare('SELECT classroom_id FROM notice_scope_classes WHERE notice_id = ?')
      .all(notice.id)
      .map((x) => x.classroom_id);
    for (const classId of scopeClasses) {
      const classInfo = classMap.get(classId) || {
        grade: "",
        name: "",
        expectedCount: 0,
        capacity: 0,
        teacher: null,
      };
      const classStudentCount = classInfo.expectedCount || 0;
      const allTasks = countTasksForNoticeClass.get(notice.id, classId).c;
      const signedTasks = countSignedForNoticeClass.get(notice.id, classId).c;
      const unbound = countUnboundForNoticeClass.get(classId).c;
      const exception = countExceptionForNoticeClass.get(classId, notice.id, classId).c + countBindingAnomalyForNoticeClass.get(notice.id, classId).cnt;
      const overdue = allTasks
        ? countOverdueForNoticeClass.get(notice.id, classId).c
        : 0;
      const delivery = getNoticeDelivery(notice.id, classId);

      overviewRows.push({
        noticeId: notice.id,
        noticeTitle: notice.title,
        classId,
        classGrade: classInfo.grade,
        className: classInfo.name ? `${classInfo.grade}(${classInfo.name})` : classInfo.grade,
        classShortName: classInfo.name || "",
        teacherId: classInfo.teacher ? classInfo.teacher.id : null,
        teacherName: classInfo.teacher ? classInfo.teacher.name : null,
        teacherUsername: classInfo.teacher ? classInfo.teacher.username : null,
        expected: Math.max(allTasks, classStudentCount),
        signed: signedTasks,
        unbound,
        exception,
        overdue: new Date(notice.due_at) < new Date() ? overdue : 0,
        dueAt: notice.due_at,
        delivery: serializeDelivery(delivery),
        forwardStatus: delivery ? delivery.forward_status : 'PENDING',
        forwardedAt: delivery ? delivery.forwarded_at : null,
      });
    }
  }

  res.json({
    classes: Array.from(classMap.values()),
    notices: notices.map((n) => ({ ...n })),
    progress: overviewRows,
  });
});

app.get('/api/school-admin/settings', requireRole(['school_admin']), (req, res) => {
  const school = db.prepare('SELECT id, name, enabled, created_at FROM schools WHERE id = ?').get(req.user.school_id);
  const grades = db
    .prepare('SELECT id, name, entry_year, created_at FROM school_grades WHERE school_id = ? ORDER BY name, id')
    .all(req.user.school_id);
  const classes = db
    .prepare(
      `SELECT c.id, c.grade, c.name, c.capacity, c.created_at,
              u.id as teacher_id, u.name as teacher_name, u.username as teacher_username
         FROM classrooms c
         LEFT JOIN users u ON u.id = (
              SELECT id
                FROM users
               WHERE role = 'teacher' AND classroom_id = c.id
               ORDER BY enabled DESC, id ASC
               LIMIT 1
            )
        WHERE c.school_id = ?
        ORDER BY c.grade, c.name, c.id`
    )
    .all(req.user.school_id);
  const users = db
    .prepare(
      `SELECT id, username, role, name, classroom_id, enabled, created_at
         FROM users
        WHERE school_id = ?
        ORDER BY role, id`
    )
    .all(req.user.school_id);
  res.json({
    school: school
      ? { id: school.id, name: school.name, enabled: !!school.enabled, createdAt: school.created_at }
      : null,
    grades: grades.map((row) => ({
      id: row.id,
      name: row.name,
      entryYear: row.entry_year || '',
      createdAt: row.created_at,
    })),
    classes: classes.map((row) => ({
      id: row.id,
      grade: row.grade,
      name: row.name,
      capacity: row.capacity,
      createdAt: row.created_at,
      teacher: row.teacher_id
        ? { id: row.teacher_id, name: row.teacher_name, username: row.teacher_username }
        : null,
    })),
    users: users.map((row) => ({
      id: row.id,
      username: row.username,
      role: row.role,
      name: row.name,
      classroomId: row.classroom_id || null,
      enabled: !!row.enabled,
      createdAt: row.created_at,
    })),
  });
});

app.get('/api/school-admin/audit-logs', requireRole(['school_admin']), (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  const logs = db
    .prepare(
      `SELECT al.id, al.action, al.target, al.detail, al.created_at,
              COALESCE(u.name, u.username, '系统') as actor
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_user_id
        WHERE u.school_id = ?
        ORDER BY datetime(al.created_at) DESC, al.id DESC
        LIMIT ?`
    )
    .all(req.user.school_id, limit);
  res.json({
    logs: logs.map((row) => ({
      id: row.id,
      time: row.created_at,
      actor: row.actor,
      action: row.action,
      target: row.target || '',
      detail: row.detail || '',
    })),
  });
});

app.patch('/api/school-admin/school', requireRole(['school_admin']), (req, res) => {
  const schoolName = normalizeText(req.body.schoolName || req.body.name);
  if (!schoolName) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '学校名称不能为空' });
  }
  db.prepare('UPDATE schools SET name = ? WHERE id = ?').run(schoolName, req.user.school_id);
  insertAudit(req.user.id, 'school_profile_update', `school=${req.user.school_id}`, `name=${schoolName}`);
  res.json({ id: req.user.school_id, name: schoolName });
});

app.post('/api/school-admin/grades', requireRole(['school_admin']), (req, res) => {
  const name = normalizeText(req.body.name || req.body.grade);
  const entryYear = normalizeText(req.body.entryYear || '');
  const initialClassCount = normalizeNonNegativeInteger(req.body.initialClassCount);
  const classCapacity = normalizeNonNegativeInteger(req.body.classCapacity);
  if (!name) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '年级名称不能为空' });
  }
  if (initialClassCount > 50) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '一次最多创建 50 个初始班级' });
  }
  const exists = db.prepare('SELECT 1 FROM school_grades WHERE school_id = ? AND name = ?').get(req.user.school_id, name);
  if (exists) {
    return res.status(409).json({ code: 'VALIDATION_ERROR', message: '年级已存在' });
  }
  const createdClasses = [];
  let gradeId = 0;
  const tx = db.transaction(() => {
    gradeId = db
      .prepare('INSERT INTO school_grades (school_id, name, entry_year, created_at) VALUES (?, ?, ?, ?)')
      .run(req.user.school_id, name, entryYear, now()).lastInsertRowid;
    if (initialClassCount) {
      const insertClass = db.prepare('INSERT INTO classrooms (school_id, grade, name, capacity, created_at) VALUES (?, ?, ?, ?, ?)');
      for (let i = 1; i <= initialClassCount; i += 1) {
        const className = `（${i}）班`;
        const classId = insertClass.run(req.user.school_id, name, className, classCapacity, now()).lastInsertRowid;
        createdClasses.push({ id: classId, grade: name, name: className, capacity: classCapacity });
      }
    }
    insertAudit(req.user.id, 'grade_create', `grade=${gradeId}`, `name=${name};classes=${createdClasses.length}`);
  });
  tx();
  res.status(201).json({ id: gradeId, name, entryYear, classes: createdClasses });
});

app.patch('/api/school-admin/grades/:gradeId', requireRole(['school_admin']), (req, res) => {
  const gradeId = Number(req.params.gradeId);
  const name = normalizeText(req.body.name || req.body.grade);
  const entryYear = normalizeText(req.body.entryYear || '');
  if (!Number.isFinite(gradeId) || gradeId <= 0) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '年级编号不正确' });
  }
  if (!name) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '年级名称不能为空' });
  }
  const current = db
    .prepare('SELECT id, name FROM school_grades WHERE id = ? AND school_id = ?')
    .get(gradeId, req.user.school_id);
  if (!current) {
    return res.status(404).json({ code: 'VALIDATION_ERROR', message: '年级不存在' });
  }
  const duplicate = db
    .prepare('SELECT 1 FROM school_grades WHERE school_id = ? AND name = ? AND id <> ?')
    .get(req.user.school_id, name, gradeId);
  if (duplicate) {
    return res.status(409).json({ code: 'VALIDATION_ERROR', message: '年级已存在' });
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE school_grades SET name = ?, entry_year = ? WHERE id = ? AND school_id = ?').run(
      name,
      entryYear,
      gradeId,
      req.user.school_id
    );
    if (current.name !== name) {
      db.prepare('UPDATE classrooms SET grade = ? WHERE school_id = ? AND grade = ?').run(name, req.user.school_id, current.name);
    }
    insertAudit(req.user.id, 'grade_update', `grade=${gradeId}`, `name=${current.name}->${name}`);
  });
  tx();
  res.json({ id: gradeId, name, entryYear });
});

app.delete('/api/school-admin/grades/:gradeId', requireRole(['school_admin']), (req, res) => {
  const gradeId = Number(req.params.gradeId);
  const confirmed = req.body && req.body.confirm === true;
  if (!Number.isFinite(gradeId) || gradeId <= 0) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '年级编号不正确' });
  }
  const current = db
    .prepare('SELECT id, name FROM school_grades WHERE id = ? AND school_id = ?')
    .get(gradeId, req.user.school_id);
  if (!current) {
    return res.status(404).json({ code: 'VALIDATION_ERROR', message: '年级不存在' });
  }
  const classCount = db
    .prepare('SELECT COUNT(*) as cnt FROM classrooms WHERE school_id = ? AND grade = ?')
    .get(req.user.school_id, current.name).cnt;
  if (!confirmed) {
    return res.status(409).json({ code: 'VALIDATION_ERROR', message: '请确认删除年级及其下属班级' });
  }
  const classes = db
    .prepare('SELECT id FROM classrooms WHERE school_id = ? AND grade = ?')
    .all(req.user.school_id, current.name);
  const classIds = classes.map((row) => row.id);
  const tx = db.transaction(() => {
    if (classIds.length) {
      const placeholders = classIds.map(() => '?').join(',');
      db.prepare(`UPDATE users SET classroom_id = NULL WHERE classroom_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM export_tasks WHERE class_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM reminder_logs WHERE classroom_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM notice_deliveries WHERE classroom_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM notice_scope_classes WHERE classroom_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM access_tokens WHERE classroom_id IN (${placeholders})`).run(...classIds);
      db.prepare(
        `DELETE FROM sign_records
          WHERE sign_task_id IN (
            SELECT st.id
              FROM sign_tasks st
              JOIN students s ON s.id = st.student_id
             WHERE s.classroom_id IN (${placeholders})
          )`
      ).run(...classIds);
      db.prepare(
        `DELETE FROM sign_anomalies
          WHERE student_id IN (
            SELECT id FROM students WHERE classroom_id IN (${placeholders})
          )`
      ).run(...classIds);
      db.prepare(
        `DELETE FROM parent_bindings
          WHERE student_id IN (
            SELECT id FROM students WHERE classroom_id IN (${placeholders})
          )`
      ).run(...classIds);
      db.prepare(
        `DELETE FROM sign_tasks
          WHERE student_id IN (
            SELECT id FROM students WHERE classroom_id IN (${placeholders})
          )`
      ).run(...classIds);
      db.prepare(`DELETE FROM binding_anomalies WHERE classroom_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM student_import_batches WHERE classroom_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM students WHERE classroom_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM classrooms WHERE id IN (${placeholders})`).run(...classIds);
    }
    db.prepare('DELETE FROM school_grades WHERE id = ? AND school_id = ?').run(gradeId, req.user.school_id);
    insertAudit(req.user.id, 'grade_delete', `grade=${gradeId}`, `name=${current.name};classes=${classCount}`);
  });
  tx();
  res.json({ id: gradeId, name: current.name, deleted: true, classCount });
});

app.post('/api/school-admin/classes', requireRole(['school_admin']), (req, res) => {
  const grade = normalizeText(req.body.grade);
  const name = normalizeText(req.body.name || req.body.className);
  const capacity = normalizeNonNegativeInteger(req.body.capacity);
  if (!grade || !name) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '年级和班级名称不能为空' });
  }
  const exists = db
    .prepare('SELECT 1 FROM classrooms WHERE school_id = ? AND grade = ? AND name = ?')
    .get(req.user.school_id, grade, name);
  if (exists) {
    return res.status(409).json({ code: 'VALIDATION_ERROR', message: '班级已存在' });
  }
  const classId = db
    .prepare('INSERT INTO classrooms (school_id, grade, name, capacity, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.school_id, grade, name, capacity, now()).lastInsertRowid;
  db.prepare('INSERT OR IGNORE INTO school_grades (school_id, name, entry_year, created_at) VALUES (?, ?, ?, ?)').run(
    req.user.school_id,
    grade,
    '',
    now()
  );
  insertAudit(req.user.id, 'class_create', `class=${classId}`, `${grade}${name}`);
  res.status(201).json({ id: classId, grade, name, capacity });
});

app.patch('/api/school-admin/classes/:classId', requireRole(['school_admin']), (req, res) => {
  const classId = Number(req.params.classId);
  const grade = normalizeText(req.body.grade);
  const name = normalizeText(req.body.name || req.body.className);
  const capacity = normalizeNonNegativeInteger(req.body.capacity);
  if (!Number.isFinite(classId) || classId <= 0) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '班级编号不正确' });
  }
  if (!grade || !name) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '年级和班级名称不能为空' });
  }
  const current = db
    .prepare('SELECT id, grade, name FROM classrooms WHERE id = ? AND school_id = ?')
    .get(classId, req.user.school_id);
  if (!current) {
    return res.status(404).json({ code: 'VALIDATION_ERROR', message: '班级不存在' });
  }
  const duplicate = db
    .prepare('SELECT 1 FROM classrooms WHERE school_id = ? AND grade = ? AND name = ? AND id <> ?')
    .get(req.user.school_id, grade, name, classId);
  if (duplicate) {
    return res.status(409).json({ code: 'VALIDATION_ERROR', message: '班级已存在' });
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE classrooms SET grade = ?, name = ?, capacity = ? WHERE id = ? AND school_id = ?').run(
      grade,
      name,
      capacity,
      classId,
      req.user.school_id
    );
    db.prepare('INSERT OR IGNORE INTO school_grades (school_id, name, entry_year, created_at) VALUES (?, ?, ?, ?)').run(
      req.user.school_id,
      grade,
      '',
      now()
    );
    insertAudit(req.user.id, 'class_update', `class=${classId}`, `${current.grade}${current.name}->${grade}${name};capacity=${capacity}`);
  });
  tx();
  res.json({ id: classId, grade, name, capacity });
});

app.post('/api/school-admin/users', requireRole(['school_admin']), (req, res) => {
  const username = normalizeText(req.body.username);
  const name = normalizeText(req.body.name);
  const role = normalizeText(req.body.role || 'teacher');
  const classroomId = req.body.classroomId ? Number(req.body.classroomId) : null;
  const initialPassword = normalizeText(req.body.initialPassword || generateInitialPassword());
  if (!username || !name || !['school_admin', 'teacher'].includes(role)) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '账号、姓名和角色不能为空' });
  }
  if (!validatePassword(initialPassword)) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '初始密码至少 8 位' });
  }
  if (role === 'teacher' && !classroomId) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '班主任必须分配负责班级' });
  }
  if (classroomId) {
    const classInfo = getClassById(classroomId);
    if (!classInfo || classInfo.school_id !== req.user.school_id) {
      return res.status(403).json({ code: 'FORBIDDEN', message: '不能分配非本校班级' });
    }
  }
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (exists) {
    return res.status(409).json({ code: 'VALIDATION_ERROR', message: '账号已存在' });
  }
  const userId = db
    .prepare(
      `INSERT INTO users (school_id, username, password_hash, role, name, classroom_id, must_reset_password, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)`
    )
    .run(req.user.school_id, username, bcrypt.hashSync(initialPassword, 10), role, name, classroomId, now()).lastInsertRowid;
  insertAudit(req.user.id, 'user_create', `user=${userId}`, `role=${role};class=${classroomId || ''}`);
  res.status(201).json({
    id: userId,
    username,
    role,
    name,
    classroomId,
    initialPassword,
  });
});

app.post('/api/school-admin/users/:userId/reset-password', requireRole(['school_admin']), (req, res) => {
  const userId = Number(req.params.userId);
  const newPassword = normalizeText(req.body.newPassword || generateInitialPassword());
  if (!validatePassword(newPassword)) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '新密码至少 8 位' });
  }
  const user = db.prepare('SELECT id, username, name FROM users WHERE id = ? AND school_id = ?').get(userId, req.user.school_id);
  if (!user) {
    return res.status(404).json({ code: 'VALIDATION_ERROR', message: '账号不存在' });
  }
  db.prepare('UPDATE users SET password_hash = ?, must_reset_password = 0, enabled = 1 WHERE id = ?').run(
    bcrypt.hashSync(newPassword, 10),
    userId
  );
  insertAudit(req.user.id, 'user_password_reset', `user=${userId}`, `username=${user.username}`);
  res.json({ id: user.id, username: user.username, name: user.name, initialPassword: newPassword });
});

app.patch('/api/school-admin/users/:userId/status', requireRole(['school_admin']), (req, res) => {
  const userId = Number(req.params.userId);
  const enabled = !!req.body.enabled;
  const user = db.prepare('SELECT id, username FROM users WHERE id = ? AND school_id = ?').get(userId, req.user.school_id);
  if (!user) {
    return res.status(404).json({ code: 'VALIDATION_ERROR', message: '账号不存在' });
  }
  if (user.id === req.user.id && !enabled) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '不能停用当前登录账号' });
  }
  db.prepare('UPDATE users SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, userId);
  insertAudit(req.user.id, 'user_status_update', `user=${userId}`, `enabled=${enabled ? 1 : 0}`);
  res.json({ id: user.id, username: user.username, enabled });
});

app.post(
  '/api/school-admin/import/:kind/file-preview',
  express.raw({
    type: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream',
      'text/csv',
      'text/plain',
      'text/tab-separated-values',
    ],
    limit: '8mb',
  }),
  requireRole(['school_admin']),
  (req, res) => {
    const kind = normalizeText(req.params.kind).toLowerCase();
    if (!['grades', 'classes', 'accounts'].includes(kind)) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: '导入类型不支持' });
    }
    const fileName = path.basename(
      normalizeText(req.query.fileName || req.headers['x-file-name'] || `${kind}.csv`)
    );
    try {
      const rows = parseSchoolImportRowsFromFile(req.body, fileName, req.headers['content-type']);
      if (!rows.length) {
        return res.status(400).json({ code: 'IMPORT_PRECHECK_FAILED', message: '未解析到可导入数据' });
      }
      const preview = buildSchoolImportPreview(req.user.school_id, kind, rows);
      insertAudit(req.user.id, `import_${kind}_preview`, `school=${req.user.school_id}`, `file=${fileName}; rows=${rows.length}`);
      res.json({
        ...preview,
        source: { sourceType: 'FILE', fileName, rowCount: rows.length },
      });
    } catch (err) {
      res.status(400).json({ code: 'IMPORT_PRECHECK_FAILED', message: err.message });
    }
  }
);

app.post('/api/school-admin/import/:kind/commit', requireRole(['school_admin']), (req, res) => {
  const kind = normalizeText(req.params.kind).toLowerCase();
  if (!['grades', 'classes', 'accounts'].includes(kind)) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '导入类型不支持' });
  }
  const body = req.body || {};
  const inputRows = Array.isArray(body.rows) ? body.rows : [];
  if (!inputRows.length) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '提交数据为空' });
  }
  const preview = buildSchoolImportPreview(req.user.school_id, kind, inputRows);
  if (!preview.canSubmit) {
    return res.status(400).json({
      code: 'IMPORT_PRECHECK_FAILED',
      message: '提交数据未通过服务端预检',
      preview,
    });
  }
  try {
    const committed = commitSchoolImport(req.user.school_id, req.user.id, kind, preview);
    res.json({
      message: '导入提交成功',
      preview,
      createdAccounts: committed.createdAccounts,
      source: body.source || null,
    });
  } catch (err) {
    res.status(500).json({ code: 'IMPORT_COMMIT_FAILED', message: err.message });
  }
});

app.post(
  '/api/teacher/notice-attachments/pdf',
  express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: '16mb' }),
  requireRole(['school_admin']),
  (req, res) => {
    const payload = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    const fileName = sanitizePdfFileName(req.query.fileName || 'notice.pdf');
    if (!payload.length) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'PDF 文件不能为空' });
    }
    if (!isPdfBuffer(payload)) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: '请上传有效的 PDF 文件' });
    }

    const storageName = `${Date.now()}-${randomToken(6)}.pdf`;
    const storagePath = path.join(NOTICE_ATTACHMENT_DIR, storageName);
    fs.writeFileSync(storagePath, payload);
    const relativePath = path.join('notice-attachments', storageName);
    const hash = sha(payload);
    const result = db
      .prepare(
        `INSERT INTO notice_attachments
           (school_id, uploader_user_id, file_name, storage_path, mime_type, file_size, sha256, created_at)
         VALUES (?, ?, ?, ?, 'application/pdf', ?, ?, ?)`
      )
      .run(req.user.school_id, req.user.id, fileName, relativePath, payload.length, hash, now());
    const attachment = getNoticeAttachmentById(result.lastInsertRowid);
    insertAudit(req.user.id, 'notice_attachment_upload', `attachment=${result.lastInsertRowid}`, `file=${fileName}`);
    res.json({ attachment: serializeNoticeAttachment(attachment) });
  }
);

app.get('/api/teacher/notices', requireRole(['school_admin', 'teacher']), (req, res) => {
  let notices = [];
  if (req.user.role === 'school_admin') {
    notices = db
      .prepare('SELECT n.* FROM notices n WHERE n.school_id = ? ORDER BY datetime(n.created_at) DESC')
      .all(req.user.school_id);
  } else {
    notices = db
      .prepare(
        `SELECT n.*
           FROM notices n
          WHERE n.school_id = ?
            AND (
              n.created_by = ?
              OR EXISTS (
                SELECT 1
                  FROM notice_scope_classes sc
                 WHERE sc.notice_id = n.id
                   AND sc.classroom_id = ?
              )
            )
          ORDER BY datetime(n.created_at) DESC`
      )
      .all(req.user.school_id, req.user.id, req.user.classroom_id);
  }
  res.json({
    notices: notices.map((notice) => {
      const classroomId = req.user.role === 'teacher' ? req.user.classroom_id : null;
      return {
        ...notice,
        attachment: serializeNoticeAttachment(getNoticeAttachment(notice)),
        delivery: classroomId ? serializeDelivery(getNoticeDelivery(notice.id, classroomId)) : null,
      };
    }),
  });
});

app.post('/api/teacher/notices', requireRole(['school_admin', 'teacher']), (req, res) => {
  if (req.user.role !== 'school_admin') {
    return res.status(403).json({ code: 'FORBIDDEN', message: '只有学校管理员可以创建通知' });
  }
  const body = req.body || {};
  const title = normalizeText(body.title);
  const detail = normalizeLongText(body.body);
  const dueAt = normalizeText(body.dueAt);
  const noticeType = normalizeNoticeType(body.noticeType);
  const contentSource = normalizeContentSource(body.contentSource);
  const attachmentId = body.attachmentId ? Number(body.attachmentId) : null;
  const scopeClassIds = normalizeScopeClassIds(body.scopeClassIds);
  if (!title || !detail || !dueAt || !scopeClassIds.length) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '标题、正文或说明、截止时间、范围为必填' });
  }
  let attachment = null;
  if (contentSource === 'PDF') {
    if (!attachmentId) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: '请先上传 PDF 附件' });
    }
    attachment = db
      .prepare('SELECT * FROM notice_attachments WHERE id = ? AND school_id = ?')
      .get(attachmentId, req.user.school_id);
    if (!attachment || attachment.notice_id) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'PDF 附件不存在或已被使用' });
    }
  }

  const dueDate = new Date(dueAt);
  if (Number.isNaN(dueDate.getTime())) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '截止时间格式不合法' });
  }
  const placeholder = scopeClassIds.map(() => '?').join(',');
  const validScopes = db
    .prepare(`SELECT COUNT(*) as cnt FROM classrooms WHERE school_id = ? AND id IN (${placeholder})`)
    .get(req.user.school_id, ...scopeClassIds).cnt;
  if (validScopes !== scopeClassIds.length) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '存在无效班级范围' });
  }

  const insertScope = db.prepare('INSERT INTO notice_scope_classes (notice_id, classroom_id) VALUES (?, ?)');
  const tx = db.transaction((ids) => {
    const result = db
      .prepare(
        `INSERT INTO notices
           (school_id, title, body, notice_type, content_source, attachment_id, status, version, due_at, scope, require_signature, allow_multi_guardian, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', 1, ?, 'CLASS', 1, 1, ?, ?, ?)`
      )
      .run(
        req.user.school_id,
        title,
        detail,
        noticeType,
        contentSource,
        contentSource === 'PDF' ? attachmentId : null,
        dueDate.toISOString(),
        req.user.id,
        now(),
        now()
      );
    const noticeId = result.lastInsertRowid;
    for (const classId of ids) {
      insertScope.run(noticeId, classId);
      ensureNoticeDelivery(noticeId, classId);
    }
    if (attachment) {
      db.prepare('UPDATE notice_attachments SET notice_id = ? WHERE id = ?').run(noticeId, attachment.id);
    }
    return noticeId;
  });
  const noticeId = tx(scopeClassIds);
  insertAudit(req.user.id, 'notice_create', `notice=${noticeId}`, `title=${title};type=${noticeType};source=${contentSource}`);
  res.json({
    noticeId,
    title,
    noticeType,
    contentSource,
    attachment: contentSource === 'PDF' ? serializeNoticeAttachment(getNoticeAttachmentById(attachmentId)) : null,
    dueAt: dueDate.toISOString(),
    scopeClassIds,
  });
});

app.post('/api/teacher/notices/:noticeId/publish', requireRole(['school_admin', 'teacher']), (req, res) => {
  if (req.user.role !== 'school_admin') {
    return res.status(403).json({ code: 'FORBIDDEN', message: '只有学校管理员可以发布通知' });
  }
  const noticeId = Number(req.params.noticeId);
  const notice = getNoticeById(noticeId);
  if (!notice) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '通知不存在' });
  if (notice.school_id !== req.user.school_id) {
    return res.status(403).json({ code: 'FORBIDDEN', message: '不能发布非本校通知' });
  }
  const scopeRows = db.prepare('SELECT classroom_id FROM notice_scope_classes WHERE notice_id = ?').all(noticeId);
  if (!scopeRows.length) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '发布失败：未设置发布范围' });
  }
  const classIds = scopeRows.map((row) => row.classroom_id);
  createNoticeTasks(noticeId, classIds);
  for (const classId of classIds) {
    ensureNoticeDelivery(noticeId, classId);
  }
  db.prepare(`UPDATE notices SET status = 'PUBLISHED', published_at = ?, updated_at = ? WHERE id = ?`).run(
    now(),
    now(),
    noticeId
  );
  insertAudit(req.user.id, 'notice_publish', `notice=${noticeId}`, `classes=${classIds.join(',')}`);
  res.json({
    noticeId,
    status: 'PUBLISHED',
    publishedAt: now(),
    scopeClassIds: classIds,
  });
});

app.patch('/api/teacher/notices/:noticeId/due-at', requireRole(['school_admin']), (req, res) => {
  const noticeId = Number(req.params.noticeId);
  const dueAt = normalizeText(req.body.dueAt);
  const notice = getNoticeById(noticeId);
  if (!notice) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '通知不存在' });
  if (notice.school_id !== req.user.school_id) {
    return res.status(403).json({ code: 'FORBIDDEN', message: '不能修改非本校通知' });
  }
  if (!dueAt) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '截止时间不能为空' });
  }
  const dueDate = new Date(dueAt);
  if (Number.isNaN(dueDate.getTime())) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '截止时间格式不合法' });
  }
  const dueIso = dueDate.toISOString();
  db.prepare('UPDATE notices SET due_at = ?, updated_at = ? WHERE id = ?').run(dueIso, now(), noticeId);
  db.prepare(
    `UPDATE access_tokens
        SET expires_at = ?
      WHERE notice_id = ? AND purpose = 'SIGN' AND revoked_at IS NULL`
  ).run(dueIso, noticeId);
  insertAudit(req.user.id, 'notice_due_at_update', `notice=${noticeId}`, `dueAt=${dueIso}`);
  res.json({ noticeId, dueAt: dueIso });
});

app.post(
  '/api/teacher/classes/:classId/import-preview',
  requireRole(['school_admin', 'teacher']),
  requireTeacherManageClass,
  (req, res) => {
    const classId = Number(req.params.classId);
    const classObj = getClassById(classId);
    if (!classObj) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '班级不存在' });
    const body = req.body || {};
    const csvRows = Array.isArray(body.rows)
      ? body.rows
      : parseRowFromText(body.csvText || body.rawText || '');
    res.json(buildImportPreview(classId, csvRows));
  }
);

app.post(
  '/api/teacher/classes/:classId/import-file-preview',
  express.raw({
    type: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream',
      'text/csv',
      'text/plain',
      'text/tab-separated-values',
    ],
    limit: '8mb',
  }),
  requireRole(['school_admin', 'teacher']),
  requireTeacherManageClass,
  (req, res) => {
    const classId = Number(req.params.classId);
    const classObj = getClassById(classId);
    if (!classObj) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '班级不存在' });
    const fileName = path.basename(
      normalizeText(req.query.fileName || req.headers['x-file-name'] || 'students.csv')
    );

    try {
      const parsedRows = parseStudentRowsFromFile(req.body, fileName, req.headers['content-type']);
      if (!parsedRows.length) {
        return res.status(400).json({ code: 'IMPORT_PRECHECK_FAILED', message: '未解析到学生数据' });
      }
      insertAudit(req.user.id, 'import_file_preview', `class=${classId}`, `file=${fileName}; rows=${parsedRows.length}`);
      res.json({
        ...buildImportPreview(classId, parsedRows),
        source: { sourceType: 'FILE', fileName, rowCount: parsedRows.length },
      });
    } catch (err) {
      res.status(400).json({ code: 'IMPORT_PRECHECK_FAILED', message: err.message });
    }
  }
);

app.get(
  '/api/teacher/classes/:classId/import-history',
  requireRole(['school_admin', 'teacher']),
  requireTeacherManageClass,
  (req, res) => {
    const classId = Number(req.params.classId);
    const classObj = getClassById(classId);
    if (!classObj) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '班级不存在' });
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const rows = db
      .prepare(
        `SELECT h.*, u.username as actor_username, u.name as actor_name
           FROM student_import_batches h
           LEFT JOIN users u ON u.id = h.actor_user_id
          WHERE h.school_id = ? AND h.classroom_id = ?
          ORDER BY datetime(h.created_at) DESC, h.id DESC
          LIMIT ?`
      )
      .all(req.user.school_id, classId, limit);
    res.json({ classId, histories: rows.map(serializeImportHistory) });
  }
);

app.get(
  '/api/teacher/classes/:classId/import-template',
  requireRole(['school_admin', 'teacher']),
  requireTeacherManageClass,
  (req, res) => {
    const classId = Number(req.params.classId);
    const classObj = getClassById(classId);
    if (!classObj) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '班级不存在' });
    const fileName = `student-template-class-${classId}.xls`;
    const filePath = path.join(EXPORT_DIR, fileName);
    writeExcelXml(
      filePath,
      [],
      '学生名单模板'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.sendFile(filePath);
  }
);

app.post(
  '/api/teacher/classes/:classId/import-commit',
  requireRole(['school_admin', 'teacher']),
  requireTeacherManageClass,
  (req, res) => {
    const classId = Number(req.params.classId);
    const classObj = getClassById(classId);
    if (!classObj) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '班级不存在' });
    const body = req.body || {};
    const inputRows = Array.isArray(body.rows) ? body.rows : [];
    if (!inputRows.length) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: '提交数据为空' });
    }
    const preview = buildImportPreview(classId, inputRows);
    if (!preview.canSubmit) {
      return res.status(400).json({
        code: 'IMPORT_PRECHECK_FAILED',
        message: '提交数据未通过服务端预检',
        preview,
      });
    }

    const source = normalizeImportSource(body.source, inputRows.some((r) => r && r._fromFile) ? 'FILE' : 'API');

    const actionInsert = db.prepare(
      `INSERT INTO students (classroom_id, student_name, student_no, created_at) VALUES (?, ?, ?, ?)`
    );
    const actionUpdate = db.prepare(
      `UPDATE students SET student_name = ?, created_at = ? WHERE id = ?`
    );
    const historyInsert = db.prepare(
      `INSERT INTO student_import_batches
         (school_id, classroom_id, actor_user_id, source_type, file_name, row_count,
          add_count, update_count, skip_count, conflict_count, error_count, warning_count,
          status, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUCCEEDED', ?, ?)`
    );
    const tx = db.transaction((list) => {
      for (const item of list) {
        const action = normalizeText(item.action);
        const studentName = normalizeText(item.studentName);
        const studentNo = normalizeText(item.studentNo);
        if (!studentName || !studentNo) continue;
        if (action === 'ADD') {
          actionInsert.run(classId, studentName, studentNo, now());
          createNoticeTasksForStudent(classId, studentNo);
        } else if (action === 'UPDATE' && item.studentId) {
          actionUpdate.run(studentName, now(), item.studentId);
        }
      }
      const detail = JSON.stringify({
        source,
        result: preview.result,
        warningReasons: preview.warnings.map((item) => item.reason),
      });
      historyInsert.run(
        req.user.school_id,
        classId,
        req.user.id,
        source.sourceType,
        source.fileName,
        inputRows.length,
        preview.result.add,
        preview.result.update,
        preview.result.skip,
        preview.result.conflict,
        preview.errors.length,
        preview.warnings.length,
        detail,
        now()
      );
    });
    try {
      tx(preview.rows.filter((r) => r.action === 'ADD' || r.action === 'UPDATE'));
    } catch (err) {
      return res.status(500).json({ code: 'IMPORT_PRECHECK_FAILED', message: err.message });
    }

    insertAudit(req.user.id, 'import_students', `class=${classId}`, `rows=${inputRows.length}; source=${source.sourceType}`);
    res.json({ classId, message: '导入提交成功', preview });
  }
);

function createNoticeTasksForStudent(classroomId, studentNo) {
  const student = db.prepare('SELECT id FROM students WHERE classroom_id = ? AND student_no = ?').get(classroomId, studentNo);
  if (!student) return;
  const publishedNoticeIds = db
    .prepare(
      `SELECT n.id
         FROM notices n
         JOIN notice_scope_classes sc ON sc.notice_id = n.id
        WHERE sc.classroom_id = ? AND n.status='PUBLISHED'`
    )
    .all(classroomId)
    .map((row) => row.id);
  const addTask = db.prepare(
    `INSERT OR IGNORE INTO sign_tasks (notice_id, student_id, status, created_at) VALUES (?, ?, 'PENDING', ?)`
  );
  const tx = db.transaction((noticeIds) => {
    for (const nid of noticeIds) {
      addTask.run(nid, student.id, now());
    }
  });
  tx(publishedNoticeIds);
}

app.post('/api/teacher/classes/:classId/binding-link', requireRole(['school_admin', 'teacher']), requireTeacherManageClass, (req, res) => {
  const classId = Number(req.params.classId);
  const classObj = getClassById(classId);
  const scopeRows = db
    .prepare('SELECT id FROM classrooms WHERE id = ? AND school_id = ?')
    .get(classId, req.user.school_id);
  if (!scopeRows) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '班级不存在' });
  const expire = new Date();
  expire.setFullYear(expire.getFullYear() + 3);
  revokeAccessTokens({ schoolId: req.user.school_id, classroomId: classId, purpose: 'BINDING' });
  const token = createAccessToken({
    schoolId: req.user.school_id,
    classroomId: classId,
    purpose: 'BINDING',
    expiresAt: expire,
  });
  insertAudit(req.user.id, 'token_binding_generate', `class=${classId}`, `token_created`);
  res.json({ classId, token, url: parentPublicUrl(token) });
});

app.post('/api/teacher/notices/:noticeId/sign-link', requireRole(['school_admin', 'teacher']), (req, res) => {
  const noticeId = Number(req.params.noticeId);
  const notice = getNoticeById(noticeId);
  if (!notice) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '通知不存在' });
  const classroomId = Number(req.body.classroomId || req.query.classroomId);
  if (!classroomId) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '缺少 classroomId' });
  }
  if (req.user.role === 'teacher' && req.user.classroom_id !== classroomId) {
    return res.status(403).json({ code: 'FORBIDDEN', message: '只能为本人班级生成签收链接' });
  }
  const existsScope = db
    .prepare('SELECT 1 FROM notice_scope_classes WHERE notice_id = ? AND classroom_id = ?')
    .get(noticeId, classroomId);
  if (!existsScope) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '通知未覆盖该班级' });
  }
  const scopeCheck = assertNoticeAndClassScope(req.user, noticeId, classroomId);
  if (!scopeCheck.ok) {
    return res.status(scopeCheck.status).json({ code: 'FORBIDDEN', message: scopeCheck.message });
  }
  const dueAt = new Date(notice.due_at);
  revokeAccessTokens({
    schoolId: notice.school_id,
    classroomId,
    noticeId,
    purpose: 'SIGN',
  });
  const token = createAccessToken({
    schoolId: notice.school_id,
    classroomId,
    noticeId,
    purpose: 'SIGN',
    expiresAt: dueAt,
  });
  const tokenRecord = getAccessTokenByRaw(token);
  ensureNoticeDelivery(noticeId, classroomId);
  db.prepare(
    `UPDATE notice_deliveries
        SET sign_access_token_id = ?, updated_at = ?
      WHERE notice_id = ? AND classroom_id = ?`
  ).run(tokenRecord ? tokenRecord.id : null, now(), noticeId, classroomId);
  insertAudit(req.user.id, 'token_sign_generate', `notice=${noticeId},class=${classroomId}`, `token_created`);
  res.json({
    noticeId,
    classroomId,
    token,
    url: parentPublicUrl(token),
    delivery: serializeDelivery(getNoticeDelivery(noticeId, classroomId)),
  });
});

app.post('/api/teacher/notices/:noticeId/sign-link/revoke', requireRole(['school_admin', 'teacher']), (req, res) => {
  const noticeId = Number(req.params.noticeId);
  const notice = getNoticeById(noticeId);
  if (!notice) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '通知不存在' });
  const classroomId = Number(req.body.classroomId || req.query.classroomId);
  if (!classroomId) return res.status(400).json({ code: 'VALIDATION_ERROR', message: '缺少 classroomId' });
  if (req.user.role === 'teacher' && req.user.classroom_id !== classroomId) {
    return res.status(403).json({ code: 'FORBIDDEN', message: '只能撤销本人班级签收链接' });
  }
  const scopeCheck = assertNoticeAndClassScope(req.user, noticeId, classroomId);
  if (!scopeCheck.ok) {
    return res.status(scopeCheck.status).json({ code: 'FORBIDDEN', message: scopeCheck.message });
  }
  revokeAccessTokens({ schoolId: notice.school_id, classroomId, noticeId, purpose: 'SIGN' });
  ensureNoticeDelivery(noticeId, classroomId);
  db.prepare(
    `UPDATE notice_deliveries
        SET updated_at = ?
      WHERE notice_id = ? AND classroom_id = ?`
  ).run(now(), noticeId, classroomId);
  insertAudit(req.user.id, 'token_sign_revoke', `notice=${noticeId},class=${classroomId}`, normalizeText(req.body.reason || 'manual'));
  res.json({ noticeId, classroomId, delivery: serializeDelivery(getNoticeDelivery(noticeId, classroomId)) });
});

app.post('/api/teacher/notices/:noticeId/forward', requireRole(['school_admin', 'teacher']), (req, res) => {
  const noticeId = Number(req.params.noticeId);
  const notice = getNoticeById(noticeId);
  if (!notice) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '通知不存在' });
  const classroomId = Number(req.body.classroomId || req.query.classroomId || req.user.classroom_id);
  if (!classroomId) return res.status(400).json({ code: 'VALIDATION_ERROR', message: '缺少 classroomId' });
  if (req.user.role === 'teacher' && req.user.classroom_id !== classroomId) {
    return res.status(403).json({ code: 'FORBIDDEN', message: '只能标记本人班级转发状态' });
  }
  const scopeCheck = assertNoticeAndClassScope(req.user, noticeId, classroomId);
  if (!scopeCheck.ok) {
    return res.status(scopeCheck.status).json({ code: 'FORBIDDEN', message: scopeCheck.message });
  }
  ensureNoticeDelivery(noticeId, classroomId);
  db.prepare(
    `UPDATE notice_deliveries
        SET forward_status = 'FORWARDED', forwarded_at = ?, forwarded_by = ?, updated_at = ?
      WHERE notice_id = ? AND classroom_id = ?`
  ).run(now(), req.user.id, now(), noticeId, classroomId);
  insertAudit(req.user.id, 'notice_forward_mark', `notice=${noticeId},class=${classroomId}`, normalizeText(req.body.remark || ''));
  res.json({ noticeId, classroomId, delivery: serializeDelivery(getNoticeDelivery(noticeId, classroomId)) });
});

app.post('/api/teacher/class/:classId/reminders', requireRole(['school_admin', 'teacher']), requireTeacherManageClass, (req, res) => {
  const classId = Number(req.params.classId);
  const noticeId = Number(req.body.noticeId || req.query.noticeId);
  if (!noticeId) return res.status(400).json({ code: 'VALIDATION_ERROR', message: '缺少 noticeId' });
  const scopeCheck = assertNoticeAndClassScope(req.user, noticeId, classId);
  if (!scopeCheck.ok) {
    return res.status(scopeCheck.status).json({ code: 'FORBIDDEN', message: scopeCheck.message });
  }
  const rawStudentIds = Array.isArray(req.body.studentIds) ? req.body.studentIds : [];
  const studentIds = Array.from(new Set(rawStudentIds.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0)));
  if (studentIds.length) {
    const placeholders = studentIds.map(() => '?').join(',');
    const validCount = db
      .prepare(`SELECT COUNT(*) as cnt FROM students WHERE classroom_id = ? AND id IN (${placeholders})`)
      .get(classId, ...studentIds).cnt;
    if (validCount !== studentIds.length) {
      return res.status(403).json({ code: 'FORBIDDEN', message: '提醒学生不属于当前班级' });
    }
  }
  const remark = normalizeText(req.body.remark || '复制提醒话术后手动提醒');
  const targets = studentIds.length ? studentIds : [null];
  const insert = db.prepare(
    `INSERT INTO reminder_logs (notice_id, classroom_id, student_id, actor_user_id, remark, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction((ids) => {
    for (const studentId of ids) {
      insert.run(noticeId, classId, studentId, req.user.id, remark, now());
    }
  });
  tx(targets);
  ensureNoticeDelivery(noticeId, classId);
  db.prepare(
    `UPDATE notice_deliveries
        SET reminder_count = reminder_count + ?, reminded_at = ?, reminded_by = ?, updated_at = ?
      WHERE notice_id = ? AND classroom_id = ?`
  ).run(targets.length, now(), req.user.id, now(), noticeId, classId);
  insertAudit(req.user.id, 'notice_reminder_mark', `notice=${noticeId},class=${classId}`, `count=${targets.length};remark=${remark}`);
  res.json({
    noticeId,
    classId,
    reminderCountAdded: targets.length,
    delivery: serializeDelivery(getNoticeDelivery(noticeId, classId)),
  });
});

app.get('/api/public/link/:token', (req, res) => {
  const token = normalizeText(req.params.token);
  if (!token) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'token 不能为空' });
  const hash = sha(token);
  const record = db.prepare('SELECT * FROM access_tokens WHERE token_hash = ?').get(hash);
  if (!record) return res.status(404).json({ code: 'TOKEN_INVALID', message: 'token 不存在' });
  if (record.revoked_at) return res.status(410).json({ code: 'TOKEN_REVOKED', message: 'token 已撤销' });
  if (isExpired(record.expires_at)) {
    return res.status(410).json({ code: 'TOKEN_EXPIRED', message: 'token 已过期' });
  }
  const classObj = getClassById(record.classroom_id);
  const notice = record.notice_id ? getNoticeById(record.notice_id) : null;
  const school = db.prepare('SELECT id, name FROM schools WHERE id = ?').get(record.school_id);
  res.json({
    purpose: record.purpose,
    schoolId: record.school_id,
    schoolName: school ? school.name : '',
    classroomId: record.classroom_id,
    noticeId: record.notice_id || null,
    className: classObj ? `${classObj.grade}(${classObj.name})` : '',
    noticeTitle: notice ? notice.title : null,
    noticeBody: notice ? notice.body : null,
    noticeType: notice ? notice.notice_type || DEFAULT_NOTICE_TYPE : null,
    contentSource: notice ? notice.content_source || 'TEXT' : null,
    attachment: notice ? serializeNoticeAttachment(getNoticeAttachment(notice), token) : null,
    noticeVersion: notice ? notice.version : null,
    dueAt: notice ? notice.due_at : null,
  });
});

app.get('/api/public/link/:token/attachment', (req, res) => {
  const token = normalizeText(req.params.token);
  if (!token) return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'token 不能为空' });
  const access = getAccessToken(token, 'SIGN');
  if (!access) return res.status(401).json({ code: 'TOKEN_INVALID', message: '签收 token 不合法或已过期' });
  const notice = access.notice_id ? getNoticeById(access.notice_id) : null;
  if (!notice || notice.status !== 'PUBLISHED') {
    return res.status(404).json({ code: 'VALIDATION_ERROR', message: '通知不存在或未发布' });
  }
  const attachment = getNoticeAttachment(notice);
  if (!attachment) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '通知没有 PDF 附件' });
  const absPath = resolveAttachmentPath(attachment);
  if (!absPath || !fs.existsSync(absPath)) {
    return res.status(404).json({ code: 'VALIDATION_ERROR', message: 'PDF 附件不存在或已清理' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Type, X-Attachment-Filename');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', fs.statSync(absPath).size);
  res.setHeader('Content-Disposition', `inline; filename="notice.pdf"; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`);
  res.setHeader('X-Attachment-Filename', encodeURIComponent(attachment.file_name));
  const stream = fs.createReadStream(absPath);
  stream.on('error', (err) => {
    if (!res.headersSent) {
      return res.status(500).json({ code: 'VALIDATION_ERROR', message: err.message });
    }
    res.destroy(err);
  });
  stream.pipe(res);
});

function getPublicSignContext(body) {
  const token = normalizeText(body.token);
  const studentName = normalizeText(body.studentName);
  const studentNo = normalizeText(body.studentNo);
  const guardianName = normalizeText(body.guardianName);
  const relation = normalizeText(body.relation);
  const bindingId = body.bindingId ? Number(body.bindingId) : null;
  if (!token || !studentName || !guardianName || !relation) {
    return { error: { status: 400, code: 'VALIDATION_ERROR', message: '必填项不能为空' } };
  }

  const access = getAccessToken(token, 'SIGN');
  if (!access) {
    return { error: { status: 401, code: 'TOKEN_INVALID', message: '签收 token 不合法' } };
  }
  const notice = getNoticeById(access.notice_id);
  if (!notice || notice.status !== 'PUBLISHED') {
    return { error: { status: 400, code: 'VALIDATION_ERROR', message: '通知未发布' } };
  }
  const scope = db
    .prepare('SELECT 1 FROM notice_scope_classes WHERE notice_id = ? AND classroom_id = ?')
    .get(access.notice_id, access.classroom_id);
  if (!scope) {
    return { error: { status: 400, code: 'VALIDATION_ERROR', message: '该签收链接与范围不匹配' } };
  }

  let student = null;
  let binding = null;
  if (bindingId) {
    binding = db
      .prepare(
        `SELECT pb.*, s.student_name, s.student_no, s.classroom_id
           FROM parent_bindings pb
           JOIN students s ON s.id = pb.student_id
          WHERE pb.id = ? AND pb.status='VALID'`
      )
      .get(bindingId);
    if (
      binding &&
      binding.classroom_id === access.classroom_id &&
      binding.student_name === studentName &&
      binding.guardian_name === guardianName &&
      binding.relation === relation
    ) {
      student = db.prepare('SELECT * FROM students WHERE id = ?').get(binding.student_id);
    } else {
      binding = null;
    }
  }
  if (!student && studentNo) {
    student = db
      .prepare('SELECT * FROM students WHERE classroom_id = ? AND student_no = ? AND student_name = ?')
      .get(access.classroom_id, studentNo, studentName);
  }
  if (!student) {
    const matches = db
      .prepare('SELECT * FROM students WHERE classroom_id = ? AND student_name = ?')
      .all(access.classroom_id, studentName);
    if (matches.length > 1) {
      return { result: { status: 'NEED_BIND', reason: '同名学生需要班主任核对，请先重新绑定或联系班主任' } };
    }
    student = matches[0] || null;
  }
  if (!student) {
    return { result: { status: 'NEED_BIND', reason: '未匹配到学生' } };
  }

  const task = db
    .prepare('SELECT * FROM sign_tasks WHERE notice_id = ? AND student_id = ?')
    .get(notice.id, student.id);
  if (!task) {
    return { error: { status: 400, code: 'VALIDATION_ERROR', message: '该学生无签收任务' } };
  }

  if (!binding) {
    binding = db
      .prepare(
        `SELECT * FROM parent_bindings
         WHERE student_id = ? AND guardian_name = ? AND relation = ? AND status='VALID'`
      )
      .get(student.id, guardianName, relation);
  }
  if (!binding) {
    return { result: { status: 'NEED_BIND', reason: '未找到有效绑定，请先绑定' } };
  }
  if (!normalizeText(binding.phone)) {
    return { result: { status: 'NEED_BIND', reason: '请先补充家长手机号' } };
  }

  return { access, notice, student, task, binding };
}

function serializeSignRecord(row, taskId, status = 'SIGNED') {
  return {
    status,
    recordNo: row.record_no,
    signedAt: row.signed_at,
    isOverdue: !!row.is_late,
    taskId,
    signatureData: readSignatureDataUrl(row.signature_path),
  };
}

app.post('/api/public/bind', (req, res) => {
  const body = req.body || {};
  const token = normalizeText(body.token);
  const studentName = normalizeText(body.studentName);
  const studentNo = normalizeText(body.studentNo);
  const guardianName = normalizeText(body.guardianName);
  const relation = normalizeText(body.relation);
  const phone = normalizeText(body.phone);
  const signatureData = typeof body.signatureData === 'string' ? body.signatureData.trim() : '';
  const privacyAgreed = !!body.privacyAgreed;
  if (!token || !studentName || !guardianName || !relation) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '必填项不能为空' });
  }
  if (!phone) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '请填写家长手机号' });
  }
  if (!privacyAgreed || !signatureData) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '请勾选隐私告知并完成手写签名' });
  }

  const access = getAnyAccessToken(token, ['SIGN', 'BINDING']);
  if (!access) {
    return res.status(401).json({ code: 'TOKEN_INVALID', message: '链接 token 不合法或已过期' });
  }
  if (access.purpose === 'SIGN') {
    const notice = getNoticeById(access.notice_id);
    if (!notice || notice.status !== 'PUBLISHED') {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: '通知未发布，暂不能绑定' });
    }
    const scope = db
      .prepare('SELECT 1 FROM notice_scope_classes WHERE notice_id = ? AND classroom_id = ?')
      .get(access.notice_id, access.classroom_id);
    if (!scope) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: '该签收链接与班级范围不匹配' });
    }
  }

  const form = { studentName, studentNo, guardianName, relation, phone, signatureData };
  let student = null;
  if (studentNo) {
    student = db
      .prepare('SELECT * FROM students WHERE classroom_id = ? AND student_no = ?')
      .get(access.classroom_id, studentNo);
  } else {
    const matches = db
      .prepare('SELECT * FROM students WHERE classroom_id = ? AND student_name = ?')
      .all(access.classroom_id, studentName);
    if (matches.length > 1) {
      const anomalyId = createBindingAnomaly(
        access,
        form,
        '同名学生需要核对',
        `当前班级存在 ${matches.length} 名同名学生，请班主任核对后处理`,
        req
      );
      return res.status(200).json({
        status: 'PENDING_REVIEW',
        reason: '同名学生需要核对',
        detail: '班级中存在同名学生，已提交班主任审核',
        bindingId: null,
        bindingAnomalyId: anomalyId,
      });
    }
    student = matches[0] || null;
  }
  if (!student) {
    const anomalyId = createBindingAnomaly(
      access,
      form,
      '学生姓名不存在',
      `当前班级未找到学生 ${studentName}`,
      req
    );
    return res.status(200).json({
      status: 'PENDING_REVIEW',
      reason: '学生姓名不存在',
      detail: '当前班级未找到该学生姓名',
      bindingId: null,
      bindingAnomalyId: anomalyId,
    });
  }
  if (student.student_name !== studentName) {
    const anomalyId = createBindingAnomaly(
      access,
      form,
      '姓名与序号不匹配',
      `序号 ${studentNo} 对应学生为 ${student.student_name}`,
      req
    );
    return res.status(200).json({
      status: 'PENDING_REVIEW',
      reason: '姓名与序号不匹配',
      detail: '请核对学生姓名与班内序号',
      bindingId: null,
      bindingAnomalyId: anomalyId,
    });
  }

  const sameBinding = db
    .prepare('SELECT * FROM parent_bindings WHERE student_id = ? AND guardian_name = ? AND relation = ?')
    .get(student.id, guardianName, relation);
  const phoneConflict = phone
    ? db
        .prepare(
          `SELECT * FROM parent_bindings
           WHERE student_id = ? AND phone = ? AND (guardian_name != ? OR relation != ?)
             AND status IN ('VALID','PENDING_REVIEW')`
        )
        .get(student.id, phone, guardianName, relation)
    : null;
  let status = 'VALID';
  let bindingId = sameBinding ? sameBinding.id : null;
  if (sameBinding) {
    status = sameBinding.status === 'VALID' ? 'PENDING_REVIEW' : sameBinding.status;
  }
  if (phoneConflict) {
    status = 'PENDING_REVIEW';
  }
  const insert = db.prepare(
    `INSERT INTO parent_bindings (student_id, guardian_name, relation, phone, status, signature_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  if (sameBinding && sameBinding.status === 'VALID' && !normalizeText(sameBinding.phone) && !phoneConflict) {
    bindingId = sameBinding.id;
    status = 'VALID';
    db.prepare('UPDATE parent_bindings SET phone = ?, updated_at = ? WHERE id = ?').run(phone, now(), bindingId);
  } else if ((sameBinding && sameBinding.status === 'VALID') || phoneConflict) {
    bindingId = insert.run(student.id, guardianName, relation, phone, status, null, now(), now()).lastInsertRowid;
  } else if (!sameBinding) {
    bindingId = insert.run(student.id, guardianName, relation, phone, status, null, now(), now()).lastInsertRowid;
  }
  let signaturePath = null;
  if (signatureData) {
    signaturePath = writeSignatureFile('binding', signatureData, bindingId);
    if (signaturePath) {
      db.prepare('UPDATE parent_bindings SET signature_path = ? WHERE id = ?').run(signaturePath, bindingId);
    }
  }
  insertAudit(null, 'parent_bind', `student=${student.id}`, `binding=${bindingId};status=${status}`);
  res.json({
    status,
    reason:
      status === 'VALID'
        ? '绑定成功'
        : phoneConflict
          ? '手机号与已绑定监护人信息冲突，已进入待审核'
          : '疑似重复绑定，已进入待审核',
    bindingId,
    next: access.notice_id ? 'SIGN' : 'BINDING_DONE',
    noticeId: access.notice_id || null,
    student: { studentId: student.id, studentName: student.student_name, studentNo: student.student_no },
  });
}
);

app.post('/api/public/sign-status', (req, res) => {
  const context = getPublicSignContext(req.body || {});
  if (context.error) {
    return res.status(context.error.status).json({ code: context.error.code, message: context.error.message });
  }
  if (context.result) {
    return res.status(200).json(context.result);
  }
  const record = db
    .prepare(
      `SELECT record_no, signed_at, is_late, signature_path
         FROM sign_records
        WHERE sign_task_id = ? AND parent_binding_id = ?
        ORDER BY datetime(signed_at) ASC
        LIMIT 1`
    )
    .get(context.task.id, context.binding.id);
  if (!record) {
    return res.json({ status: 'UNSIGNED', taskId: context.task.id });
  }
  return res.json(serializeSignRecord(record, context.task.id));
});

app.post('/api/public/sign', (req, res) => {
  const body = req.body || {};
  const signatureData = typeof body.signatureData === 'string' ? body.signatureData.trim() : '';
  const readAgreed = !!body.readAgreed;
  const privacyAgreed = !!body.privacyAgreed;
  if (!readAgreed || !privacyAgreed || !signatureData) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '请完整填写并勾选确认项' });
  }
  const context = getPublicSignContext(body);
  if (context.error) {
    return res.status(context.error.status).json({ code: context.error.code, message: context.error.message });
  }
  if (context.result) {
    return res.status(200).json(context.result);
  }
  const { notice, task, student, binding } = context;

  const existedSign = db
    .prepare(
      `SELECT record_no, signed_at, is_late, signature_path
         FROM sign_records sr
        WHERE sr.sign_task_id = ? AND sr.parent_binding_id = ?
        ORDER BY datetime(sr.signed_at) ASC
        LIMIT 1`
    )
    .get(task.id, binding.id);
  if (existedSign) {
    const existingAnomaly = db
      .prepare(
        `SELECT id FROM sign_anomalies
         WHERE sign_task_id = ? AND parent_binding_id = ? AND anomaly_type = 'REPEAT_SIGN' AND status = 'PENDING'`
      )
      .get(task.id, binding.id);
    let anomalyId = existingAnomaly ? existingAnomaly.id : null;
    if (!anomalyId) {
      const signaturePath = writeSignatureFile('sign-anomaly', signatureData, `${task.id}-${binding.id}`);
      const result = db
        .prepare(
          `INSERT INTO sign_anomalies
             (sign_task_id, notice_id, student_id, parent_binding_id, anomaly_type, status, reason, detail, signature_path, ip_address, user_agent, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'REPEAT_SIGN', 'PENDING', ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          task.id,
          notice.id,
          student.id,
          binding.id,
          '重复签收',
          '同一监护人重复提交',
          signaturePath,
          req.ip,
          req.get('user-agent') || '',
          now(),
          now()
        );
      anomalyId = result.lastInsertRowid;
      insertAudit(
        null,
        'sign_anomaly',
        `task=${task.id};binding=${binding.id}`,
        `type=REPEAT_SIGN;anomaly=${anomalyId}`
      );
    }
    return res.status(200).json({
      status: 'SKIPPED',
      anomalyId,
      reason: '该绑定已签过，已进入签收异常待处理',
      ...serializeSignRecord(existedSign, task.id, 'SKIPPED'),
    });
  }

  const duplicateSameTask = db
    .prepare(`SELECT COUNT(1) as c FROM sign_records WHERE sign_task_id = ?`)
    .get(task.id).c;
  const isOverdue = new Date() > new Date(notice.due_at);
  const recordNo = randomToken(8).toUpperCase();
  const signedAt = now();
  const signaturePath = writeSignatureFile('sign', signatureData, `${task.id}-${binding.id}`);
  const signInsert = db.prepare(
    `INSERT INTO sign_records (sign_task_id, parent_binding_id, record_no, signed_at, is_late, ip_address, user_agent, signature_path, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  signInsert.run(task.id, binding.id, recordNo, signedAt, isOverdue ? 1 : 0, req.ip, req.get('user-agent') || '', signaturePath || '', '');
  db.prepare(`UPDATE sign_tasks SET status = 'SIGNED', signed_at = ? WHERE id = ?`).run(signedAt, task.id);
  insertAudit(null, 'parent_sign', `task=${task.id}`, `record=${recordNo}`);
  res.json({
    status: 'SIGNED',
    isOverdue,
    recordNo,
    signedAt,
    taskId: task.id,
    firstSignOfStudent: duplicateSameTask === 0,
  });
});

app.get('/api/teacher/class/:classId/progress', requireRole(['school_admin', 'teacher']), requireTeacherManageClass, (req, res) => {
  const classId = Number(req.params.classId);
  const noticeId = Number(req.query.noticeId);
  if (!noticeId) return res.status(400).json({ code: 'VALIDATION_ERROR', message: '缺少 noticeId' });
  const notice = getNoticeById(noticeId);
  if (!notice) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '通知不存在' });
  const items = buildStudentProgress(noticeId, classId);
  const className = formatClassLabel(getClassById(classId));
  res.json({
    noticeId,
    classId,
    className,
    dueAt: notice.due_at,
    delivery: serializeDelivery(getNoticeDelivery(noticeId, classId)),
    items,
  });
});

app.get('/api/teacher/class/:classId/students/:studentId/detail', requireRole(['school_admin', 'teacher']), requireTeacherManageClass, (req, res) => {
  const classId = Number(req.params.classId);
  const studentId = Number(req.params.studentId);
  const noticeId = Number(req.query.noticeId || 0);
  if (!noticeId) return res.status(400).json({ code: 'VALIDATION_ERROR', message: '缺少 noticeId' });
  const notice = getNoticeById(noticeId);
  if (!notice) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '通知不存在' });
  const student = db
    .prepare('SELECT id, student_name, student_no, classroom_id, created_at FROM students WHERE id = ? AND classroom_id = ?')
    .get(studentId, classId);
  if (!student) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '学生不存在' });
  const task = db
    .prepare('SELECT id, status, signed_at, created_at FROM sign_tasks WHERE notice_id = ? AND student_id = ?')
    .get(noticeId, studentId);
  const bindings = db
    .prepare(
      `SELECT id, guardian_name, relation, phone, status, created_at, updated_at
         FROM parent_bindings
        WHERE student_id = ?
        ORDER BY datetime(updated_at) DESC`
    )
    .all(studentId);
  const signRecords = task
    ? db
        .prepare(
          `SELECT sr.id, sr.record_no, sr.signed_at, sr.is_late, sr.ip_address, sr.user_agent,
                  pb.guardian_name, pb.relation
             FROM sign_records sr
             JOIN parent_bindings pb ON pb.id = sr.parent_binding_id
            WHERE sr.sign_task_id = ?
            ORDER BY datetime(sr.signed_at) DESC`
        )
        .all(task.id)
    : [];
  const signAnomalies = task
    ? db
        .prepare(
          `SELECT id, anomaly_type, status, reason, detail, created_at, updated_at
             FROM sign_anomalies
            WHERE sign_task_id = ?
            ORDER BY datetime(updated_at) DESC`
        )
        .all(task.id)
    : [];
  const bindingAnomalies = db
    .prepare(
      `SELECT id, submitted_student_name, submitted_student_no, guardian_name, relation, status, reason, detail, created_at, updated_at
         FROM binding_anomalies
        WHERE notice_id = ? AND classroom_id = ? AND submitted_student_no = ?
        ORDER BY datetime(updated_at) DESC`
    )
    .all(noticeId, classId, student.student_no);
  res.json({
    noticeId,
    classId,
    student: {
      id: student.id,
      studentName: student.student_name,
      studentNo: student.student_no,
      createdAt: student.created_at,
    },
    task: task
      ? { id: task.id, status: task.status, signedAt: task.signed_at, createdAt: task.created_at }
      : null,
    bindings: bindings.map((row) => ({
      id: row.id,
      guardianName: row.guardian_name,
      relation: row.relation,
      phone: row.phone || '',
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    signRecords: signRecords.map((row) => ({
      id: row.id,
      recordNo: row.record_no,
      signedAt: row.signed_at,
      isLate: !!row.is_late,
      ipAddress: row.ip_address || '',
      userAgent: row.user_agent || '',
      guardianName: row.guardian_name,
      relation: row.relation,
    })),
    anomalies: [
      ...signAnomalies.map((row) => ({
        id: row.id,
        type: '签收',
        status: row.status,
        reason: row.reason || row.anomaly_type,
        detail: row.detail || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      ...bindingAnomalies.map((row) => ({
        id: row.id,
        type: '绑定',
        status: row.status,
        reason: row.reason || '绑定信息待审核',
        detail: row.detail || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    ],
  });
});

app.get('/api/teacher/class/:classId/exceptions', requireRole(['school_admin', 'teacher']), requireTeacherManageClass, (req, res) => {
  const classId = Number(req.params.classId);
  const bindingRows = db
    .prepare(
      `SELECT pb.id as bindingId, s.student_name, s.student_no,
              pb.guardian_name, pb.relation, pb.phone, pb.status, pb.created_at, pb.updated_at
         FROM parent_bindings pb
         JOIN students s ON s.id = pb.student_id
        WHERE s.classroom_id = ? AND pb.status='PENDING_REVIEW'
        ORDER BY datetime(pb.updated_at) DESC`
    )
    .all(classId);
  const bindingAnomalyRows = db
    .prepare(
      `SELECT id as bindingAnomalyId, submitted_student_name, submitted_student_no,
              guardian_name, relation, reason, detail, status, created_at, updated_at
         FROM binding_anomalies
        WHERE classroom_id = ? AND status='PENDING'
        ORDER BY datetime(updated_at) DESC`
    )
    .all(classId);
  const signRows = db
    .prepare(
      `SELECT sa.id as anomalyId, s.student_name, s.student_no,
              pb.guardian_name, pb.relation, sa.anomaly_type, sa.reason, sa.status, sa.created_at, sa.updated_at
         FROM sign_anomalies sa
         JOIN sign_tasks st ON st.id = sa.sign_task_id
         JOIN students s ON s.id = st.student_id
         LEFT JOIN parent_bindings pb ON pb.id = sa.parent_binding_id
        WHERE s.classroom_id = ? AND sa.status = 'PENDING'
        ORDER BY datetime(sa.updated_at) DESC`
    )
    .all(classId);

  res.json({
    classId,
    items: [
      ...bindingRows.map((row) => ({
        id: row.bindingId,
        source: 'binding',
        bindingId: row.bindingId,
        type: '绑定',
        studentName: row.student_name,
        studentNo: row.student_no,
        parentName: row.guardian_name,
        parentRelation: row.relation,
        reason: row.status === 'PENDING_REVIEW' ? '待审核绑定' : '已驳回',
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      ...bindingAnomalyRows.map((row) => ({
        id: row.bindingAnomalyId,
        source: 'binding_anomaly',
        bindingAnomalyId: row.bindingAnomalyId,
        type: '绑定',
        studentName: row.submitted_student_name,
        studentNo: row.submitted_student_no,
        parentName: row.guardian_name,
        parentRelation: row.relation,
        reason: row.reason || '绑定信息待审核',
        detail: row.detail || '',
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      ...signRows.map((row) => ({
        id: row.anomalyId,
        source: 'sign',
        anomalyId: row.anomalyId,
        type: '签收',
        studentName: row.student_name,
        studentNo: row.student_no,
        parentName: row.guardian_name || '',
        parentRelation: row.relation || '',
        reason:
          row.reason ||
          (row.anomaly_type === 'REPEAT_SIGN'
            ? '重复签收疑似代签'
            : row.anomaly_type === 'WRONG_STUDENT'
              ? '签错学生'
              : '签收异常'),
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    ]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  });
});

app.post('/api/teacher/class/:classId/exceptions/resolve', requireRole(['school_admin', 'teacher']), requireTeacherManageClass, (req, res) => {
  const classId = Number(req.params.classId);
  const bindingId = Number(req.body.bindingId || 0);
  const bindingAnomalyId = Number(req.body.bindingAnomalyId || 0);
  const anomalyId = Number(req.body.anomalyId || 0);
  const type = normalizeText(req.body.type);
  const action = normalizeText(req.body.action);
  const targetType = type || (bindingId ? 'binding' : bindingAnomalyId ? 'binding_anomaly' : anomalyId ? 'sign' : '');
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '动作必须是 approve 或 reject' });
  }
  if (!['binding', 'binding_anomaly', 'sign'].includes(targetType)) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '参数 type 无效，需 binding、binding_anomaly 或 sign' });
  }

  if (targetType === 'binding') {
    const binding = db
      .prepare(
        `SELECT pb.*, s.classroom_id
         FROM parent_bindings pb
         JOIN students s ON s.id = pb.student_id
         WHERE pb.id = ?`
      )
      .get(bindingId);
    if (!binding) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '绑定记录不存在' });
    if (binding.classroom_id !== classId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: '不能处理非本班绑定' });
    }
    const nextStatus = action === 'approve' ? 'VALID' : 'REJECTED';
    db.prepare('UPDATE parent_bindings SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, now(), bindingId);
    insertAudit(req.user.id, 'binding_exception', `binding=${bindingId}`, `action=${action}`);
    return res.json({ type: 'binding', id: bindingId, status: nextStatus });
  }

  if (targetType === 'binding_anomaly') {
    const anomaly = db
      .prepare('SELECT * FROM binding_anomalies WHERE id = ?')
      .get(bindingAnomalyId);
    if (!anomaly) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '绑定异常不存在' });
    if (anomaly.classroom_id !== classId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: '不能处理非本班绑定异常' });
    }
    if (anomaly.status !== 'PENDING') {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: '异常已处理' });
    }
    const nextStatus = action === 'approve' ? 'RESOLVED_APPROVE' : 'RESOLVED_REJECT';
    db
      .prepare(
        `UPDATE binding_anomalies
           SET status = ?, resolved_at = ?, resolved_by = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(nextStatus, now(), req.user.id, now(), bindingAnomalyId);
    insertAudit(req.user.id, 'binding_anomaly', `anomaly=${bindingAnomalyId}`, `action=${action}`);
    return res.json({ type: 'binding_anomaly', id: bindingAnomalyId, status: nextStatus });
  }

  const anomaly = db
    .prepare(
      `SELECT sa.*, s.classroom_id
         FROM sign_anomalies sa
         JOIN sign_tasks st ON st.id = sa.sign_task_id
         JOIN students s ON s.id = st.student_id
        WHERE sa.id = ?`
    )
    .get(anomalyId);
  if (!anomaly) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '签收异常不存在' });
  if (anomaly.classroom_id !== classId) {
    return res.status(403).json({ code: 'FORBIDDEN', message: '不能处理非本班签收异常' });
  }
  if (anomaly.status !== 'PENDING') {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '异常已处理' });
  }
  const nextStatus = action === 'approve' ? 'RESOLVED_APPROVE' : 'RESOLVED_REJECT';
  db
    .prepare(
      `UPDATE sign_anomalies
         SET status = ?, resolved_at = ?, resolved_by = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(nextStatus, now(), req.user.id, now(), anomalyId);
  insertAudit(req.user.id, 'sign_anomaly', `anomaly=${anomalyId}`, `action=${action}`);
  res.json({ type: 'sign', id: anomalyId, status: nextStatus });
});

app.post('/api/export/tasks', requireRole(['school_admin', 'teacher']), async (req, res) => {
  const body = req.body || {};
  const type = normalizeText(body.type);
  const noticeId = Number(body.noticeId || 0);
  let classroomId = Number(body.classroomId || 0);
  const actorUserId = req.user.id;
  if (!type || !['excel', 'student_pdf', 'class_zip'].includes(type)) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '导出类型不支持' });
  }
  if ((type === 'excel' || type === 'class_zip') && (!noticeId || !classroomId)) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '请提交 noticeId 和 classroomId' });
  }
  if (type === 'student_pdf' && (!noticeId || !req.body.taskId)) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: '请提交 taskId' });
  }
  if (type === 'student_pdf') {
    const taskScope = getTaskScope(Number(req.body.taskId));
    if (!taskScope) {
      return res.status(404).json({ code: 'VALIDATION_ERROR', message: '签收任务不存在' });
    }
    if (taskScope.notice_id !== noticeId) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: '签收任务与通知不匹配' });
    }
    classroomId = taskScope.classroom_id;
  }

  const scopeCheck = assertNoticeAndClassScope(req.user, noticeId, classroomId);
  if (!scopeCheck.ok) {
    return res.status(scopeCheck.status).json({ code: 'FORBIDDEN', message: scopeCheck.message });
  }
  if (req.user.role === 'teacher') {
    if (!classroomId || classroomId !== req.user.classroom_id) {
      return res.status(403).json({ code: 'FORBIDDEN', message: '只能导出本人班级数据' });
    }
  }

  const taskId = createExport({ actorUserId, type, noticeId, classroomId });
  try {
    if (type === 'excel') {
      const rows = generateNoticeExportRows(noticeId, classroomId);
      const safeRows = rows.map((r) => ({
        学校: r.school,
        年级: r.grade,
        班级: r.classroom,
        班内序号: r.studentNo,
        学生姓名: r.studentName,
        有效监护人数: r.validGuardianCount,
        绑定异常数: r.pendingBindingCount,
        签收状态: r.signStatus,
        首个签收家长姓名: r.firstSignGuardianName,
        首个签收关系: r.firstSignRelation,
        首个签收时间: r.firstSignTime,
        是否逾期: r.isOverdue ? '是' : '否',
        签收记录数: r.signCount,
        IP地址: r.ip,
        UserAgent: r.userAgent,
        异常标记: r.anomaly,
        签收任务编号: r.taskId,
      }));
      const filePath = path.join(EXPORT_DIR, `${taskId}.xls`);
      writeExcelXml(filePath, safeRows, '签收明细');
      updateExportStatus(taskId, 'SUCCEEDED', { filePath });
    }
    if (type === 'student_pdf') {
      const studentTaskId = Number(body.taskId || body.studentTaskId || 0);
      if (!studentTaskId) {
        return res.status(400).json({ code: 'VALIDATION_ERROR', message: '请提交 taskId' });
      }
      const task = db
        .prepare(
          `SELECT st.id as taskId, n.title, n.version, n.due_at, n.body, n.notice_type, n.content_source, n.attachment_id,
                  s.student_name, s.student_no, c.name as class_name, c.grade, sc.name as school_name
             FROM sign_tasks st
             JOIN notices n ON n.id = st.notice_id
             JOIN students s ON s.id = st.student_id
             JOIN classrooms c ON c.id = s.classroom_id
             JOIN schools sc ON sc.id = c.school_id
             WHERE st.id = ?`
        )
          .get(studentTaskId);
      if (!task) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '签收任务不存在' });
      const signs = db
        .prepare(
            `SELECT sr.record_no, sr.signed_at, sr.is_late, sr.ip_address, sr.user_agent, sr.signature_path, pb.guardian_name, pb.relation, pb.phone
               FROM sign_records sr
               JOIN parent_bindings pb ON pb.id = sr.parent_binding_id
              WHERE sr.sign_task_id = ?
              ORDER BY datetime(sr.signed_at) ASC`
        )
        .all(task.taskId);
      const filePath = path.join(EXPORT_DIR, `${taskId}.pdf`);
      await writeStudentPdf(
        filePath,
        task,
        { grade: task.grade, className: task.class_name },
        {
          studentName: task.student_name,
          studentNo: task.student_no,
          taskId: task.taskId,
        },
        signs.map((x) => ({
          ...x,
          record_no: x.record_no,
          ip_address: x.ip_address,
          user_agent: x.user_agent,
        }))
      );
      updateExportStatus(taskId, 'SUCCEEDED', { filePath });
    }
    if (type === 'class_zip') {
      const notice = getNoticeById(noticeId);
      if (!notice) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '通知不存在' });
      const students = db
        .prepare(
          `SELECT st.id as taskId, s.student_name, s.student_no, c.name as class_name, c.grade
             FROM sign_tasks st
             JOIN students s ON s.id = st.student_id
             JOIN classrooms c ON c.id = s.classroom_id
            WHERE st.notice_id = ? AND c.id = ?`
        )
        .all(noticeId, classroomId);
      const signedTasks = students.filter((x) => {
        return !!db
          .prepare('SELECT 1 FROM sign_records sr WHERE sr.sign_task_id = ?')
          .get(x.taskId);
      });
      const tmpDir = path.join(EXPORT_DIR, `tmp-${taskId}`);
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const classInfo = getClassById(classroomId);
      const pdfs = [];
      for (const s of signedTasks) {
        const signs = db
          .prepare(
            `SELECT sr.record_no, sr.signed_at, sr.is_late, sr.ip_address, sr.user_agent, sr.signature_path, pb.guardian_name, pb.relation, pb.phone
               FROM sign_records sr
               JOIN parent_bindings pb ON pb.id = sr.parent_binding_id
              WHERE sr.sign_task_id = ?`
          )
          .all(s.taskId);
        const pdfFile = path.join(tmpDir, `${s.student_no}-${s.student_name}.pdf`);
        await writeStudentPdf(
          pdfFile,
          {
            title: notice.title,
            body: notice.body,
            notice_type: notice.notice_type,
            content_source: notice.content_source,
            attachment_id: notice.attachment_id,
            version: notice.version,
            due_at: notice.due_at,
            school_name: db.prepare('SELECT name FROM schools WHERE id = ?').get(getClassById(classroomId).school_id).name,
          },
          {
            grade: classInfo.grade,
            className: classInfo.name,
          },
          { studentName: s.student_name, studentNo: s.student_no, taskId: s.taskId },
          signs
        );
        pdfs.push(pdfFile);
      }
      const zipPath = path.join(EXPORT_DIR, `${taskId}.zip`);
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      await new Promise((resolve, reject) => {
        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);
        for (const file of pdfs) archive.file(file, { name: path.basename(file) });
        archive.finalize();
      });
      updateExportStatus(taskId, 'SUCCEEDED', { filePath: zipPath });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    const finalState = db.prepare('SELECT status,file_path FROM export_tasks WHERE id = ?').get(taskId);
    res.json({
      taskId,
      status: finalState ? finalState.status : 'FAILED',
      filePath: finalState ? finalState.file_path : null,
    });
  } catch (err) {
    updateExportStatus(taskId, 'FAILED', { error: err.message });
    res.status(500).json({ code: 'EXPORT_FAILED', message: err.message });
  }
});

app.get('/api/export/tasks/:taskId', requireRole(['school_admin', 'teacher']), (req, res) => {
  const row = db.prepare('SELECT * FROM export_tasks WHERE id = ?').get(req.params.taskId);
  if (!row) return res.status(404).json({ code: 'VALIDATION_ERROR', message: '任务不存在' });
  if (!canAccessExportTask(req.user, row)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: '不能访问该导出任务' });
  }
  res.json(row);
});

app.get('/api/export/tasks/:taskId/download', requireRole(['school_admin', 'teacher']), (req, res) => {
  const row = db.prepare('SELECT * FROM export_tasks WHERE id = ?').get(req.params.taskId);
  if (!row || !row.file_path) return res.status(404).json({ code: 'EXPORT_FAILED', message: '文件未生成' });
  if (!canAccessExportTask(req.user, row)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: '不能下载该导出文件' });
  }
  const absPath = path.resolve(row.file_path);
  const exportRoot = path.resolve(EXPORT_DIR);
  if (absPath !== exportRoot && !absPath.startsWith(`${exportRoot}${path.sep}`)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: '导出路径不合法' });
  }
  if (!fs.existsSync(absPath)) {
    return res.status(404).json({ code: 'EXPORT_FAILED', message: '文件不存在或已清理' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'X-Export-Filename, Content-Disposition, Content-Length, Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', fs.statSync(absPath).size);
  res.setHeader('X-Export-Filename', path.basename(absPath));
  const stream = fs.createReadStream(absPath);
  stream.on('error', (err) => {
    if (!res.headersSent) {
      return res.status(500).json({ code: 'EXPORT_FAILED', message: err.message });
    }
    res.destroy(err);
  });
  stream.pipe(res);
});

app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>家校签收通 API</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f1f4f2; color: #1f2a25; }
    main { max-width: 760px; margin: 12vh auto; padding: 32px; background: #fff; border: 1px solid #d8e0dc; border-radius: 8px; }
    h1 { margin: 0 0 12px; font-size: 28px; }
    p { line-height: 1.7; color: #5b6761; }
    a { color: #1f766d; font-weight: 700; }
    code { background: #eef4f1; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <main>
    <h1>家校签收通 API 服务</h1>
    <p>后端 API 正在当前端口运行，健康检查：<code>/api/health</code>。</p>
    <p>正式前端入口由 <code>PUBLIC_APP_BASE_URL</code> 配置，当前为：<a href="${PUBLIC_APP_BASE_URL}">${PUBLIC_APP_BASE_URL}</a>。</p>
  </main>
</body>
</html>`);
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`家校签收通 MVP 服务已启动: http://localhost:${PORT}`);
});
