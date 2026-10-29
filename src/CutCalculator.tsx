// src/CutCalculator.tsx
// Окно «Раскрой»: раскладка изделий на печатном листе и количество листов
// на тираж. Логика расчёта — в cutCalc.ts, здесь только ввод и предпросмотр.
//
// Сценарий печатника: открыл заявку → «Раскрой» → форматы и тираж подставлены
// из ТЗ → поправил, если нужно → «Записать в бумагу» (число листов уходит в F)
// или «Распечатать» (раскрой для резчика).

import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Printer as PrinterIcon, Save, RotateCw } from 'lucide-react';
import {
  computeCut,
  guessFormatSizeFromTz,
  savePrecalcSheets,
  SHEET_PRESETS,
  type CutFormat,
  type CutPlan,
  type SheetSpec,
} from './cutCalc';
import type { ParsedTz } from './parseTz';

/** Цвета видов изделий — по кругу, различимы на печати. */
const FORMAT_COLORS = ['#cfe3ff', '#ffe0b2', '#d7f5d0', '#f6d6f6', '#fff3b0', '#d9e8f5', '#ffd6d6'];

interface Props {
  orderNumber: string;
  client: string;
  tz: string;
  parsed: ParsedTz;
  /** Записать посчитанное число листов в поле «кол-во листов» (F). */
  onWriteQty: (sheets: number) => void;
  onClose: () => void;
}

/** «тираж 2 вида по 50 штук» → 2 вида по 50; «1000 шт» → 1000 одного вида. */
function qtyInfoFromParsed(parsed: ParsedTz): { kinds: number; perKind: number; total: number } {
  const raw = String(parsed.quantity || '');
  const perKindMatch = raw.match(/(\d+)\s*вид\w*\s*по\s*(\d[\d\s\u00A0]*)/i);
  if (perKindMatch) {
    const kinds = parseInt(perKindMatch[1], 10) || 1;
    const perKind = parseInt(perKindMatch[2].replace(/\D/g, ''), 10) || 0;
    return { kinds: Math.max(1, Math.min(8, kinds)), perKind, total: kinds * perKind };
  }
  const digits = raw.replace(/[^\d]/g, '');
  const total = digits ? parseInt(digits, 10) : 0;
  return { kinds: 1, perKind: total, total };
}

function makeFormats(parsed: ParsedTz, tz: string): CutFormat[] {
  const size = guessFormatSizeFromTz(tz);
  const info = qtyInfoFromParsed(parsed);

  const list: CutFormat[] = [];
  for (let i = 0; i < info.kinds; i++) {
    list.push({
      id: `f${i + 1}`,
      label: info.kinds > 1 ? `Вид ${i + 1}` : parsed.product || 'Изделие',
      w: size?.w || 0,
      h: size?.h || 0,
      qty: info.perKind,
      rotate: true,
    });
  }
  if (!list.length) {
    list.push({ id: 'f1', label: parsed.product || 'Изделие', w: 0, h: 0, qty: 0, rotate: true });
  }
  return list;
}

interface SheetSettings {
  presetId: string;
  w: number;
  h: number;
  gap: number;
  margin: number;
}

const SHEET_STORAGE_KEY = 'kabal-cut-sheet';

function loadSheetSettings(): SheetSettings {
  const fallback: SheetSettings = { presetId: 'sra3', w: 320, h: 450, gap: 3, margin: 0 };
  try {
    const raw = localStorage.getItem(SHEET_STORAGE_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<SheetSettings>;
    return {
      presetId: typeof saved.presetId === 'string' ? saved.presetId : fallback.presetId,
      w: Number(saved.w) > 0 ? Number(saved.w) : fallback.w,
      h: Number(saved.h) > 0 ? Number(saved.h) : fallback.h,
      gap: Number(saved.gap) >= 0 ? Number(saved.gap) : fallback.gap,
      margin: Number(saved.margin) >= 0 ? Number(saved.margin) : fallback.margin,
    };
  } catch {
    return fallback;
  }
}

const esc = (s: string): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** SVG раскладки строкой — один источник и для предпросмотра, и для печати. */
export function buildLayoutSvg(plan: CutPlan, sheet: SheetSpec, formats: CutFormat[]): string {
  const W = sheet.w;
  const H = sheet.h;
  const colorOf = (id: string) => FORMAT_COLORS[Math.max(0, formats.findIndex((f) => f.id === id)) % FORMAT_COLORS.length];
  const labelOf = (id: string) => formats.find((f) => f.id === id)?.label || '';
  const fontSize = Math.max(2.2, Math.min(9, W / 42));
  const parts: string[] = [];

  parts.push(
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#f2f2f2" stroke="#111" stroke-width="${Math.max(0.5, W / 400)}"/>`,
  );

  if (sheet.margin > 0) {
    parts.push(
      `<rect x="${sheet.margin}" y="${sheet.margin}" width="${W - 2 * sheet.margin}" height="${H - 2 * sheet.margin}" fill="none" stroke="#999" stroke-width="0.4" stroke-dasharray="3 2"/>`,
    );
  }

  plan.layout.placements.forEach((p, i) => {
    parts.push(
      `<rect x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" width="${p.w.toFixed(2)}" height="${p.h.toFixed(2)}" fill="${colorOf(p.formatId)}" stroke="#222" stroke-width="${Math.max(0.3, W / 900)}"/>`,
    );
    const text = p.w > 30 && p.h > 12 ? `${Math.round(p.w)}×${Math.round(p.h)}` : String(i + 1);
    const canLabel = p.w > 18 && p.h > 6;
    if (canLabel) {
      parts.push(
        `<text x="${(p.x + p.w / 2).toFixed(2)}" y="${(p.y + p.h / 2 + fontSize / 3).toFixed(2)}" font-family="Arial, sans-serif" font-size="${fontSize.toFixed(2)}" text-anchor="middle" fill="#111">${esc(text)}</text>`,
      );
    }
  });

  // Размеры листа подписаны снаружи, как в цеховом эскизе.
  parts.push(
    `<text x="${W / 2}" y="${-fontSize * 0.6}" font-family="Arial, sans-serif" font-size="${fontSize}" text-anchor="middle" fill="#111">${W} мм</text>`,
    `<text x="${-fontSize * 0.6}" y="${H / 2}" font-family="Arial, sans-serif" font-size="${fontSize}" text-anchor="middle" fill="#111" transform="rotate(-90 ${-fontSize * 0.6} ${H / 2})">${H} мм</text>`,
  );

  const pad = fontSize * 2.2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}">${parts.join('')}</svg>`;
}

/** Печатная страница для резчика: эскиз + таблица видов + итог. */
export function buildPrintHtml(
  orderNumber: string,
  client: string,
  sheet: SheetSpec,
  formats: CutFormat[],
  plan: CutPlan,
): string {
  const svg = buildLayoutSvg(plan, sheet, formats);
  const rows = formats
    .filter((f) => f.w > 0 && f.h > 0)
    .map((f) => {
      const per = plan.layout.counts[f.id] || 0;
      const sheets = plan.sheetsByFormat[f.id] || 0;
      return `<tr><td>${esc(f.label)}</td><td>${f.w}×${f.h}</td><td>${f.qty || '—'}</td><td>${per}</td><td><b>${sheets || '—'}</b></td></tr>`;
    })
    .join('');

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Раскрой ${esc(orderNumber)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #000; margin: 0; font-size: 11pt; }
  h1 { font-size: 16pt; margin: 0 0 2mm; }
  .sub { font-size: 10pt; color: #333; margin-bottom: 4mm; }
  .sheet { text-align: center; margin: 2mm 0 4mm; }
  .sheet svg { width: 105mm; height: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 10pt; }
  th, td { border: 1px solid #444; padding: 1.4mm 2mm; text-align: left; }
  th { background: #eee; }
  .total { margin-top: 4mm; font-size: 14pt; }
  .total b { font-size: 18pt; }
  .note { margin-top: 3mm; font-size: 9pt; color: #444; }
</style></head><body>
<h1>Раскрой листа — заявка № ${esc(orderNumber)}</h1>
<div class="sub">${esc(client)} · лист ${sheet.w}×${sheet.h} мм · зазор ${sheet.gap} мм${sheet.margin ? ` · поле ${sheet.margin} мм` : ''}</div>
<div class="sheet">${svg}</div>
<table><thead><tr><th>Вид</th><th>Размер, мм</th><th>Тираж</th><th>На листе</th><th>Листов</th></tr></thead><tbody>${rows}</tbody></table>
<div class="total">Всего листов: <b>${plan.sheets}</b></div>
<div class="note">Отход: ${plan.layout.wastePct}% · раскрой гильотинный: сначала вертикальные резы на колонки, затем горизонтальные внутри колонки.</div>
</body></html>`;
}

export default function CutCalculator({ orderNumber, client, tz, parsed, onWriteQty, onClose }: Props) {
  const initialSheet = useMemo(() => loadSheetSettings(), []);
  const [presetId, setPresetId] = useState(initialSheet.presetId);
  const [sheetW, setSheetW] = useState(initialSheet.w);
  const [sheetH, setSheetH] = useState(initialSheet.h);
  const [gap, setGap] = useState(initialSheet.gap);
  const [margin, setMargin] = useState(initialSheet.margin);
  const [formats, setFormats] = useState<CutFormat[]>(() => makeFormats(parsed, tz));
  const [notice, setNotice] = useState('');
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(
        SHEET_STORAGE_KEY,
        JSON.stringify({ presetId, w: sheetW, h: sheetH, gap, margin }),
      );
    } catch {
      /* приватный режим — не критично */
    }
  }, [presetId, sheetW, sheetH, gap, margin]);

  const sheet: SheetSpec = { w: sheetW, h: sheetH, gap, margin };
  const plan = useMemo(() => computeCut(sheet, formats), [sheetW, sheetH, gap, margin, formats]);
  const svg = useMemo(() => buildLayoutSvg(plan, sheet, formats), [plan, sheetW, sheetH, margin, formats]);

  // Запоминаем посчитанное число листов: «Раскрой» берёт его как тираж,
  // чтобы не считать заново и не подставлять тираж заказа вместо листов.
  useEffect(() => {
    savePrecalcSheets(orderNumber, plan.sheets);
  }, [orderNumber, plan.sheets]);

  function applyPreset(id: string) {
    setPresetId(id);
    const preset = SHEET_PRESETS.find((p) => p.id === id);
    if (preset) {
      setSheetW(preset.w);
      setSheetH(preset.h);
    }
  }

  function updateFormat(idx: number, patch: Partial<CutFormat>) {
    setFormats((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
    setNotice('');
  }

  function addFormat() {
    setFormats((prev) => {
      const base = prev[0];
      const next: CutFormat = {
        id: `f${prev.length + 1}-${Date.now().toString(36).slice(-3)}`,
        label: `Вид ${prev.length + 1}`,
        w: base?.w || 0,
        h: base?.h || 0,
        qty: base?.qty || 0,
        rotate: true,
      };
      return [...prev, next];
    });
  }

  function removeFormat(idx: number) {
    setFormats((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  async function handlePrint() {
    if (!plan.layout.placements.length) return;
    setIsPrinting(true);
    try {
      const html = buildPrintHtml(orderNumber, client, sheet, formats, plan);
      if (window.kabalAPI?.printCutLayout) {
        const result = await window.kabalAPI.printCutLayout({ html, title: `Раскрой ${orderNumber}` });
        if (!result.success) setNotice(result.error || 'Не удалось отправить на печать');
      } else {
        // Веб-режим: печатаем через отдельное окно браузера.
        const win = window.open('', '_blank', 'width=900,height=1200');
        if (win) {
          win.document.write(html);
          win.document.close();
          win.focus();
          win.print();
        }
      }
    } finally {
      setIsPrinting(false);
    }
  }

  const num = (v: string, fallback = 0) => {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : fallback;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-window cut-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>Предрасчёт · заявка № {orderNumber}</h2>
            <p className="modal-sub">{client} · сколько изделий влезает на печатный лист и сколько нужно листов</p>
          </div>
          <button className="btn-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body cut-body">
          <div className="cut-inputs">
          {/* Лист */}
          <div className="cut-section">
            <h3>Печатный лист</h3>
            <div className="cut-sheet-row">
              <label className="cut-field">
                <span>Формат</span>
                <select
                  value={presetId}
                  onChange={(e) => applyPreset(e.target.value)}
                >
                  {SHEET_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                  <option value="custom">Свой размер</option>
                </select>
              </label>
              <label className="cut-field cut-field-sm">
                <span>Ширина, мм</span>
                <input
                  type="number"
                  min={1}
                  value={sheetW}
                  onChange={(e) => { setPresetId('custom'); setSheetW(num(e.target.value)); }}
                />
              </label>
              <label className="cut-field cut-field-sm">
                <span>Высота, мм</span>
                <input
                  type="number"
                  min={1}
                  value={sheetH}
                  onChange={(e) => { setPresetId('custom'); setSheetH(num(e.target.value)); }}
                />
              </label>
              <label className="cut-field cut-field-sm">
                <span>Зазор на рез, мм</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={gap}
                  onChange={(e) => setGap(num(e.target.value))}
                />
              </label>
              <label className="cut-field cut-field-sm">
                <span>Поле по краю, мм</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={margin}
                  onChange={(e) => setMargin(num(e.target.value))}
                />
              </label>
            </div>
          </div>

          {/* Форматы */}
          <div className="cut-section">
            <div className="cut-section-head">
              <h3>Изделия на листе</h3>
              <button className="btn-add-paper" onClick={addFormat}>+ Добавить вид</button>
            </div>

            <div className="cut-formats">
              <div className="cut-format-head">
                <span>Вид</span>
                <span>Ширина</span>
                <span>Высота</span>
                <span>Тираж, шт</span>
                <span>Поворот</span>
                <span />
              </div>
              {formats.map((f, idx) => (
                <div className="cut-format-row" key={f.id}>
                  <input
                    className="cut-input cut-input-label"
                    value={f.label}
                    onChange={(e) => updateFormat(idx, { label: e.target.value })}
                  />
                  <input
                    className="cut-input"
                    type="number"
                    min={1}
                    value={f.w || ''}
                    onChange={(e) => updateFormat(idx, { w: num(e.target.value) })}
                  />
                  <input
                    className="cut-input"
                    type="number"
                    min={1}
                    value={f.h || ''}
                    onChange={(e) => updateFormat(idx, { h: num(e.target.value) })}
                  />
                  <input
                    className="cut-input"
                    type="number"
                    min={0}
                    value={f.qty || ''}
                    onChange={(e) => updateFormat(idx, { qty: num(e.target.value) })}
                  />
                  <button
                    className={`cut-rotate ${f.rotate ? 'on' : ''}`}
                    title={f.rotate ? 'Поворот разрешён' : 'Только как есть'}
                    onClick={() => updateFormat(idx, { rotate: !f.rotate })}
                  >
                    <RotateCw size={15} />
                  </button>
                  <button
                    className="btn-remove-paper"
                    disabled={formats.length === 1}
                    onClick={() => removeFormat(idx)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <p className="cut-hint">
              Тираж указывается по каждому виду отдельно: «3 вида по 100» — это 100 в каждой строке,
              иначе листов выйдет втрое больше, чем нужно.
            </p>
          </div>
          </div>

          {/* Предпросмотр + итог */}
          <div className="cut-result">
            <div className="cut-preview" dangerouslySetInnerHTML={{ __html: svg }} />
            <div className="cut-summary">
              <div className="cut-summary-line">
                <span>На листе</span>
                <b>{plan.layout.placements.length} шт</b>
              </div>
              {formats
                .filter((f) => f.w > 0 && f.h > 0)
                .map((f) => (
                  <div className="cut-summary-sub" key={f.id}>
                    {f.label}: {plan.layout.counts[f.id] || 0} шт
                  </div>
                ))}
              <div className="cut-summary-line cut-summary-main">
                <span>Нужно листов</span>
                <b>{plan.sheets || '—'}</b>
              </div>
              <div className="cut-summary-sub">Отход: {plan.layout.wastePct}%</div>
              {plan.problems.length > 0 && (
                <div className="cut-problem">
                  {plan.problems.map((p, i) => <div key={i}>⚠ {p}</div>)}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <span className="complete-footer-note">{notice}</span>
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              onClick={handlePrint}
              disabled={isPrinting || !plan.layout.placements.length}
              title="Распечатать раскрой для резчика"
            >
              <PrinterIcon size={15} /> Распечатать
            </button>
            <button
              className="btn-primary"
              onClick={() => onWriteQty(plan.sheets)}
              disabled={!plan.sheets}
              title="Записать число листов в поле «кол-во листов» заявки"
            >
              <Save size={15} /> Записать {plan.sheets || 0} в бумагу
            </button>
            <button className="btn-secondary" onClick={onClose}>
              <X size={15} /> Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
