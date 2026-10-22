// ─────────────────────────────────────────────────────────────────────────────
// Строки бумаги из ТЗ — один источник для карточки заявки и окна завершения.
//
// Зачем модуль: и блок «Бумага» в карточке, и форма завершения предзаполняют
// поля F/G из текста ТЗ. Пока логика была продублирована, они расходились:
// в окне завершения строк было несколько, а в карточке — одна пустая.
//
// Правило: один вид бумаги = одна строка. Виды берутся из тегов категории
// `density` и из явных упоминаний плотности в тексте («350 г/м²», «300гр»,
// «80 г»). Количество листов НЕ заполняется — его ставит печатник, расход
// бумаги из ТЗ не выводится.
// ─────────────────────────────────────────────────────────────────────────────

import { TAG_BY_ID } from './dictionaries.ts';
import type { ParsedTz } from './parseTz.ts';

export interface PaperRow {
  qty: string;
  density: string;
}

/** Плотности/виды бумаги из ТЗ: по строке на каждый найденный вид. */
export function paperRowsFromTz(parsed: ParsedTz): PaperRow[] {
  const densitySet = new Set<string>();

  for (const tagId of parsed.tags) {
    const tag = TAG_BY_ID[tagId];
    if (tag?.category === 'density') densitySet.add(tag.label.replace(/\s*г\/м²$/, ''));
  }

  // Плюс значения вида «350 гр», «300гр», «80 г/м2» из текста — тег ловит не всё
  const densityMatches = parsed.lines.join(' ').matchAll(/(\d{2,3})\s*(?:г\/м²|г\/м2|гр(?![а-яё])|г(?![а-яё]))/gi);
  for (const m of densityMatches) densitySet.add(m[1]);

  if (densitySet.size) {
    return Array.from(densitySet).map((d) => ({ qty: '', density: d }));
  }

  // Плотности не нашлись — хотя бы вид бумаги из строки «Бумага: ...»
  return [{ qty: '', density: parsed.paper !== 'Не указана' ? parsed.paper : '' }];
}
