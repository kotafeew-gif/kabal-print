// ─────────────────────────────────────────────────────────────────────────────
// Справочники продукции, работ и материалов.
// Источник данных: проект D:\AI\prog\printing (src/constants.ts, src/utils.ts).
// Данные перенесены как есть, исходный проект не изменялся.
// ─────────────────────────────────────────────────────────────────────────────

import type { LaminationKind } from './lamination.ts';

export type TagCategory = 'product' | 'operation' | 'material' | 'density' | 'lamination';

export interface TagDef {
  id: string;
  label: string;
  category: TagCategory;
  /** Регулярные выражения для поиска тега в тексте ТЗ. Без флага /g — иначе ломается .test() */
  patterns: RegExp[];
  /** Тег вычисляется отдельно (ламинация), а не шаблоном по тексту. */
  computed?: boolean;
}

export const CATEGORY_LABELS: Record<TagCategory, string> = {
  product: 'Продукция',
  operation: 'Работы и операции',
  material: 'Материалы',
  density: 'Плотность',
  lamination: 'Ламинация',
};

export const CATEGORY_ORDER: TagCategory[] = ['product', 'operation', 'material', 'density', 'lamination'];

// ─── Продукция (DEFAULT_PRODUCT_TYPES) ───────────────────────────────────────
export const PRODUCT_TYPES = [
  'Визитки', 'Листовки', 'Буклеты', 'Флаеры', 'Брошюры', 'Каталоги',
  'Воблеры', 'Бейджи', 'Календари', 'Плакаты', 'Наклейки', 'Открытка',
  'Конверты', 'Сертификаты', 'Бланки', 'Папки', 'Блокноты', 'Кубарики',
  'Бумажные Пакеты', 'Другое...',
];

// ─── Операции / работы ───────────────────────────────────────────────────────
// DEFAULT_POST_PROCESSING + операции из utils.ts (биговка, фальцовка, сшивка,
// каширование, плоттерная резка, люверсы, ручки, ножка воблера и т.д.)
export const OPERATION_NAMES = [
  'Биговка',
  'Фальцовка',
  'Перфорация',
  'Сверление отверстий',
  'Тиснение фольгой',
  'Фольгирование',
  'УФ-лак',
  'УФ-лак текстурный',
  'Прикатка магнита',
  'Скругление углов',
  'Раскрой IECHO',
  'Плоттерная резка',
  'Порезка',
  'Вырубка',
  'Сортировка / упаковка',
  'Сшивка на скобу',
  'Термобиндер',
  'PUR-клей',
  'Пружина',
  'Каширование',
  'Слим-каширование',
  'Люверсы',
  'Приклейка ножки',
  'Ручки',
  'Крепление',
  'Отверстие под клипсу',
  'Персонализация',
];

// ─── Материалы ───────────────────────────────────────────────────────────────
// PAPER_TYPE_OPTIONS + STICKER_MATERIALS + FORSAC/KASHUROVKA + библиотека бумаг
export const MATERIAL_NAMES = [
  'Мелованная',
  'Офсетная',
  'Каландр',
  'Картон',
  'Дизайнерская',
  'Крафт',
  'Самоклеящаяся',
  'Полилазер',
  'Color Copy',
  'Raflatac',
  'Переплётный картон',
  'Давальческая',
  'Sirio Color',
  'Touch Cover',
  'Curious Metallic',
  'Nettuno',
  'Constellation',
];

// ─── Плотность (DEFAULT_DENSITIES + библиотека) ──────────────────────────────
export const DENSITIES = ['80', '90', '100', '115', '130', '150', '170', '200', '250', '270', '300', '350', '400'];

// ─── Ламинация (DEFAULT_LAMINATION_KINDS) ────────────────────────────────────
export const LAMINATION_NAMES = ['Глянцевая', 'Матовая', 'Soft-Touch', 'Без ламинации'];

// ─────────────────────────────────────────────────────────────────────────────
// Определения тегов с шаблонами поиска.
// ─────────────────────────────────────────────────────────────────────────────

const p = (...src: string[]): RegExp[] => src.map((s) => new RegExp(s, 'i'));

export const TAGS: TagDef[] = [
  // ── Продукция ──
  { id: 'prod-vizitki', label: 'Визитки', category: 'product', patterns: p('визитк') },
  { id: 'prod-listovki', label: 'Листовки', category: 'product', patterns: p('листовк') },
  { id: 'prod-buklety', label: 'Буклеты', category: 'product', patterns: p('буклет') },
  { id: 'prod-flaery', label: 'Флаеры', category: 'product', patterns: p('флаер', 'флайер') },
  { id: 'prod-broshyury', label: 'Брошюры', category: 'product', patterns: p('брошюр') },
  { id: 'prod-katalogi', label: 'Каталоги', category: 'product', patterns: p('каталог') },
  { id: 'prod-voblery', label: 'Воблеры', category: 'product', patterns: p('воблер') },
  { id: 'prod-beydzhi', label: 'Бейджи', category: 'product', patterns: p('бейдж') },
  { id: 'prod-kalendari', label: 'Календари', category: 'product', patterns: p('календар') },
  { id: 'prod-plakaty', label: 'Плакаты', category: 'product', patterns: p('плакат', 'постер') },
  { id: 'prod-nakleyki', label: 'Наклейки', category: 'product', patterns: p('накле', 'стикер', 'этикетк') },
  { id: 'prod-otkrytka', label: 'Открытка', category: 'product', patterns: p('открытк') },
  { id: 'prod-konverty', label: 'Конверты', category: 'product', patterns: p('конверт') },
  { id: 'prod-sertifikaty', label: 'Сертификаты', category: 'product', patterns: p('сертификат') },
  { id: 'prod-blanki', label: 'Бланки', category: 'product', patterns: p('бланк') },
  { id: 'prod-papki', label: 'Папки', category: 'product', patterns: p('папк') },
  { id: 'prod-bloknoty', label: 'Блокноты', category: 'product', patterns: p('блокнот') },
  { id: 'prod-kubariki', label: 'Кубарики', category: 'product', patterns: p('кубарик') },
  { id: 'prod-pakety', label: 'Бумажные Пакеты', category: 'product', patterns: p('бумажн[а-яё]*\\s+пакет', 'пакет[ыа]\\b') },
  { id: 'prod-gramoty', label: 'Грамоты', category: 'product', patterns: p('грамот') },
  { id: 'prod-menyu', label: 'Меню', category: 'product', patterns: p('меню') },

  // ── Работы и операции ──
  { id: 'op-bigovka', label: 'Биговка', category: 'operation', patterns: p('биговк') },
  { id: 'op-faltsovka', label: 'Фальцовка', category: 'operation', patterns: p('фальцовк', 'фальц[а-яё]*\\s*\\d') },
  { id: 'op-perforatsiya', label: 'Перфорация', category: 'operation', patterns: p('перфорац', 'перфор\\.') },
  { id: 'op-sverlenie', label: 'Сверление отверстий', category: 'operation', patterns: p('сверлен') },
  { id: 'op-tisnenie', label: 'Тиснение фольгой', category: 'operation', patterns: p('тиснен') },
  { id: 'op-folgirovanie', label: 'Фольгирование', category: 'operation', patterns: p('фольгирован') },
  { id: 'op-uv-lak', label: 'УФ-лак', category: 'operation', patterns: p('уф[-\\s]?лак', 'uv[-\\s]?lak') },
  { id: 'op-uv-lak-teksturnyy', label: 'УФ-лак текстурный', category: 'operation', patterns: p('текстурн[а-яё]*\\s*уф', 'уф[^\\n]{0,20}текстурн') },
  { id: 'op-prikatka-magnita', label: 'Прикатка магнита', category: 'operation', patterns: p('прикатк') },
  { id: 'op-skruglenie', label: 'Скругление углов', category: 'operation', patterns: p('скруглен') },
  { id: 'op-raskroy-iecho', label: 'Раскрой IECHO', category: 'operation', patterns: p('раскрой', 'iecho', 'иечо') },
  { id: 'op-plotternaya', label: 'Плоттерная резка', category: 'operation', patterns: p('плоттер') },
  { id: 'op-porezka', label: 'Порезка', category: 'operation', patterns: p('порезк', 'резк[аиу]\\b', 'подрезк') },
  { id: 'op-vyrubka', label: 'Вырубка', category: 'operation', patterns: p('выруб') },
  { id: 'op-upakovka', label: 'Сортировка / упаковка', category: 'operation', patterns: p('сортиров', 'упаков', 'упаковать', 'упакован') },
  { id: 'op-skoba', label: 'Сшивка на скобу', category: 'operation', patterns: p('скоб[аеуы]', 'на скоб', 'сшивк', 'шить') },
  { id: 'op-termobinder', label: 'Термобиндер', category: 'operation', patterns: p('термобиндер', 'термоклей') },
  { id: 'op-pur', label: 'PUR-клей', category: 'operation', patterns: p('pur[-\\s]?клей', '\\bpur\\b', 'пур[-\\s]?клей') },
  { id: 'op-pruzhina', label: 'Пружина', category: 'operation', patterns: p('пружин') },
  { id: 'op-kashirovanie', label: 'Каширование', category: 'operation', patterns: p('кашировк', 'каширов') },
  { id: 'op-slim-kashirovanie', label: 'Слим-каширование', category: 'operation', patterns: p('слим') },
  { id: 'op-lyuversy', label: 'Люверсы', category: 'operation', patterns: p('люверс') },
  { id: 'op-nozhka', label: 'Приклейка ножки', category: 'operation', patterns: p('ножк') },
  { id: 'op-ruchki', label: 'Ручки', category: 'operation', patterns: p('ручк') },
  { id: 'op-kreplenie', label: 'Крепление', category: 'operation', patterns: p('креплен', 'планка') },
  { id: 'op-klipsa', label: 'Отверстие под клипсу', category: 'operation', patterns: p('клипс') },
  { id: 'op-personalizatsiya', label: 'Персонализация', category: 'operation', patterns: p('персонализ') },

  // ── Материалы ──
  { id: 'mat-melovannaya', label: 'Мелованная', category: 'material', patterns: p('мелован') },
  { id: 'mat-ofsetnaya', label: 'Офсетная', category: 'material', patterns: p('офсет') },
  { id: 'mat-kalandr', label: 'Каландр', category: 'material', patterns: p('каландр') },
  { id: 'mat-karton', label: 'Картон', category: 'material', patterns: p('картон') },
  { id: 'mat-dizaynerskaya', label: 'Дизайнерская', category: 'material', patterns: p('дизайнерск') },
  { id: 'mat-kraft', label: 'Крафт', category: 'material', patterns: p('крафт') },
  { id: 'mat-samokleyka', label: 'Самоклеящаяся', category: 'material', patterns: p('самокле', 'самоклеящ') },
  { id: 'mat-polilazer', label: 'Полилазер', category: 'material', patterns: p('полилазер', 'полипропилен', 'плёнк', 'пленк') },
  { id: 'mat-color-copy', label: 'Color Copy', category: 'material', patterns: p('color\\s*copy') },
  { id: 'mat-raflatac', label: 'Raflatac', category: 'material', patterns: p('raflatac', 'рафлатак') },
  { id: 'mat-perepletnyy', label: 'Переплётный картон', category: 'material', patterns: p('переплётн', 'переплетн') },
  { id: 'mat-davalcheskaya', label: 'Давальческая', category: 'material', patterns: p('давальческ') },
  { id: 'mat-sirio', label: 'Sirio Color', category: 'material', patterns: p('sirio') },
  { id: 'mat-touch-cover', label: 'Touch Cover', category: 'material', patterns: p('touch\\s*cover') },
  { id: 'mat-curious', label: 'Curious Metallic', category: 'material', patterns: p('curious') },
  { id: 'mat-nettuno', label: 'Nettuno', category: 'material', patterns: p('nettuno') },
  { id: 'mat-constellation', label: 'Constellation', category: 'material', patterns: p('constellation') },

  // ── Плотность ──
  ...DENSITIES.map<TagDef>((d) => ({
    id: `dens-${d}`,
    label: `${d} г/м²`,
    category: 'density',
    patterns: p(`${d}\\s*г`),
  })),

  // ── Ламинация ──
  // Эти теги не ищутся шаблоном по тексту: вид ламинации определяется
  // в detectLamination (src/lamination.ts), потому что в составных заявках
  // «без ламинации» относится к части тиража, а «матовая» может описывать бумагу.
  { id: 'lam-glyantsevaya', label: 'Глянцевая', category: 'lamination', patterns: [], computed: true },
  { id: 'lam-matovaya', label: 'Матовая', category: 'lamination', patterns: [], computed: true },
  { id: 'lam-soft-touch', label: 'Soft-Touch', category: 'lamination', patterns: [], computed: true },
  { id: 'lam-bez', label: 'Без ламинации', category: 'lamination', patterns: [], computed: true },
];

export const TAG_BY_ID: Record<string, TagDef> = Object.fromEntries(TAGS.map((t) => [t.id, t]));

export const TAGS_BY_CATEGORY: Record<TagCategory, TagDef[]> = {
  product: TAGS.filter((t) => t.category === 'product'),
  operation: TAGS.filter((t) => t.category === 'operation'),
  material: TAGS.filter((t) => t.category === 'material'),
  density: TAGS.filter((t) => t.category === 'density'),
  lamination: TAGS.filter((t) => t.category === 'lamination'),
};

/**
 * Извлекает теги из текста ТЗ и дополнительных полей (тип бумаги, примечание).
 * Возвращает массив id тегов без повторов.
 */
export function extractTags(text: string, extra = ''): string[] {
  const hay = `${text || ''}\n${extra || ''}`;
  if (!hay.trim()) return [];
  const ids: string[] = [];
  for (const tag of TAGS) {
    if (tag.computed) continue;
    if (tag.patterns.some((re) => re.test(hay))) ids.push(tag.id);
  }
  return ids;
}

/** id тегов ламинации по результату detectLamination. */
export function laminationTagIds(info: { has: boolean; kinds: LaminationKind[] }): string[] {
  const ids: string[] = [];
  if (info.kinds.includes('glossy')) ids.push('lam-glyantsevaya');
  if (info.kinds.includes('matte')) ids.push('lam-matovaya');
  if (info.kinds.includes('soft-touch')) ids.push('lam-soft-touch');
  if (!info.has) ids.push('lam-bez');
  return ids;
}

/** Подписи тегов по их id, в порядке категорий. */
export function tagsToLabels(ids: string[]): string[] {
  return ids
    .map((id) => TAG_BY_ID[id])
    .filter(Boolean)
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
    .map((t) => t.label);
}
