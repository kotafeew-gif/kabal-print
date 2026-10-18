import { extractTags } from './dictionaries.ts';

export interface ParsedTz {
  product: string;
  quantity: string;
  paper: string;
  lamination: string;
  color: string;
  postpress: string[];
  tags: string[];
  folderPath: string;
  lines: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ВАЖНО: в JavaScript \b (граница слова) работает только с латиницей и цифрами,
// поэтому /\bбуклет\b/ НЕ находит «буклет». Вместо \b используется (?![а-яё]) —
// проверка, что после слова не идёт ещё одна кириллическая буква.
// ─────────────────────────────────────────────────────────────────────────────

/** Путь к папке заказа: «\\Print\2022\...» или «D:\...». Всегда первая строка ТЗ. */
const PATH_RE = /^([A-Za-z]:[\\/]|\\\\|\/\/)/;

export function extractFolderPath(text: string): string {
  const first = String(text || '').split(/\n/).map((l) => l.trim()).find(Boolean) || '';
  return PATH_RE.test(first) ? first.replace(/[\\/]+$/, '') : '';
}

/** Нормализованный вид продукции: первое совпадение по ключевым словам. */
const PRODUCT_MATCHERS: Array<{ re: RegExp; name: string }> = [
  { re: /визитк/i, name: 'Визитки' },
  { re: /листовк/i, name: 'Листовки' },
  { re: /буклет/i, name: 'Буклеты' },
  { re: /флаер|флайер/i, name: 'Флаеры' },
  { re: /брошюр/i, name: 'Брошюры' },
  { re: /каталог/i, name: 'Каталоги' },
  { re: /воблер|хенгер/i, name: 'Воблеры' },
  { re: /бейдж/i, name: 'Бейджи' },
  { re: /календар/i, name: 'Календари' },
  { re: /плакат|постер/i, name: 'Плакаты' },
  { re: /накле|стикер|этикетк/i, name: 'Наклейки' },
  { re: /открытк/i, name: 'Открытка' },
  { re: /конверт/i, name: 'Конверты' },
  { re: /сертификат/i, name: 'Сертификаты' },
  { re: /грамот|диплом/i, name: 'Грамоты' },
  { re: /бланк/i, name: 'Бланки' },
  { re: /папк/i, name: 'Папки' },
  { re: /блокнот/i, name: 'Блокноты' },
  { re: /кубарик/i, name: 'Кубарики' },
  { re: /пакет/i, name: 'Бумажные Пакеты' },
  { re: /меню/i, name: 'Меню' },
];

/** Единицы тиража → короткая подпись. */
const QTY_UNITS: Array<{ re: RegExp; label: string }> = [
  { re: /штук|штуки|штука|шт(?![а-яё])/i, label: 'шт' },
  { re: /экземпляр|экз(?![а-яё])/i, label: 'экз' },
  { re: /комплект|компл(?![а-яё])/i, label: 'компл' },
  { re: /листов|лист(?![а-яё])/i, label: 'лист' },
];

/**
 * Достаёт «число + единица» из текста и нормализует к виду «100 шт».
 * ВАЖНО: используем [ \t\u00A0] вместо \s — \s захватывает перевод строки,
 * из-за чего число склеивалось из разных строк («6» + «\n» + «24»).
 */
const QTY_RE = /(\d[\d \t\u00A0]*)[ \t\u00A0]*(штук|штуки|штука|шт|экземпляр\w*|экз|комплект\w*|компл|листов|лист)(?![а-яё])/i;

function matchQty(source: string): string {
  const m = source.match(QTY_RE);
  if (!m) return '';
  const num = m[1].replace(/[ \t\u00A0]+/g, ' ').trim();
  const unit = QTY_UNITS.find((u) => u.re.test(m[2]))?.label || m[2].toLowerCase();
  return `${num} ${unit}`;
}

export function parseQuantity(text: string): string {
  const lines = String(text || '').split('\n');

  // 1) Приоритет — строка, где явно написано «тираж».
  //    Иначе в заявке с составными частями («Вкладыш — 1 шт.») тираж
  //    подхватывался бы из первой попавшейся строки.
  for (const line of lines) {
    if (!/тираж/i.test(line)) continue;

    // «тираж 2 вида по 50 штук» → «2 видов по 50 шт»
    const perKind = line.match(/(\d+)[ \t]*вид\w*[^.\n]{0,25}?по[ \t]*(\d[\d \t\u00A0]*)[ \t]*(штук|штуки|шт|экз|комплект\w*|компл)(?![а-яё])/i);
    if (perKind) {
      const unit = QTY_UNITS.find((u) => u.re.test(perKind[3]))?.label || perKind[3].toLowerCase();
      return `${perKind[1]} видов по ${perKind[2].replace(/[ \t\u00A0]+/g, ' ').trim()} ${unit}`;
    }

    const q = matchQty(line);
    if (q) return q;
  }

  // 2) Фолбэк — любое место в тексте
  return matchQty(text);
}

export function parseTz(text: string, fallbackPaperQty?: string, fallbackPaperType?: string): ParsedTz {
  const allLines = String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);

  // Первая строка — путь к папке заказа. Исключаем её из анализа, иначе слова
  // из имени папки («12.16 пакет крафт») попадают в вид продукции.
  const folderPath = extractFolderPath(text);
  const lines = folderPath ? allLines.slice(1) : allLines;
  const body = lines.join('\n');

  const findValue = (regex: RegExp) => {
    for (const line of lines) {
      if (regex.test(line)) {
        return line.replace(/^[^:]+:\s*/, '').trim();
      }
    }
    return '';
  };

  // Продукция — ищем в первых строках ТЗ (там всегда название изделия).
  // Раньше поиск шёл по всему тексту, и слова из примечаний («пакет», «блок»)
  // перебивали настоящий вид продукции.
  let product = 'Другое';
  let bestIndex = Infinity;
  const head = lines.slice(0, 3).join('\n');
  for (const { re, name } of PRODUCT_MATCHERS) {
    const m = head.match(re);
    if (m && m.index !== undefined && m.index < bestIndex) {
      bestIndex = m.index;
      product = name;
    }
  }
  // Фолбэк — по всему тексту, если в первых строках ничего не нашли
  if (product === 'Другое') {
    for (const { re, name } of PRODUCT_MATCHERS) {
      if (re.test(body)) { product = name; break; }
    }
  }

  // Тираж
  let quantity = parseQuantity(body);
  if (!quantity && fallbackPaperQty) {
    // Столбец «Кол-во бумаги» может содержать несколько значений через перевод
    // строки (обложка + блок). Приводим к одной строке.
    quantity = fallbackPaperQty.replace(/[\r\n]+/g, ', ').replace(/\s*,\s*/g, ', ').trim();
  }

  // Бумага / материал
  let paper = findValue(/бумага|картон|материал/i);
  if (!paper) {
    const paperLine = lines.find((l) => /г\/м²|гр(?![а-яё])|бумага|картон|офсет|мелован|color\s*copy|рафлатак|raflatac|самоклей|крафт|дизайнерск/i.test(l));
    if (paperLine) {
      paper = paperLine.replace(/^[^:]+:\s*/, '').trim();
    }
  }
  if (!paper && fallbackPaperType) {
    paper = fallbackPaperType;
  }

  // Ламинация
  let lamination = findValue(/ламинац/i);
  if (!lamination) {
    const lamLine = lines.find((l) => /ламинац|софт-?тач|soft-?touch|матовая\s*\d|глянцевая\s*\d/i.test(l));
    if (lamLine) {
      lamination = lamLine.replace(/^[^:]+:\s*/, '').trim();
    }
  }
  if (!lamination && /без\s*ламинац|не\s*требуется/i.test(body)) {
    lamination = 'Без ламинации';
  }

  // Цветность
  let color = findValue(/цветность|печать/i);
  if (!color) {
    const colMatch = body.match(/([14]\+[014]|CMYK|черно-бел\w*|полноцвет\w*)/i);
    if (colMatch) color = colMatch[0];
  }

  // Постпечать
  const postpressItems: string[] = [];
  if (/биговк/i.test(body)) postpressItems.push('Биговка');
  if (/фальцовк/i.test(body)) postpressItems.push('Фальцовка');
  if (/скруглен/i.test(body)) postpressItems.push('Скругление углов');
  if (/люверс/i.test(body)) postpressItems.push('Люверсы');
  if (/пружин/i.test(body)) postpressItems.push('Пружина');
  if (/плоттер/i.test(body)) postpressItems.push('Плоттер');
  if (/сверлен/i.test(body)) postpressItems.push('Сверление');
  if (/порезк|резк/i.test(body)) postpressItems.push('Порезка');

  return {
    product,
    quantity: quantity || '—',
    paper: paper || 'Не указана',
    lamination: lamination || '—',
    color: color || '',
    postpress: postpressItems,
    tags: extractTags(body, [fallbackPaperType, fallbackPaperQty].filter(Boolean).join(' ')),
    folderPath,
    lines,
  };
}
