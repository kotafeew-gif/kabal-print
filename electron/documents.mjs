// Поиск и чтение файла техкарты в папке заказа.
// Модуль без зависимостей от Electron — чтобы логику можно было тестировать обычным node.

import path from 'node:path';
import fs from 'node:fs/promises';

export const DOC_EXTENSIONS = ['.txt', '.rtf', '.doc', '.docx', '.odt', '.pdf', '.html', '.htm'];

/**
 * Выбирает самый вероятный файл техкарты среди файлов папки.
 * Приоритет: имя содержит «ТЗ»/«техкарта» → содержит номер заявки → простой формат.
 */
export function pickOrderDocument(files, orderNumber) {
  const docs = files.filter((f) => f.isFile() && DOC_EXTENSIONS.includes(path.extname(f.name).toLowerCase()));
  if (docs.length === 0) return null;

  const num = String(orderNumber || '').trim().toLowerCase();
  const scored = docs.map((f) => {
    const name = f.name.toLowerCase();
    let score = 0;
    // «ТЗ», «техкарта», а также латинское «TZ» (файлы менеджеров: TZ-5864 от ... .txt)
    if (/тз|техкарт|тех\.?\s*задани|задание/.test(name)) score += 100;
    if (/(?:^|[\s_\-.,(])tz(?:[\s_\-.,)]|\d|$)/.test(name)) score += 100;
    if (num && name.includes(num)) score += 50;
    if (name.includes('печать')) score += 10;
    const ext = path.extname(name);
    if (ext === '.txt') score += 30;
    else if (ext === '.docx') score += 25;
    else if (ext === '.doc') score += 20;
    else if (ext === '.rtf') score += 15;
    else if (ext === '.pdf') score += 10;
    // Служебные файлы отодвигаем в конец
    if (/^(thumbs\.db|desktop\.ini|\.ds_store)/.test(name)) score -= 1000;
    return { file: f, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].score > 0 ? scored[0].file : docs[0];
}

/**
 * Читает текстовый файл, определяя кодировку: UTF-16 (BOM), UTF-8, Windows-1251.
 * Старые .txt из Windows-программ часто в 1251 — без этого кириллица превращается в мусор.
 */
export async function readTextFile(filePath) {
  const buf = await fs.readFile(filePath);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf);
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf);
  }
  const utf8 = buf.toString('utf8');
  if (utf8.includes('\uFFFD')) {
    try {
      return new TextDecoder('windows-1251').decode(buf);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
