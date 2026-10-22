import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { google } from 'googleapis';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DOC_EXTENSIONS, pickOrderDocument, readTextFile, escapeHtml } from './documents.mjs';
import { setupUpdater } from './updater.mjs';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPREADSHEET_ID = '1TZkMbDMhx0XhK3Y-DOS4AgpbakmotaugXEPGKF_xLok';
const SHEET_TITLE = 'Печать_2026';
const KEY_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'google-key.json')
  : path.join(__dirname, '../credentials/google-key.json');
const PRINTERS = { в: { label: 'Валера', color: { red: 0.761, green: 0.482, blue: 0.627 } }, к: { label: 'Андрей', color: { red: 0, green: 1, blue: 1 } }, m: { label: 'Коля', color: { red: 0.29, green: 0.525, blue: 0.91 } } };
const PRINTER_NAME_TO_KEY = { 'Валера': 'в', 'Андрей': 'к', 'Коля': 'm' };
const DONE_COLOR = { red: 1, green: 1, blue: 0 }; // #ffff00

// Статусы производства («Подряд», «Монтаж», …) хранятся в отдельном служебном
// листе. Основной лист Печать_2026 не трогаем: там своя структура, а столбец Z
// занят брошью менеджерской программы. Ключ записи — номер строки + номер
// заявки, поэтому при переиспользовании строки под новый заказ старый статус
// не «прилипает».
const STATUS_SHEET_TITLE = '__PRINT_STATUS__';
const STATUS_HEADERS = ['Строка', 'Заявка', 'Статус'];

function sheetsClient() {
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_PATH, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}

const COL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
const LAST_COL_INDEX = COL_LETTERS.length; // 26 => A..Z

// Paints A..Z of one row. If the whole range is rejected (protected ranges),
// falls back to painting column by column and reports which ones were skipped.
async function paintRow(sheets, sheetId, rowNumber, color) {
  try {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [
      { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: LAST_COL_INDEX }, cell: { userEnteredFormat: { backgroundColor: color } }, fields: 'userEnteredFormat.backgroundColor' } },
    ] } });
    return [];
  } catch (e) {
    const skipped = [];
    for (let col = 0; col < COL_LETTERS.length; col++) {
      try {
        await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [
          { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: col, endColumnIndex: col + 1 }, cell: { userEnteredFormat: { backgroundColor: color } }, fields: 'userEnteredFormat.backgroundColor' } },
        ] } });
      } catch {
        skipped.push(COL_LETTERS[col]);
      }
    }
    if (skipped.length) console.warn('KabalPrint: protected columns skipped:', skipped.join(', '));
    return skipped;
  }
}

async function getOrders() {
  const sheets = sheetsClient();
  const [meta, values, statusMap] = await Promise.all([
    sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, includeGridData: false }),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${SHEET_TITLE}'!A:Y` }),
    readStatusMap(sheets),
  ]);
  const sheet = meta.data.sheets?.find((item) => item.properties?.title === SHEET_TITLE);
  const grid = sheet?.properties?.sheetId;
  const rows = values.data.values || [];
  return rows.map((row, index) => {
    const yValue = String(row[24] || '').trim();
    const isCompleted = yValue === 'Готово';
    let printerKey = PRINTER_NAME_TO_KEY[yValue] || '';
    // В завершённых заявках в Y стоит «Готово» и имя печатника оттуда не достать,
    // но буква печатника осталась в J — берём её, чтобы было видно, кто делал заявку
    if (!printerKey && isCompleted) {
      const jLetter = String(row[9] || '').trim();
      if (PRINTERS[jLetter]) printerKey = jLetter;
    }
    const orderNumber = String(row[0] || '').trim();
    // Статус принимаем только если он записан для этой же заявки — иначе строка
    // уже переиспользована под новый заказ и статус устарел
    const statusEntry = statusMap.get(index + 1);
    const status = statusEntry && (!statusEntry.orderNumber || statusEntry.orderNumber === orderNumber)
      ? statusEntry.status
      : '';
    return {
      rowNumber: index + 1,
      orderNumber,
      client: String(row[1] || '').trim(),
      created: String(row[2] || '').trim(),
      deadline: String(row[3] || '').trim(),
      tz: String(row[4] || '').trim(),
      paperQuantity: String(row[5] || '').trim(),
      paperType: String(row[6] || '').trim(),
      colorMode: String(row[7] || '').trim(),
      note: String(row[8] || '').trim(),
      printer: printerKey,
      manager: String(row[10] || '').trim(),
      completed: isCompleted,
      status,
      sheetId: grid,
    };
  }).filter((order) => order.orderNumber && order.tz);
}

/** Лист со статусами может отсутствовать — тогда статусов ещё не выставляли. */
async function ensureStatusSheet(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, includeGridData: false });
  if (meta.data.sheets?.some((item) => item.properties?.title === STATUS_SHEET_TITLE)) return;
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [
    { addSheet: { properties: { title: STATUS_SHEET_TITLE, gridProperties: { rowCount: 1000, columnCount: 3 } } } },
  ] } });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${STATUS_SHEET_TITLE}'!A1:C1`,
    valueInputOption: 'RAW',
    requestBody: { values: [STATUS_HEADERS] },
  });
}

/** Map<номер строки, { orderNumber, status }> */
async function readStatusMap(sheets) {
  const map = new Map();
  try {
    const result = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${STATUS_SHEET_TITLE}'!A2:C` });
    for (const row of result.data.values || []) {
      const rowNumber = Number.parseInt(String(row[0] || '').trim(), 10);
      const status = String(row[2] || '').trim();
      if (!rowNumber || !status) continue;
      map.set(rowNumber, { orderNumber: String(row[1] || '').trim(), status });
    }
  } catch {
    // Листа ещё нет — статусов нет
  }
  return map;
}

async function setOrderStatus({ rowNumber, orderNumber, status }) {
  const row = Number.parseInt(String(rowNumber || ''), 10);
  if (!row || row < 2) throw new Error('Неверный номер строки');
  const value = String(status || '').trim();
  const order = String(orderNumber || '').trim();
  const sheets = sheetsClient();
  await ensureStatusSheet(sheets);

  const existing = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${STATUS_SHEET_TITLE}'!A:C` });
  const rows = existing.data.values || [];
  const index = rows.findIndex((item, i) => i > 0 && Number.parseInt(String(item[0] || '').trim(), 10) === row);
  const values = [[String(row), order, value]];

  if (index === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${STATUS_SHEET_TITLE}'!A:C`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  } else {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${STATUS_SHEET_TITLE}'!A${index + 1}:C${index + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values },
    });
  }
  return { success: true };
}

/** Сбрасывает статус строки (при отказе от заявки статус уже неактуален). */
async function clearOrderStatus(sheets, rowNumber) {
  try {
    const existing = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${STATUS_SHEET_TITLE}'!A:C` });
    const rows = existing.data.values || [];
    const index = rows.findIndex((item, i) => i > 0 && Number.parseInt(String(item[0] || '').trim(), 10) === rowNumber);
    if (index === -1) return;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${STATUS_SHEET_TITLE}'!A${index + 1}:C${index + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [['', '', '']] },
    });
  } catch {
    // листа нет — чистить нечего
  }
}

/**
 * Взятие одной строки: буква печатника в J, имя в Y, заливка A..Z цветом печатника.
 * Возвращает { ok, error?, skipped } — вызывается и одиночным, и пакетным взятием,
 * чтобы правила проверки владельца были ровно одни.
 */
async function claimRow(sheets, sheetId, rowNumber, printer, config) {
  const current = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${SHEET_TITLE}'!Y${rowNumber}` });
  const ownerName = String(current.data.values?.[0]?.[0] || '').trim();
  if (ownerName === 'Готово') return { ok: false, error: 'Заявка уже завершена', skipped: [] };
  const ownerKey = PRINTER_NAME_TO_KEY[ownerName] || '';
  if (ownerKey && ownerKey !== printer) return { ok: false, error: `Заявка уже взята: ${ownerName}`, skipped: [] };

  // Critical: write printer letter to J and name to Y
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [
    { updateCells: { start: { sheetId, rowIndex: rowNumber - 1, columnIndex: 9 }, rows: [{ values: [{ userEnteredValue: { stringValue: printer } }] }], fields: 'userEnteredValue' } },
    { updateCells: { start: { sheetId, rowIndex: rowNumber - 1, columnIndex: 24 }, rows: [{ values: [{ userEnteredValue: { stringValue: config.label }, userEnteredFormat: { backgroundColor: config.color } }] }], fields: 'userEnteredValue,userEnteredFormat.backgroundColor' } },
  ] } });

  // Paint row A-Z with printer color; protected columns are skipped and reported
  const skipped = await paintRow(sheets, sheetId, rowNumber, config.color);
  return { ok: true, skipped };
}

async function claimOrder({ rowNumber, printer }) {
  const config = PRINTERS[printer];
  if (!config) throw new Error('Неизвестный печатник');
  const sheets = sheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, includeGridData: false });
  const sheet = meta.data.sheets?.find((item) => item.properties?.title === SHEET_TITLE);
  const sheetId = sheet?.properties?.sheetId;
  if (!sheetId && sheetId !== 0) throw new Error('Лист Печать_2026 не найден');

  const result = await claimRow(sheets, sheetId, rowNumber, printer, config);
  if (!result.ok) return { success: false, error: result.error };
  const warning = result.skipped.length
    ? `Заявка взята. Не удалось покрасить защищённые столбцы: ${result.skipped.join(', ')}`
    : '';
  return { success: true, warning };
}

/**
 * Пакетное взятие: у заказчика часто несколько заявок сразу. Мета листа и клиент
 * Sheets берутся один раз, строки обрабатываются по очереди; занятые/завершённые
 * не роняют весь пакет — они возвращаются в failed.
 */
async function claimOrders({ rowNumbers, printer }) {
  const config = PRINTERS[printer];
  if (!config) throw new Error('Неизвестный печатник');
  const rows = (Array.isArray(rowNumbers) ? rowNumbers : [])
    .map((value) => Number.parseInt(String(value ?? ''), 10))
    .filter((value) => Number.isFinite(value) && value >= 2);
  if (!rows.length) return { success: false, error: 'Не выбрано ни одной заявки' };

  const sheets = sheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, includeGridData: false });
  const sheetId = meta.data.sheets?.find((item) => item.properties?.title === SHEET_TITLE)?.properties?.sheetId;
  if (!sheetId && sheetId !== 0) throw new Error('Лист Печать_2026 не найден');

  const claimed = [];
  const failed = [];
  const skippedCols = [];
  for (const rowNumber of rows) {
    try {
      const result = await claimRow(sheets, sheetId, rowNumber, printer, config);
      if (!result.ok) {
        failed.push({ rowNumber, error: result.error });
        continue;
      }
      claimed.push(rowNumber);
      if (result.skipped.length) skippedCols.push(`${rowNumber}: ${result.skipped.join(', ')}`);
    } catch (error) {
      failed.push({ rowNumber, error: error.message });
    }
  }

  const warning = skippedCols.length
    ? `Не удалось покрасить защищённые столбцы (строка — столбцы): ${skippedCols.join('; ')}`
    : '';
  return { success: true, claimed, failed, warning };
}

async function completeOrder({ rowNumber, paperQty, paperDensity, colorMode, postpress }) {
  const sheets = sheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, includeGridData: false });
  const sheetId = meta.data.sheets?.find((item) => item.properties?.title === SHEET_TITLE)?.properties?.sheetId;
  if (!sheetId) throw new Error('Лист Печать_2026 не найден');

  // F=5 кол-во листов, G=6 плотность/тип бумаги, H=7 цветность, I=8 послепечатные работы.
  // Пустые значения не пишем — чтобы не затереть уже заполненные ячейки.
  const filled = [
    { col: 5, value: paperQty },
    { col: 6, value: paperDensity },
    { col: 7, value: colorMode },
    { col: 8, value: postpress },
  ].filter((f) => f.value !== undefined && f.value !== null && String(f.value).trim() !== '');

  const requests = filled.map((f) => ({
    updateCells: {
      start: { sheetId, rowIndex: rowNumber - 1, columnIndex: f.col },
      rows: [{ values: [{ userEnteredValue: { stringValue: String(f.value) } }] }],
      fields: 'userEnteredValue',
    },
  }));
  // Статус «Готово» в Y
  requests.push({
    updateCells: {
      start: { sheetId, rowIndex: rowNumber - 1, columnIndex: 24 },
      rows: [{ values: [{ userEnteredValue: { stringValue: 'Готово' } }] }],
      fields: 'userEnteredValue',
    },
  });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests } });

  const skipped = await paintRow(sheets, sheetId, rowNumber, DONE_COLOR);
  const warning = skipped.length
    ? `Заявка завершена. Не удалось покрасить защищённые столбцы: ${skipped.join(', ')}`
    : '';
  return { success: true, warning };
}

// Запись использованной бумаги (F = кол-во листов, G = плотность/тип) без
// завершения заявки. Печатник фиксирует расход бумаги прямо из карточки, не
// дожидаясь окна завершения. Статус (Y), печатник (J) и заливка строки НЕ меняются.
// Несколько видов бумаги — несколько строк, склеенных переводом строки, как в
// completeOrder: массивы qty/density идут параллельно по строкам.
async function savePaperQty({ rowNumber, paperQty, paperDensity }) {
  // Валидация ДО sheetsClient() — чтобы проба падала до обращения к Sheets
  const row = Number(rowNumber);
  if (!Number.isInteger(row) || row < 2) throw new Error('Некорректный номер строки');
  const qty = String(paperQty ?? '');
  const density = String(paperDensity ?? '');
  if (!qty.trim() && !density.trim()) throw new Error('Укажите количество бумаги');

  const sheets = sheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, includeGridData: false });
  const sheetId = meta.data.sheets?.find((item) => item.properties?.title === SHEET_TITLE)?.properties?.sheetId;
  if (!sheetId) throw new Error('Лист Печать_2026 не найден');

  // F = 5 «Кол-во листов бумаги», G = 6 «Плотность / тип бумаги».
  // Обе ячейки перезаписываются тем, что в редакторе карточки: пустая строка —
  // это намеренная очистка значения печатником, а не «нет данных» (как при завершении).
  const cells = [
    { col: 5, value: qty },
    { col: 6, value: density },
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: cells.map((c) => ({
        updateCells: {
          start: { sheetId, rowIndex: row - 1, columnIndex: c.col },
          rows: [{ values: [{ userEnteredValue: { stringValue: c.value } }] }],
          fields: 'userEnteredValue',
        },
      })),
    },
  });
  return { success: true };
}

async function unclaimOrder({ rowNumber }) {
  const sheets = sheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, includeGridData: false });
  const sheetId = meta.data.sheets?.find((item) => item.properties?.title === SHEET_TITLE)?.properties?.sheetId;
  if (!sheetId) throw new Error('Лист Печать_2026 не найден');
  const WHITE = { red: 1, green: 1, blue: 1 };
  // Critical: clear J and reset Y
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [
    { updateCells: { start: { sheetId, rowIndex: rowNumber - 1, columnIndex: 9 }, rows: [{ values: [{ userEnteredValue: { stringValue: '' } }] }], fields: 'userEnteredValue' } },
    { updateCells: { start: { sheetId, rowIndex: rowNumber - 1, columnIndex: 24 }, rows: [{ values: [{ userEnteredValue: { stringValue: 'не в работе' }, userEnteredFormat: { backgroundColor: WHITE } }] }], fields: 'userEnteredValue,userEnteredFormat.backgroundColor' } },
  ] } });

  // Clear row A-K background; protected columns are skipped
  await paintRow(sheets, sheetId, rowNumber, WHITE);
  // Заявка вернулась в свободные — статус производства больше не актуален
  await clearOrderStatus(sheets, rowNumber);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Печать ТЗ из папки заказа.
// Программа менеджеров кладёт в папку заказа текстовый документ с полной
// техкартой. Печатаем именно его, а не сгенерированное представление.
// ─────────────────────────────────────────────────────────────────────────────

/** Печатает текстовый файл через скрытое окно — без внешних программ. */
async function printTextFile(filePath, title) {
  const text = await readTextFile(filePath);
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 11pt; color: #000; margin: 0; }
  pre { white-space: pre-wrap; word-wrap: break-word; font-family: "Consolas", "Courier New", monospace; font-size: 10.5pt; line-height: 1.35; margin: 0; }
</style></head><body><pre>${escapeHtml(text)}</pre></body></html>`;

  const tmpFile = path.join(os.tmpdir(), `kabal-print-${Date.now()}.html`);
  await fs.writeFile(tmpFile, html, 'utf8');

  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { offscreen: false, sandbox: true },
  });

  try {
    await win.loadFile(tmpFile);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const printed = await new Promise((resolve) => {
      win.webContents.print({ silent: false, printBackground: true }, (ok, reason) => resolve({ ok, reason }));
    });
    return printed;
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.unlink(tmpFile).catch(() => {});
  }
}

/** Печатает документ Word/PDF системным обработчиком (глагол Print). */
async function printWithShell(filePath) {
  const escaped = filePath.replace(/'/g, "''");
  await execFileAsync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Start-Process -FilePath '${escaped}' -Verb Print`,
  ], { windowsHide: true, timeout: 60000 });
}

async function printOrderDocument({ folderPath, orderNumber }) {
  const target = String(folderPath || '').trim();
  if (!target) return { success: false, error: 'В ТЗ заявки не указан путь к папке' };
  if (/^https?:\/\//i.test(target)) {
    return { success: false, error: 'Интернет-ссылка не содержит локального файла техкарты', noDocument: true };
  }

  let entries;
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch (error) {
    return { success: false, error: `Не удалось открыть папку: ${error.message}` };
  }

  const doc = pickOrderDocument(entries, orderNumber);
  if (!doc) {
    return { success: false, error: 'В папке заявки не найден файл техкарты', noDocument: true };
  }

  const fullPath = path.join(target, doc.name);
  const ext = path.extname(doc.name).toLowerCase();

  try {
    if (ext === '.txt') {
      const result = await printTextFile(fullPath, doc.name);
      if (!result.ok) return { success: false, error: `Печать отменена или не удалась: ${result.reason || ''}`.trim(), printedFile: doc.name };
      return { success: true, printedFile: doc.name };
    }
    if (ext === '.html' || ext === '.htm') {
      const win = new BrowserWindow({ show: false, width: 900, height: 1200 });
      try {
        await win.loadFile(fullPath);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const printed = await new Promise((resolve) => {
          win.webContents.print({ silent: false, printBackground: true }, (ok, reason) => resolve({ ok, reason }));
        });
        if (!printed.ok) return { success: false, error: `Печать не удалась: ${printed.reason || ''}`.trim(), printedFile: doc.name };
        return { success: true, printedFile: doc.name };
      } finally {
        if (!win.isDestroyed()) win.destroy();
      }
    }
    await printWithShell(fullPath);
    return { success: true, printedFile: doc.name };
  } catch (error) {
    return { success: false, error: `Не удалось напечатать «${doc.name}»: ${error.message}`, printedFile: doc.name };
  }
}

ipcMain.handle('load-orders', async () => { try { return { success: true, orders: await getOrders() }; } catch (error) { return { success: false, error: error.message }; } });
ipcMain.handle('claim-order', async (_event, data) => { try { return await claimOrder(data); } catch (error) { return { success: false, error: error.message }; } });
ipcMain.handle('claim-orders', async (_event, data) => { try { return await claimOrders(data || {}); } catch (error) { return { success: false, error: error.message }; } });
ipcMain.handle('unclaim-order', async (_event, data) => { try { return await unclaimOrder(data); } catch (error) { return { success: false, error: error.message }; } });
ipcMain.handle('complete-order', async (_event, data) => { try { return await completeOrder(data); } catch (error) { return { success: false, error: error.message }; } });
ipcMain.handle('save-paper-qty', async (_event, data) => { try { return await savePaperQty(data || {}); } catch (error) { return { success: false, error: error.message }; } });
ipcMain.handle('set-order-status', async (_event, data) => { try { return await setOrderStatus(data || {}); } catch (error) { return { success: false, error: error.message }; } });
ipcMain.handle('print-order-document', async (_event, data) => { try { return await printOrderDocument(data || {}); } catch (error) { return { success: false, error: error.message }; } });
ipcMain.handle('open-folder', async (_event, folderPath) => {
  try {
    const target = String(folderPath || '').trim();
    if (!target) return { success: false, error: 'Путь к папке не указан' };
    if (/^https?:\/\//i.test(target)) {
      await shell.openExternal(target);
      return { success: true };
    }
    const errorMessage = await shell.openPath(target);
    return errorMessage ? { success: false, error: errorMessage } : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

let mainWindow = null;
let updater = null;

// Иконку задаём явно и в собранном приложении: Windows берёт её для окна
// и панели задач (иначе кэш показывает старую иконку из предыдущей версии).
// В собранном приложении иконка кладётся в resources (extraResources).
const APP_ICON = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.png')
  : path.join(__dirname, '../build/icon.png');

async function createWindow() {
  Menu.setApplicationMenu(null);
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: APP_ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow = window;
  window.webContents.on('did-fail-load', (_event, code, description, url) => console.error('KabalPrint renderer load failed:', code, description, url));
  window.webContents.on('console-message', (_event, level, message, line, source) => console.log(`[KabalPrint renderer:${level}] ${message} (${source}:${line})`));
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
  await window.loadFile(path.join(__dirname, '../dist/index.html'));

  // Автообновление: проверяем при запуске, через 5 секунд после отрисовки
  updater = setupUpdater({
    getWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined),
  });
  setTimeout(() => updater?.check(), 5000);
}

ipcMain.handle('get-update-state', () => updater?.getState() ?? null);
ipcMain.handle('check-updates', async () => { await updater?.check(true); return updater?.getState() ?? null; });
ipcMain.handle('download-update', () => { updater?.download(); return true; });
ipcMain.handle('dismiss-update', () => { updater?.dismiss(); return true; });
ipcMain.handle('install-update', () => { updater?.install(); return true; });
ipcMain.handle('app-version', () => app.getVersion());

app.whenReady().then(createWindow).catch((error) => console.error('KabalPrint startup failed:', error));
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Связывает окно с идентификатором приложения: иконка в панели задач и группировка
// кнопки берутся из AppUserModelID, а не из устаревшего кэша Windows.
app.setAppUserModelId('com.oskarprint.kabalprint');
