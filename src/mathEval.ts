// src/mathEval.ts
// Встроенный калькулятор для числовых полей: «155+53» → «208».
// Пользователь вводит цифры с + - / *, поле само показывает результат
// (подсказка «= 208») и на уходе из поля подставляет посчитанное значение.
//
// Никаких eval / new Function — маленький рекурсивный парсер с приоритетами.
// Поддерживается: цифры, десятичная запятая/точка, + - * /, круглые скобки,
// «×»/«x»/«х» как умножение, пробелы, унарный минус/плюс.

const EXPR_RE = /[+\-*/×хx]/;

/** Посчитать арифметическое выражение. null — не выражение или ошибка. */
export function mathEval(input: string): number | null {
  const s = input
    .trim()
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/[×хx]/g, '*');
  if (!s || !EXPR_RE.test(s)) return null;

  const tokens = s.match(/[+\-*/()]|(?:\d+(?:\.\d*)?|\.\d+)/g);
  if (!tokens || !tokens.length) return null;

  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const next = (): string | undefined => tokens[pos++];

  function parseExpr(): number | null {
    let left = parseTerm();
    if (left === null) return null;
    while (peek() === '+' || peek() === '-') {
      const op = next() as string;
      const right = parseTerm();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number | null {
    let left = parseFactor();
    if (left === null) return null;
    while (peek() === '*' || peek() === '/') {
      const op = next() as string;
      const right = parseFactor();
      if (right === null) return null;
      if (op === '/') {
        if (right === 0) return null;
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  function parseFactor(): number | null {
    const t = peek();
    if (t === '+' || t === '-') {
      next();
      const v = parseFactor();
      if (v === null) return null;
      return t === '-' ? -v : v;
    }
    if (t === '(') {
      next();
      const v = parseExpr();
      if (v === null || next() !== ')') return null;
      return v;
    }
    if (t !== undefined && /^\d/.test(t)) {
      next();
      return parseFloat(t);
    }
    return null;
  }

  const result = parseExpr();
  if (result === null || pos !== tokens.length) return null;
  return Number.isFinite(result) ? result : null;
}

/** Красивый вывод результата: без хвоста машинной точности (0.30000000000000004 → 0.3). */
export function formatMathResult(n: number): string {
  return String(parseFloat(n.toPrecision(12)));
}

/**
 * Подсказка для поля: { result: '208' } — выражения посчитались,
 * { error: true } — похоже на выражение, но не считается («155+»),
 * { result: null, error: false } — обычное число/текст, калькулятор не трогает.
 */
export function mathHint(value: string): { result: string | null; error: boolean } {
  const s = value.trim();
  if (!s || !EXPR_RE.test(s)) return { result: null, error: false };
  const n = mathEval(s);
  if (n === null) return { result: null, error: true };
  return { result: formatMathResult(n), error: false };
}

/** Подставить результат выражения вместо строки («155+53» → «208»); иначе строка как есть. */
export function normalizeMathField(value: string): string {
  const hint = mathHint(value);
  return hint.result !== null ? hint.result : value;
}