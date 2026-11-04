// src/PaperCutCalculator.tsx
// «Раскрой» — калькулятор раскроя бумаги. Полный перенос paper-calc-pro
// (andreykalenik): простой режим, ПРО-режим на несколько форматов, таблица
// сравнения листов, расчёт тиража и толщины стопы, печать раскроя.
//
// Что переделано относительно оригинала:
//   • расчёт ПРО-режима вынесен в Web Worker — интерфейс не замирает на 17 с,
//     спиннер отражает реальную работу, а не имитирует её;
//   • тяжёлые вычисления мемоизированы: правка поля «Бумага» больше не
//     пересчитывает раскладку (в оригинале пересчитывалось всё подряд);
//   • эскиз рисуется SVG, а не канвасом: React не перерисовывает пиксели
//     при каждом нажатии, а тот же SVG уходит в печать без второй реализации;
//   • таблица сравнения и список форматов рендерятся порциями (по мере прокрутки),
//     чтобы длинные списки не тормозили.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Printer as PrinterIcon, Plus, X, ArrowLeftRight, Loader2, RotateCw } from 'lucide-react';
import ModalShell from './Modal';
import {
  MATERIALS,
  SHEET_PRESETS,
  compareSheets,
  computeLayout,
  computeProLayout,
  guessMaterialFromTz,
  resolveRuller,
  fmtWaste,
  type ProFormat,
  type ProResult,
  type SimpleLayout,
} from './paperCut';
import { readPrecalcSheets } from './cutCalc';
import type { ParsedTz } from './parseTz';
import CutWorker from './cutWorker?worker&inline';

const FORMAT_COLORS = ['#cfe3ff', '#ffe0b2', '#d7f5d0', '#f6d6f6', '#fff3b0', '#d9e8f5', '#ffd6d6', '#e6dcff'];

const esc = (s: string): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const num = (v: string): number => {
  const n = parseInt(v.replace(/\s/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// Эскизы (SVG): один источник и для предпросмотра, и для печати
// ─────────────────────────────────────────────────────────────────────────────

function svgFrame(cW: number, cH: number, inner: string): string {
  // Отступ под размерные подписи должен вмещать сам текст: иначе «940»
  // наезжает на рамку листа и читается как часть схемы.
  const fontSize = Math.max(10, Math.min(26, Math.max(cW, cH) / 26));
  const pad = fontSize * 1.9;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${cW + pad * 2} ${cH + pad * 2}" font-family="Arial, sans-serif">` +
    `<rect x="0" y="0" width="${cW}" height="${cH}" fill="#d9d9d9" stroke="#111" stroke-width="${Math.max(0.4, cW / 500)}"/>` +
    inner +
    `<text x="${cW / 2}" y="${-fontSize * 0.55}" font-size="${fontSize}" text-anchor="middle" fill="#111">${cW}</text>` +
    `<text x="${-fontSize * 0.55}" y="${cH / 2}" font-size="${fontSize}" text-anchor="middle" fill="#111" transform="rotate(-90 ${-fontSize * 0.55} ${cH / 2})">${cH}</text>` +
    `</svg>`
  );
}

/**
 * Подпись изделия внутри ячейки: номер + размер изделия.
 * Номер нужен для счёта, размер — потому что в цеху смотрят именно на него,
 * а не на размер листа.
 */
function tileLabel(
  cx: number,
  cy: number,
  w: number,
  h: number,
  fontSize: number,
  index: number,
  sizeText: string,
): string {
  const fitsSize = w > fontSize * sizeText.length * 0.62 && h > fontSize * 1.3;
  const fitsTwo = fitsSize && h > fontSize * 2.6;
  if (fitsTwo) {
    return (
      `<text x="${cx.toFixed(2)}" y="${(cy - fontSize * 0.55).toFixed(2)}" font-size="${fontSize}" text-anchor="middle" fill="#111">${index}</text>` +
      `<text x="${cx.toFixed(2)}" y="${(cy + fontSize * 1.05).toFixed(2)}" font-size="${fontSize * 0.92}" text-anchor="middle" fill="#333">${sizeText}</text>`
    );
  }
  if (fitsSize) {
    return `<text x="${cx.toFixed(2)}" y="${(cy + fontSize / 3).toFixed(2)}" font-size="${fontSize}" text-anchor="middle" fill="#111">${sizeText}</text>`;
  }
  if (w > fontSize * 1.6 && h > fontSize * 1.2) {
    return `<text x="${cx.toFixed(2)}" y="${(cy + fontSize / 3).toFixed(2)}" font-size="${fontSize}" text-anchor="middle" fill="#111">${index}</text>`;
  }
  return '';
}

/** Простой режим: одно изделие на листе. */
export function buildSimpleSvg(cW: number, cH: number, pW: number, pH: number, layout: SimpleLayout): string {
  if (!layout.fits) return svgFrame(cW, cH, '');
  const stroke = Math.max(0.25, cW / 1200);
  // Кегль привязан к листу, а не к изделию: иначе на превью номера
  // превращаются в точки, а на печати — в нечитаемую мелочь.
  const fontSize = Math.max(9, Math.min(30, Math.min(cW, cH) / 22));
  const parts: string[] = [];
  let n = 0;

  if (layout.nx && layout.ny) {
    // «По долевой»: сетка с допустимым зазором между изделиями.
    const gap = layout.outline;
    for (let row = 0; row < layout.ny; row++) {
      for (let col = 0; col < layout.nx; col++) {
        const x = gap + col * (pW + gap);
        const y = gap + row * (pH + gap);
        n++;
        parts.push(
          `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${pW}" height="${pH}" fill="#fff" stroke="#111" stroke-width="${stroke}"/>`,
        );
        parts.push(tileLabel(x + pW / 2, y + pH / 2, pW, pH, fontSize, n, `${pW}×${pH}`));
      }
    }
  } else if (layout.tiles) {
    for (const [tx, ty, tw, th] of layout.tiles) {
      n++;
      parts.push(
        `<rect x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" width="${tw}" height="${th}" fill="#fff" stroke="#111" stroke-width="${stroke}"/>`,
      );
      parts.push(tileLabel(tx + tw / 2, ty + th / 2, tw, th, fontSize, n, `${Math.round(tw)}×${Math.round(th)}`));
    }
  }

  return svgFrame(cW, cH, parts.join(''));
}

/** ПРО режим: несколько форматов на листе. */
export function buildProSvg(cW: number, cH: number, result: ProResult, formats: ProFormat[]): string {
  const stroke = Math.max(0.25, cW / 1200);
  const parts: string[] = [];
  const colorOf = (id: string) => FORMAT_COLORS[Math.max(0, formats.findIndex((f) => f.id === id)) % FORMAT_COLORS.length];

  for (const p of result.placements) {
    const fontSize = Math.max(9, Math.min(26, Math.min(cW, cH) / 24));
    parts.push(
      `<rect x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" width="${p.w}" height="${p.h}" fill="${colorOf(p.formatId)}" stroke="#111" stroke-width="${stroke}"/>`,
    );
    if (p.w > fontSize * 2.2 && p.h > fontSize * 1.2) {
      parts.push(
        `<text x="${(p.x + p.w / 2).toFixed(2)}" y="${(p.y + p.h / 2 + fontSize / 3).toFixed(2)}" font-size="${fontSize}" text-anchor="middle" fill="#111">${Math.round(p.sourceW)}×${Math.round(p.sourceH)}</text>`,
      );
    }
  }
  return svgFrame(cW, cH, parts.join(''));
}

// ─────────────────────────────────────────────────────────────────────────────
// Компонент
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  orderNumber: string;
  client: string;
  tz: string;
  parsed: ParsedTz;
  onClose: () => void;
}

interface WorkerReply {
  id: number;
  result?: ProResult;
  error?: string;
}

const HISTORY_KEY = 'kabal-papercut-history';

export default function PaperCutCalculator({ orderNumber, client, tz, parsed, onClose }: Props) {
  // ── Исходные данные из ТЗ ────────────────────────────────────────────────
  // Размер изделия НЕ подтягиваем из ТЗ: калькулятор раскроя — про лист и
  // нестандартные изделия, размер вводит печатник.
  //
  // Тираж здесь — это НЕ тираж заказа, а сколько нужно листов/изделий
  // (напр. «нужно 50 листов SRA3»). Его считает «Предрасчёт» — берём оттуда,
  // а тираж заказа (300 открыток) подставлять нельзя: раскрой посчитает
  // 300/4 = 75 листов вместо 50/4 = 13 больших листов.
  const initialRun = useMemo(() => {
    const sheets = readPrecalcSheets(orderNumber);
    return sheets ? String(sheets) : '';
  }, [orderNumber]);

  // Материал — из ТЗ, как и тираж: «Мелованная 350 г/м²» → «мел мат 350 — 340 мкм».
  const initialMaterial = useMemo(() => {
    return guessMaterialFromTz(parsed.paper || '') || guessMaterialFromTz(tz || '');
  }, [parsed.paper, tz]);

  const [productW, setProductW] = useState('');
  const [productH, setProductH] = useState('');
  const [sheetW, setSheetW] = useState('650');
  const [sheetH, setSheetH] = useState('940');
  const [withRuller, setWithRuller] = useState(true);
  const [run, setRun] = useState(initialRun);
  const [material, setMaterial] = useState(initialMaterial?.label || '');
  // Толщина листа в микронах: подставляется из материала, но её можно
  // поправить руками — иначе без выбранного материала стопку не посчитать.
  const [thickness, setThickness] = useState(initialMaterial ? String(initialMaterial.microns) : '');
  const [history, setHistory] = useState<Array<{ w: number; h: number }>>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const parsedHistory = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsedHistory) ? parsedHistory.slice(0, 3) : [];
    } catch {
      return [];
    }
  });

  const [mode, setMode] = useState<'simple' | 'pro'>('simple');
  const [proFormats, setProFormats] = useState<ProFormat[]>(() => [
    { id: 'f1', w: 0, h: 0, rotate: true },
  ]);
  const [proResult, setProResult] = useState<ProResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isPrinting, setIsPrinting] = useState(false);

  // ── Числа ────────────────────────────────────────────────────────────────
  const pW = num(productW);
  const pH = num(productH);
  const cW = num(sheetW);
  const cH = num(sheetH);
  const runValue = num(run);

  // Простой режим считается мгновенно и мемоизируется: смена «Бумага» или
  // «Тираж» не трогает раскладку — в оригинале пересчитывалось всё подряд.
  const layout = useMemo(
    () => (pW && pH && cW && cH ? computeLayout(cW, cH, pW, pH, withRuller) : null),
    [cW, cH, pW, pH, withRuller],
  );

  const svg = useMemo(() => {
    if (!cW || !cH) return '';
    if (mode === 'pro' && proResult) return buildProSvg(cW, cH, proResult, proFormats);
    if (layout && layout.fits) return buildSimpleSvg(cW, cH, pW, pH, layout);
    return svgFrame(cW, cH, '');
  }, [mode, proResult, proFormats, layout, cW, cH, pW, pH]);

  const compareRows = useMemo(
    () => (pW && pH ? compareSheets({ w: pW, h: pH }, { w: cW, h: cH }, history) : []),
    [pW, pH, cW, cH, history],
  );

  // ── Воркер для ПРО-режима ────────────────────────────────────────────────
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const pendingRef = useRef<number | null>(null);

  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new CutWorker();
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        const { id, result, error: workerError } = event.data;
        if (id !== pendingRef.current) return; // устаревший ответ — молча отбрасываем
        pendingRef.current = null;
        setCalculating(false);
        if (workerError) {
          setError(`Ошибка расчёта: ${workerError}`);
          return;
        }
        if (result) {
          setProResult(result);
          setError('');
        }
      };
      worker.onerror = () => {
        setCalculating(false);
        setError('Не удалось запустить расчёт в отдельном потоке');
      };
      workerRef.current = worker;
    } catch {
      workerRef.current = null;
    }
    return () => {
      worker?.terminate();
      workerRef.current = null;
    };
  }, []);

  const calculatePro = useCallback(() => {
    const active = proFormats.filter((f) => f.w > 0 && f.h > 0);
    if (!cW || !cH) {
      setError('Укажите формат листа');
      return;
    }
    if (!active.length) {
      setError('Добавьте хотя бы один формат изделия');
      return;
    }
    setError('');
    setNotice('');

    const id = ++requestIdRef.current;
    pendingRef.current = id;
    setCalculating(true);

    if (workerRef.current) {
      workerRef.current.postMessage({ id, cW, cH, formats: active, gap: 0 });
      return;
    }

    // Воркер недоступен — считаем в основном потоке, но всё равно со спиннером.
    setTimeout(() => {
      try {
        const result = computeProLayout(cW, cH, active, 0);
        if (pendingRef.current === id) {
          setProResult(result);
          setCalculating(false);
        }
      } catch (err) {
        setError(`Ошибка расчёта: ${err instanceof Error ? err.message : String(err)}`);
        setCalculating(false);
      }
    }, 30);
  }, [proFormats, cW, cH]);

  // ── Действия ─────────────────────────────────────────────────────────────
  const applySheet = useCallback(
    (w: number, h: number) => {
      setSheetW(String(w));
      setSheetH(String(h));
      if (pW && pH) setWithRuller(resolveRuller(w, h, pW, pH));
      setHistory((prev) => {
        const isFixed = SHEET_PRESETS.some(([fw, fh]) => (fw === w && fh === h) || (fw === h && fh === w));
        if (isFixed) return prev;
        const next = prev.filter((s) => !((s.w === w && s.h === h) || (s.w === h && s.h === w)));
        next.push({ w, h });
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(-3)));
        } catch {
          /* приватный режим */
        }
        return next.slice(-3);
      });
    },
    [pW, pH],
  );

  const swapProduct = () => {
    setProductW(productH);
    setProductH(productW);
  };

  const swapSheet = () => {
    setSheetW(sheetH);
    setSheetH(sheetW);
    if (pW && pH) setWithRuller(resolveRuller(num(sheetH), num(sheetW), pW, pH));
  };

  const reset = () => {
    setProductW('');
    setProductH('');
    setSheetW('');
    setSheetH('');
    setRun('');
    setMaterial('');
    setThickness('');
    setWithRuller(true);
    setHistory([]);
    setProResult(null);
    setError('');
    setNotice('');
    setMode('simple');
    setProFormats([{ id: 'f1', w: 0, h: 0, rotate: true }]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* не критично */
    }
  };

  const updateProFormat = (id: string, patch: Partial<ProFormat>) => {
    setProFormats((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    setProResult(null);
  };

  const addProFormat = () => {
    setProFormats((prev) => [
      ...prev,
      { id: `f${Date.now().toString(36)}`, w: pW || 0, h: pH || 0, rotate: true },
    ]);
    setProResult(null);
  };

  const removeProFormat = (id: string) => {
    setProFormats((prev) => (prev.length === 1 ? prev.map((f) => ({ ...f, w: 0, h: 0 })) : prev.filter((f) => f.id !== id)));
    setProResult(null);
  };

  // ── Итоговые строки ──────────────────────────────────────────────────────
  // Толщина стопы: берём из поля «Толщина листа, мкм» (подставляется из
  // материала, но правится руками). Иначе без выбранного материала стопку
  // посчитать нечем, а она нужна и в окне, и в распечатке.
  const thicknessUm = num(thickness);
  const stackMm = (sheets: number): number | null =>
    thicknessUm > 0 && sheets > 0 ? Math.round((sheets * thicknessUm) / 1000) : null;

  const summary = useMemo(() => {
    if (mode === 'pro') {
      if (!proResult || !proResult.placements.length) return [];
      const counts = proResult.perFormat.filter((f) => f.count > 0);
      const minPer = counts.length ? Math.min(...counts.map((f) => f.count)) : 0;
      const lines: Array<{ label: string; value: string; strong?: boolean }> = [];
      if (runValue > 0 && minPer > 0) {
        const sheets = Math.ceil(runValue / minPer);
        lines.push({ label: 'Больших листов', value: `${sheets} шт.`, strong: true });
        const stack = stackMm(sheets);
        if (stack !== null) lines.push({ label: 'Толщина стопы', value: `${stack} мм` });
      }
      return lines;
    }

    if (!layout || !layout.fits) return [];
    const lines: Array<{ label: string; value: string; strong?: boolean }> = [];
    if (runValue > 0 && layout.amount > 0) {
      const sheets = Math.ceil(runValue / layout.amount);
      lines.push({ label: 'Больших листов', value: `${sheets} шт.`, strong: true });
      const stack = stackMm(sheets);
      if (stack !== null) lines.push({ label: 'Толщина стопы', value: `${stack} мм` });
    }
    return lines;
  }, [mode, proResult, layout, runValue, thicknessUm]);

  // ── Печать ───────────────────────────────────────────────────────────────
  const handlePrint = async () => {
    if (!cW || !cH) return;
    setIsPrinting(true);
    setNotice('');
    try {
      const html = buildPrintPage({
        orderNumber,
        client,
        sheet: { w: cW, h: cH },
        mode,
        product: { w: pW, h: pH },
        layout,
        proResult,
        proFormats,
        run: runValue,
        material,
        thicknessUm,
        svg,
      });

      if (window.kabalAPI?.printCutLayout) {
        const result = await window.kabalAPI.printCutLayout({ html, title: `Раскрой ${orderNumber}` });
        if (!result.success) setNotice(result.error || 'Не удалось отправить на печать');
      } else {
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
  };

  const productInvalid = !pW || !pH;
  const sheetInvalid = !cW || !cH;

  return (
    <ModalShell className="pc-modal">
        <div className="modal-header">
          <div>
            <h2>Раскрой бумаги · заявка № {orderNumber}</h2>
            <p className="modal-sub">
              {client} · {mode === 'pro' ? 'несколько форматов на листе' : 'одно изделие на листе'}
            </p>
          </div>
          <button className="btn-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body pc-body">
          {/* ── Левая колонка: ввод и результат ── */}
          <div className="pc-col">
            {mode === 'simple' ? (
              <>
                <div className="pc-section">
                  <h3>Требуемый формат, мм</h3>
                  <div className="pc-row">
                    <input
                      className="pc-input"
                      inputMode="numeric"
                      placeholder="ширина"
                      value={productW}
                      onChange={(e) => setProductW(e.target.value.replace(/\D/g, ''))}
                    />
                    <span className="pc-sep">×</span>
                    <input
                      className="pc-input"
                      inputMode="numeric"
                      placeholder="высота"
                      value={productH}
                      onChange={(e) => setProductH(e.target.value.replace(/\D/g, ''))}
                    />
                    <button className="pc-swap" onClick={swapProduct} title="Повернуть изделие">
                      <ArrowLeftRight size={15} />
                    </button>
                  </div>
                </div>

                <div className="pc-section">
                  <h3>Формат бумаги (лист), мм</h3>
                  <div className="pc-row">
                    <input
                      className="pc-input"
                      inputMode="numeric"
                      placeholder="ширина"
                      value={sheetW}
                      onChange={(e) => setSheetW(e.target.value.replace(/\D/g, ''))}
                    />
                    <span className="pc-sep">×</span>
                    <input
                      className="pc-input"
                      inputMode="numeric"
                      placeholder="высота"
                      value={sheetH}
                      onChange={(e) => setSheetH(e.target.value.replace(/\D/g, ''))}
                    />
                    <button className="pc-swap" onClick={swapSheet} title="Повернуть лист">
                      <ArrowLeftRight size={15} />
                    </button>
                  </div>
                  <div className="pc-presets">
                    {SHEET_PRESETS.map(([w, h]) => {
                      const active = (cW === w && cH === h) || (cW === h && cH === w);
                      return (
                        <button
                          key={`${w}x${h}`}
                          className={`pc-chip ${active ? 'active' : ''}`}
                          onClick={() => applySheet(w, h)}
                        >
                          {w} × {h}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pc-section pc-result-box">
                  <h3>Результат</h3>
                  <div className="pc-result-line pc-result-main">
                    <span>Штук с листа:</span>
                    <b>{layout && layout.fits ? layout.amount : '—'}</b>
                  </div>
                  <div className="pc-result-pair">
                    <div className="pc-result-line">
                      <span>Процент отходов:</span>
                      <b>{layout && layout.fits ? fmtWaste(layout.waste) : '—'}</b>
                    </div>
                    <div className="pc-result-line">
                      <span>Допустимые зазоры:</span>
                      <b>{layout && layout.fits ? `${layout.outline} мм` : '—'}</b>
                    </div>
                  </div>
                  <label className="pc-check">
                    <input type="checkbox" checked={withRuller} onChange={(e) => setWithRuller(e.target.checked)} />
                    Резать с учетом долевой
                  </label>
                  {layout && layout.fits && <div className="pc-mode-note">{layout.mode}</div>}
                </div>
              </>
            ) : (
              <>
                <div className="pc-section">
                  <h3>Формат бумаги (лист), мм</h3>
                  <div className="pc-row">
                    <input
                      className="pc-input"
                      inputMode="numeric"
                      placeholder="ширина"
                      value={sheetW}
                      onChange={(e) => setSheetW(e.target.value.replace(/\D/g, ''))}
                    />
                    <span className="pc-sep">×</span>
                    <input
                      className="pc-input"
                      inputMode="numeric"
                      placeholder="высота"
                      value={sheetH}
                      onChange={(e) => setSheetH(e.target.value.replace(/\D/g, ''))}
                    />
                    <button className="pc-swap" onClick={swapSheet} title="Повернуть лист">
                      <ArrowLeftRight size={15} />
                    </button>
                  </div>
                  <div className="pc-presets">
                    {SHEET_PRESETS.map(([w, h]) => {
                      const active = (cW === w && cH === h) || (cW === h && cH === w);
                      return (
                        <button
                          key={`${w}x${h}`}
                          className={`pc-chip ${active ? 'active' : ''}`}
                          onClick={() => applySheet(w, h)}
                        >
                          {w} × {h}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pc-section">
                  <div className="pc-section-head">
                    <h3>Форматы на листе</h3>
                    <button className="btn-add-paper" onClick={addProFormat}>
                      + Добавить формат
                    </button>
                  </div>
                  <div className="pc-formats">
                    <div className="pc-format-head">
                      <span>Ширина</span>
                      <span>Высота</span>
                      <span>Поворот</span>
                      <span />
                    </div>
                    {proFormats.map((f) => (
                      <div className="pc-format-row" key={f.id}>
                        <input
                          className="pc-input"
                          inputMode="numeric"
                          placeholder="ширина"
                          value={f.w || ''}
                          onChange={(e) => updateProFormat(f.id, { w: num(e.target.value) })}
                        />
                        <input
                          className="pc-input"
                          inputMode="numeric"
                          placeholder="высота"
                          value={f.h || ''}
                          onChange={(e) => updateProFormat(f.id, { h: num(e.target.value) })}
                        />
                        <button
                          className={`pc-swap ${f.rotate ? 'on' : ''}`}
                          onClick={() => updateProFormat(f.id, { rotate: !f.rotate })}
                          title={f.rotate ? 'Поворот разрешён' : 'Только как есть'}
                        >
                          <RotateCw size={15} />
                        </button>
                        <button className="btn-remove-paper" onClick={() => removeProFormat(f.id)}>✕</button>
                      </div>
                    ))}
                  </div>
                  <p className="pc-hint">
                    Одна строка — один формат. Количество экземпляров программа подбирает автоматически:
                    поровну, затем добивает свободное место.
                  </p>
                  {proResult && proResult.perFormat.some((f) => f.count > 0) && (
                    <div className="pc-pro-summary">
                      {proResult.perFormat
                        .filter((f) => f.count > 0)
                        .map((f) => (
                          <span key={f.formatId} className="pc-pro-item">
                            {f.w}×{f.h} — <b>{f.count} шт.</b>
                          </span>
                        ))}
                    </div>
                  )}
                  {proResult?.truncated && (
                    <p className="pc-hint pc-hint-warn">
                      Перебор раскладки остановлен по лимиту — результат близок к лучшему, но не гарантированно оптимален.
                    </p>
                  )}
                </div>
              </>
            )}

            <div className="pc-actions">
              <button
                className={`pc-btn ${mode === 'pro' ? 'pc-btn-on' : ''}`}
                onClick={() => {
                  if (mode === 'pro') {
                    setMode('simple');
                    setProResult(null);
                  } else {
                    setMode('pro');
                    setProFormats((prev) =>
                      prev.map((f, i) => (i === 0 && !f.w ? { ...f, w: pW, h: pH } : f)),
                    );
                  }
                }}
              >
                {mode === 'pro' ? 'Простой режим' : 'Про режим'}
              </button>
              <button className="pc-btn" onClick={reset}>Очистить</button>
              <button className="pc-btn" onClick={handlePrint} disabled={isPrinting}>
                <PrinterIcon size={14} /> Печать
              </button>
              <button
                className="pc-btn pc-btn-main"
                onClick={mode === 'pro' ? calculatePro : undefined}
                disabled={calculating}
              >
                {calculating ? <Loader2 size={14} className="pc-spin" /> : null}
                {mode === 'pro' ? 'Рассчитать' : 'Пересчитать'}
              </button>
            </div>

            {(error || notice) && <div className={`pc-alert ${error ? 'pc-alert-error' : ''}`}>{error || notice}</div>}
            {(productInvalid || sheetInvalid) && mode === 'simple' && (
              <div className="pc-alert">⚠ Проверьте, пожалуйста, правильность введённых данных</div>
            )}

            {/* Таблица сравнения листов — слева, рядом с кнопками: справа она
                упиралась в футер и обрезалась */}
            {mode === 'simple' && compareRows.length > 0 && (
              <div className="pc-compare">
                <table>
                  <thead>
                    <tr>
                      <th rowSpan={2}>Лист, мм</th>
                      <th colSpan={2}>По долевой</th>
                      <th colSpan={2}>Без долевой</th>
                    </tr>
                    <tr>
                      <th>Штуки</th>
                      <th>Отход, %</th>
                      <th>Штуки</th>
                      <th>Отход, %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareRows.map((row) => {
                      const bad = !row.straight.fits && !row.mixed.fits;
                      return (
                        <tr
                          key={`${row.w}x${row.h}`}
                          className={`${row.isCurrent ? 'sel' : ''} ${bad ? 'bad' : ''}`}
                          onClick={() => applySheet(row.w, row.h)}
                          title="Подставить этот лист"
                        >
                          <td>{row.w}×{row.h}</td>
                          <td>{row.straight.fits ? row.straight.amount : '—'}</td>
                          <td>{row.straight.fits ? fmtWaste(row.straight.waste) : '—'}</td>
                          <td>{row.mixed.fits ? row.mixed.amount : '—'}</td>
                          <td>{row.mixed.fits ? fmtWaste(row.mixed.waste) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Правая колонка: бумага, тираж, эскиз ── */}
          <div className="pc-col pc-col-preview">
            <div className="pc-fields">
              <label className="pc-field">
                <span>Нужно листов, шт</span>
                <input
                  className="pc-input pc-input-full"
                  inputMode="numeric"
                  placeholder="из предрасчёта"
                  value={run}
                  onChange={(e) => setRun(e.target.value.replace(/\D/g, ''))}
                />
              </label>
              <label className="pc-field">
                <span>Материал</span>
                <select
                  className="pc-input pc-input-full"
                  value={material}
                  onChange={(e) => {
                    const next = e.target.value;
                    setMaterial(next);
                    // Толщина листа идёт из материала, но поле остаётся
                    // редактируемым: у нестандартной бумаги своя толщина.
                    const info = MATERIALS.find((m) => m.label === next);
                    setThickness(info ? String(info.microns) : '');
                  }}
                >
                  <option value="">— выберите материал —</option>
                  {Array.from(new Set(MATERIALS.map((m) => m.group))).map((group) => (
                    <optgroup key={group} label={group}>
                      {MATERIALS.filter((m) => m.group === group).map((m) => (
                        <option key={m.label} value={m.label}>{m.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="pc-field">
                <span>Толщина листа, мкм</span>
                <input
                  className="pc-input pc-input-full"
                  inputMode="numeric"
                  placeholder="например 285 — для расчёта толщины стопы"
                  value={thickness}
                  onChange={(e) => setThickness(e.target.value.replace(/[^\d]/g, ''))}
                />
              </label>
            </div>
            <p className="pc-hint">
              «Нужно листов» — сколько листов заказа требует печати (берётся из «Предрасчёта»).
              Это не тираж изделий: при 300 открытках и 6 на листе нужно 50 листов, и уже они
              раскраиваются с большого листа.
            </p>

            {summary.length > 0 && (
              <div className="pc-summary">
                {summary.map((line) => (
                  <div key={line.label} className={`pc-summary-line ${line.strong ? 'pc-summary-strong' : ''}`}>
                    <span>{line.label}</span>
                    <b>{line.value}</b>
                  </div>
                ))}
                {material && <div className="pc-summary-sub">Материал: {material}</div>}
              </div>
            )}

            <div className="pc-preview">
              {calculating && (
                <div className="pc-loading">
                  <Loader2 size={22} className="pc-spin" />
                  <span>Пересчитываем раскрой…</span>
                </div>
              )}
              {svg && <div className="pc-svg" dangerouslySetInnerHTML={{ __html: svg }} />}
              {mode === 'pro' && proResult && proResult.placements.length > 0 && (
                <div className="pc-legend">
                  {proFormats
                    .filter((f) => f.w > 0 && f.h > 0)
                    .map((f, i) => (
                      <span key={f.id} className="pc-legend-item">
                        <i style={{ background: FORMAT_COLORS[i % FORMAT_COLORS.length] }} />
                        {f.label || `${f.w}×${f.h}`} — {proResult.counts[f.id] || 0} шт.
                      </span>
                    ))}
                </div>
              )}
              {mode === 'simple' && layout && layout.fits && (
                <div className="pc-legend">
                  <span className="pc-legend-item">
                    Изделие {pW}×{pH} мм · лист {cW}×{cH} мм · {layout.amount} шт · {layout.mode}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <span className="complete-footer-note">
            {mode === 'pro'
              ? 'ПРО режим: количество изделий каждого формата подбирается автоматически'
              : 'Клик по строке таблицы подставляет лист'}
          </span>
          <button className="btn-secondary" onClick={onClose}>
            <X size={15} /> Закрыть
          </button>
        </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Печатная страница
// ─────────────────────────────────────────────────────────────────────────────

interface PrintData {
  orderNumber: string;
  client: string;
  sheet: { w: number; h: number };
  mode: 'simple' | 'pro';
  product: { w: number; h: number };
  layout: SimpleLayout | null;
  proResult: ProResult | null;
  proFormats: ProFormat[];
  run: number;
  material: string;
  thicknessUm: number;
  svg: string;
}

export function buildPrintPage(data: PrintData): string {
  const { orderNumber, client, sheet, mode, product, layout, proResult, run, material, thicknessUm, svg } = data;

  const rows: string[] = [];
  let totalSheets = 0;

  if (mode === 'pro' && proResult) {
    const counts = proResult.perFormat.filter((f) => f.count > 0);
    const minPer = counts.length ? Math.min(...counts.map((f) => f.count)) : 0;
    if (run > 0 && minPer > 0) totalSheets = Math.ceil(run / minPer);
    for (const f of counts) {
      rows.push(`<tr><td>${f.w}×${f.h}</td><td>${f.count}</td></tr>`);
    }
  } else if (layout && layout.fits) {
    if (run > 0) totalSheets = Math.ceil(run / layout.amount);
    // Без колонки «Формат»: размер изделия и так один, дублировать его незачем.
    rows.push(`<tr><td>${product.w}×${product.h}</td><td>${layout.amount}</td></tr>`);
  }

  // Толщина стопы — из поля «Толщина листа, мкм»: без выбранного материала
  // её всё равно надо показать резчику.
  const stack = thicknessUm > 0 && totalSheets > 0 ? Math.round((totalSheets * thicknessUm) / 1000) : null;

  const summaryLines = [
    `<b>Штук с листа:</b> ${mode === 'pro' && proResult ? proResult.placements.length : layout?.fits ? layout.amount : '—'}`,
    mode === 'simple' && layout?.fits ? `<b>Отход:</b> ${fmtWaste(layout.waste)}` : '',
    run > 0 ? `<b>Нужно листов:</b> ${run} шт.` : '',
    totalSheets > 0 ? `<b>Больших листов:</b> ${totalSheets}` : '',
    stack !== null ? `<b>Толщина стопы:</b> ${stack} мм` : '',
    material ? `<b>Материал:</b> ${esc(material)}` : '',
  ].filter(Boolean);

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Раскрой ${esc(orderNumber)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #000; margin: 0; font-size: 11pt; }
  h1 { font-size: 16pt; margin: 0 0 1.5mm; }
  .sub { font-size: 10pt; color: #333; margin-bottom: 4mm; }
  .sheet { text-align: center; margin: 2mm 0 4mm; }
  .sheet svg { width: 118mm; height: auto; }
  .sum { display: flex; flex-wrap: wrap; gap: 2mm 6mm; font-size: 10.5pt; margin-bottom: 3mm; }
  table { border-collapse: collapse; width: 100%; font-size: 10pt; }
  th, td { border: 1px solid #444; padding: 1.4mm 2mm; text-align: left; }
  th { background: #eee; }
  .note { margin-top: 3mm; font-size: 8.5pt; color: #555; }
</style></head><body>
<h1>Раскрой бумаги — заявка № ${esc(orderNumber)}</h1>
<div class="sub">${esc(client)} · лист ${sheet.w}×${sheet.h} мм · изделие ${
    mode === 'pro'
      ? 'несколько форматов'
      : product.w && product.h
        ? `${product.w}×${product.h} мм`
        : '—'
  }</div>
<div class="sheet">${svg}</div>
<div class="sum">${summaryLines.join(' ')}</div>
<table><thead><tr><th>Размер изделия, мм</th><th>На листе</th></tr></thead><tbody>${rows.join('')}</tbody></table>
<div class="note">${mode === 'pro'
    ? 'ПРО режим: количества изделий подобраны автоматически по минимуму резов и свободного места.'
    : 'Простой режим: ' + esc(layout?.mode || '')}
</div>
</body></html>`;
}
