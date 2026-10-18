// ─────────────────────────────────────────────────────────────────────────────
// Определение ламинации по тексту ТЗ.
//
// Почему отдельный модуль, а не шаблон в списке тегов:
// в составных заявках слово «без ламинации» относится к ЧАСТИ тиража.
// Пример — заявка 5808: «11 карточек с рецептами с ламинацией + 10 карточек
// без ламинации». Простое правило «в тексте есть „без ламинации“» помечало
// всю заявку как без ламинации, хотя матовая ламинация в ней есть.
//
// Правило: ламинация есть, если найдено упоминание, которое НЕ отрицается
// («без ламинации», «ламинация: нет»). Вид ламинации ищется только рядом
// с упоминанием — иначе «мелованная матовая … лам. 1+1 глян.» давала бы
// ложную матовую (там «матовая» про бумагу).
// ─────────────────────────────────────────────────────────────────────────────

export type LaminationKind = 'glossy' | 'matte' | 'soft-touch';

export interface LaminationInfo {
  /** Есть ли в заявке ламинация вообще. */
  has: boolean;
  /** Найденные виды ламинации. */
  kinds: LaminationKind[];
  /** Короткая выдержка из ТЗ для чипа в строке. */
  summary: string;
}

const SOFT_RE = /софт[-\s]?тач|soft[-\s]?touch/i;
const GLOSS_RE = /(?<![а-яё])глян|(?<![а-яё])глан|gloss/i;
const MATTE_RE = /(?<![а-яё])мат(?!ериал)/i;

/** Вид ламинации последним словом перед упоминанием: «матовая ламинация». */
const SOFT_BEFORE_RE = /(?:^|[^а-яё])(?:софт[-\s]?тач|soft[-\s]?touch)\s*$/i;
const GLOSS_BEFORE_RE = /(?:^|[^а-яё])глян[а-яё]*\.?\s*$/i;
const MATTE_BEFORE_RE = /(?:^|[^а-яё])мат(?!ериал)[а-яё]*\.?\s*$/i;

/** «ламинация», «ламинацией», «ламинирование», «лам.», «лам 1+1» */
const MENTION_RE = /ламин[а-яё]*|лам(?=[\s.]|\d|$)/gi;

/** Отрицание сразу после упоминания: «ламинация: без ламинации», «ламинация: нет». */
const NEGATED_AFTER_RE = /^[\s:–—-]{0,4}(без|нет|отсутству|не\s*требу|не\s*нужн)/i;

function buildSummary(line: string, start: number): string {
  const rest = line.slice(start).trim();
  const cut = rest.search(/[,;/]/);
  const frag = (cut === -1 ? rest : rest.slice(0, cut)).trim();
  return frag.length > 60 ? `${frag.slice(0, 57).trimEnd()}…` : frag;
}

/**
 * Разбирает текст ТЗ и возвращает сведения о ламинации.
 * @param rawText — ТЗ целиком (без первой строки с путём — она не важна)
 */
export function detectLamination(rawText: string): LaminationInfo {
  const text = String(rawText || '');
  const kinds = new Set<LaminationKind>();
  let has = false;
  let summary = '';

  const re = new RegExp(MENTION_RE.source, 'gi');
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;

    const before = text.slice(Math.max(0, start - 10), start);
    const after = text.slice(end, end + 50);

    // «без ламинации» — это отсутствие ламинации, а не её наличие
    if (/без\s*$/i.test(before) || NEGATED_AFTER_RE.test(after)) continue;

    has = true;

    const lineStart = text.lastIndexOf('\n', start) + 1;
    const lineEndIdx = text.indexOf('\n', end);
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
    const line = text.slice(lineStart, lineEnd);

    // Вид ПОСЛЕ упоминания: «лам. 1+1 мат. 30 мк», «ламинация глянцевая»
    const afterWin = line.slice(end - lineStart, Math.min(line.length, end - lineStart + 45));
    if (SOFT_RE.test(afterWin)) kinds.add('soft-touch');
    if (GLOSS_RE.test(afterWin)) kinds.add('glossy');
    if (MATTE_RE.test(afterWin)) kinds.add('matte');

    // Вид ПЕРЕД упоминанием, но только если это последнее слово перед ним:
    // «матовая ламинация» — да, «матовая 4+4 лам.» — нет (там «матовая» про бумагу).
    const beforeTail = line.slice(Math.max(0, start - lineStart - 22), start - lineStart);
    if (SOFT_BEFORE_RE.test(beforeTail)) kinds.add('soft-touch');
    if (GLOSS_BEFORE_RE.test(beforeTail)) kinds.add('glossy');
    if (MATTE_BEFORE_RE.test(beforeTail)) kinds.add('matte');

    if (!summary) summary = buildSummary(line, start - lineStart);
  }

  // «софт-тач» без слова «ламинация» — всё равно ламинация
  if (!has && SOFT_RE.test(text) && !/без\s*софт/i.test(text)) {
    has = true;
    kinds.add('soft-touch');
  }

  return { has, kinds: [...kinds], summary };
}
