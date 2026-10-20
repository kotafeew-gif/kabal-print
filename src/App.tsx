import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Printer as PrinterIcon,
  FileText,
  User,
  Users,
  Copy,
  Layers,
  Sparkles,
  RefreshCw,
  Check,
  Undo2,
  Calendar,
  Package,
  Tag,
  FolderOpen,
  Globe2
} from 'lucide-react';
import './style.css';
import { TAG_BY_ID, TAGS_BY_CATEGORY, CATEGORY_LABELS, CATEGORY_ORDER, PRODUCT_TYPES, type TagCategory } from './dictionaries';
import { parseTz, type ParsedTz } from './parseTz';

export type { ParsedTz };

export interface Order {
  rowNumber: number;
  orderNumber: string;
  client: string;
  created: string;
  deadline: string;
  tz: string;
  paperQuantity: string;
  paperType: string;
  colorMode: string;
  note: string;
  printer: string;
  manager: string;
  completed: boolean;
  sheetId?: number;
}

declare global {
  interface Window {
    kabalAPI?: {
      loadOrders: () => Promise<{ success: boolean; orders?: Order[]; error?: string }>;
      claimOrder: (data: { rowNumber: number; printer: string }) => Promise<{ success: boolean; error?: string; warning?: string }>;
      unclaimOrder?: (data: { rowNumber: number }) => Promise<{ success: boolean; error?: string; warning?: string }>;
      completeOrder: (data: {
        rowNumber: number;
        paperQty?: string;
        paperDensity?: string;
        colorMode?: string;
        postpress?: string;
      }) => Promise<{ success: boolean; error?: string; warning?: string }>;
      openFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
      printOrderDocument: (data: {
        folderPath?: string;
        orderNumber?: string;
      }) => Promise<{ success: boolean; error?: string; printedFile?: string; noDocument?: boolean }>;
      getUpdateState: () => Promise<UpdateState | null>;
      checkUpdates: () => Promise<UpdateState | null>;
      downloadUpdate: () => Promise<boolean>;
      dismissUpdate: () => Promise<boolean>;
      installUpdate: () => Promise<boolean>;
      getAppVersion: () => Promise<string>;
      onUpdateStatus: (callback: (state: UpdateState | null) => void) => () => void;
    };
  }
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'dev';
  version?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  error?: string;
}

/** 82773744 → «79,0 МБ» */
function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 МБ';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1).replace('.', ',')} МБ`;
  return `${Math.round(bytes / 1024)} КБ`;
}

function isRemoteResource(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function parseDateTimeValue(value: string): number {
  const match = String(value || '').match(/(\d{2})\.(\d{2})\.(\d{4})(?:[ \t]+(\d{1,2}):(\d{2}))?/);
  if (!match) return Number.NaN;
  return new Date(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
    Number(match[4] || 0),
    Number(match[5] || 0),
  ).getTime();
}

export const PRINTERS_CONFIG: Record<string, { label: string; color: string; badgeClass: string }> = {
  в: { label: 'Валера', color: '#c27ba0', badgeClass: 'badge-valera' },
  к: { label: 'Андрей', color: '#00ffff', badgeClass: 'badge-andrey' },
  m: { label: 'Коля', color: '#4a86e8', badgeClass: 'badge-kolya' },
};

/** #rrggbb → rgba(r, g, b, alpha) — для мягкой подкраски строк. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const INITIAL_MOCK_ORDERS: Order[] = [
  {
    rowNumber: 2,
    orderNumber: '4821',
    client: 'ООО "Арт-Медиа"',
    created: '17.10.2026 10:15',
    deadline: '17.10.2026 18:00',
    tz: '\\\\Print\\2022\\1АК\\2025\\12.12 Лак\\печать\nЛистовки А5 4+4\nТираж: 2000 экз.\nБумага: 130г мелованная глянец\nЛаминация: без ламинации\nПорезка в размер',
    paperQuantity: '1000 листов SRA3',
    paperType: '130г/м² глянец',
    colorMode: '4+4',
    note: 'Срочно в утреннюю отгрузку клиенту',
    printer: '',
    manager: 'Елена',
    completed: false,
  },
  {
    rowNumber: 3,
    orderNumber: '4822',
    client: 'Кафе "Корица"',
    created: '17.10.2026 11:30',
    deadline: '18.10.2026 14:00',
    tz: 'Меню-буклет А4 2 фальца\nТираж: 300 экз.\nБумага: 250г мелованная матовая\nЛаминация: софт-тач 1+1 (32 мкм)\nБиговка 2 линии, фальцовка',
    paperQuantity: '320 листов SRA3',
    paperType: '250г/м² матовая',
    colorMode: '4+4',
    note: 'Клиент заберет самовывозом в 15:00',
    printer: 'в',
    manager: 'Максим',
    completed: false,
  },
  {
    rowNumber: 4,
    orderNumber: '4823',
    client: 'Фитнес-клуб "Титан"',
    created: '16.10.2026 15:00',
    deadline: '19.10.2026 12:00',
    tz: 'Визитки 90х50\nТираж: 1000 шт (10 комплектов по 100)\nБумага: 300г Color Copy\nЛаминация: матовая 32 мкм 1+1\nСкругление углов 3мм',
    paperQuantity: '50 листов SRA3',
    paperType: '300г/м² Color Copy',
    colorMode: '4+0',
    note: 'Проверить метки реза перед тиражом',
    printer: 'к',
    manager: 'Дмитрий',
    completed: false,
  },
  {
    rowNumber: 5,
    orderNumber: '4824',
    client: 'Студия "Стиль"',
    created: '17.10.2026 12:10',
    deadline: '17.10.2026 16:30',
    tz: 'Наклейки контурные круглая форма 50мм\nТираж: 1500 шт.\nБумага: самоклейка полуглянец Raflatac\nЛаминация: глянцевая 25 мкм\nПлоттерная резка',
    paperQuantity: '75 листов SRA3',
    paperType: 'Самоклейка Raflatac',
    colorMode: '4+0',
    note: 'Файл в кривых, контур реза выверен',
    printer: '',
    manager: 'Елена',
    completed: false,
  },
  {
    rowNumber: 6,
    orderNumber: '4825',
    client: 'IT-Конференция DevFest',
    created: '15.10.2026 09:20',
    deadline: '16.10.2026 18:00',
    tz: 'Бейджи 100х140 на ленту\nТираж: 400 шт.\nБумага: 300г мелованная матовая\nЛаминация: матовая 125 мкм (пакетная)\nСверление отверстия под клипсу 5мм',
    paperQuantity: '110 листов SRA3',
    paperType: '300г/м² матовая',
    colorMode: '4+4',
    note: 'Персонализация по списку участников',
    printer: 'm',
    manager: 'Максим',
    completed: false,
  },
  {
    rowNumber: 7,
    orderNumber: '4819',
    client: 'Типография "Спектр"',
    created: '16.10.2026 08:30',
    deadline: '17.10.2026 11:00',
    tz: 'Плакаты А3 4+0\nТираж: 150 экз.\nБумага: 170г мелованная глянец\nЛаминация: нет',
    paperQuantity: '160 листов SRA3',
    paperType: '170г/м²',
    colorMode: '4+0',
    note: 'Упаковать в тубусы по 50 шт',
    printer: 'm',
    manager: 'Елена',
    completed: true,
  },
  {
    rowNumber: 8,
    orderNumber: '4826',
    client: 'Сеть стоматологий "Дент"',
    created: '17.10.2026 14:00',
    deadline: '20.10.2026 10:00',
    tz: 'Блокноты А5 на металлической пружине\nТираж: 100 шт.\nОбложка: 300г мелованная матовая + ламинация Soft-Touch\nБлок: 50 листов 80г офсет 1+0 в клетку\nПодложка: картон 300г без печати\nПружина белая по короткой стороне',
    paperQuantity: 'Обложки 25 листов SRA3, блок 5 пачек 80г',
    paperType: '300г + офсет 80г',
    colorMode: '4+0 / 1+0',
    note: 'Пружину зажимать аккуратно, без замятия',
    printer: '',
    manager: 'Дмитрий',
    completed: false,
  },
];

let localMockOrders = [...INITIAL_MOCK_ORDERS];


export default function App() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [printer, setPrinter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [statusFilter, setStatusFilter] = useState<'all' | 'free' | 'my' | 'в' | 'к' | 'm'>('all');
  const [materialFilter, setMaterialFilter] = useState<string>('all');
  const [laminationFilter, setLaminationFilter] = useState<string>('all');
  const [laminationKind, setLaminationKind] = useState<string>('all');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagPanelOpen, setTagPanelOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({ operation: true });

  // Форма завершения заявки (F/G/H/I)
  const [completeTarget, setCompleteTarget] = useState<Order | null>(null);
  const [completePapers, setCompletePapers] = useState<Array<{ qty: string; density: string }>>([{ qty: '', density: '' }]);
  const [completeColor, setCompleteColor] = useState('');
  const [completePostpress, setCompletePostpress] = useState('');
  const [isCompleting, setIsCompleting] = useState(false);

  // Черновик формы завершения: если закрыть окно, не завершив заявку, введённое
  // сохранится в localStorage именно для этой заявки (ключ — номер строки листа).
  const completeDraftKey = (rowNumber: number) => `kabal-complete-draft-${rowNumber}`;

  const loadCompleteDraft = (rowNumber: number): { papers: Array<{ qty: string; density: string }> | null; color: string; postpress: string } | null => {
    try {
      const raw = localStorage.getItem(completeDraftKey(rowNumber));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        papers: Array.isArray(parsed.papers) && parsed.papers.length ? (parsed.papers as Array<{ qty: string; density: string }>) : null,
        color: typeof parsed.color === 'string' ? parsed.color : '',
        postpress: typeof parsed.postpress === 'string' ? parsed.postpress : '',
      };
    } catch {
      return null;
    }
  };

  const clearCompleteDraft = (rowNumber: number) => {
    try {
      localStorage.removeItem(completeDraftKey(rowNumber));
    } catch {}
  };

  // Автосохранение черновика при любом изменении полей формы
  useEffect(() => {
    if (!completeTarget) return;
    try {
      localStorage.setItem(
        completeDraftKey(completeTarget.rowNumber),
        JSON.stringify({ papers: completePapers, color: completeColor, postpress: completePostpress }),
      );
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completePapers, completeColor, completePostpress, completeTarget]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isElectron, setIsElectron] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);

  const DEFAULT_COL_WIDTHS = [85, 175, 160, 145, 115, 78, 250, 180, 120, 125];
  const [colWidths, setColWidths] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem('kabal-col-widths');
      const parsed = saved ? JSON.parse(saved) : null;
      return Array.isArray(parsed) && parsed.length === DEFAULT_COL_WIDTHS.length ? parsed : DEFAULT_COL_WIDTHS;
    } catch {
      return DEFAULT_COL_WIDTHS;
    }
  });
  const [resizing, setResizing] = useState<{ index: number; startX: number; startWidth: number } | null>(null);

  const load = async () => {
    setIsRefreshing(true);
    try {
      if (window.kabalAPI) {
        setIsElectron(true);
        const result = await window.kabalAPI.loadOrders();
        if (result.success && result.orders) {
          setOrders(result.orders);
          setError('');
        } else {
          setError(result.error || 'Ошибка загрузки заказов из Google Таблицы');
        }
      } else {
        // Веб-режим / демонстрационный режим для браузера
        setIsElectron(false);
        setOrders([...localMockOrders]);
        setError('');
      }
    } catch (e: any) {
      setError(e.message || 'Ошибка соединения');
    } finally {
      setTimeout(() => setIsRefreshing(false), 300);
    }
  };

  // Column resize handlers
  const handleResizeStart = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing({ index, startX: e.clientX, startWidth: colWidths[index] });
  };

  useEffect(() => {
    if (!resizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizing.startX;
      const newWidth = Math.max(40, resizing.startWidth + delta);
      setColWidths((prev) => {
        const next = [...prev];
        next[resizing.index] = newWidth;
        return next;
      });
    };
    const handleMouseUp = () => {
      setColWidths((prev) => {
        localStorage.setItem('kabal-col-widths', JSON.stringify(prev));
        return prev;
      });
      setResizing(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing]);

  const gridStyle = { gridTemplateColumns: colWidths.map((w) => `${w}px`).join(' ') };

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  // Версия приложения и подписка на статус обновлений
  useEffect(() => {
    const api = window.kabalAPI;
    if (!api) return;
    api.getAppVersion?.().then((v) => setAppVersion(v)).catch(() => {});
    api.getUpdateState?.().then((s) => s && setUpdateState(s)).catch(() => {});
    const unsubscribe = api.onUpdateStatus?.((s) => setUpdateState(s));
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  // Claim Order
  async function handleClaim(order: Order, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    if (!printer) {
      setError('Сначала выберите себя (печатника) в верхнем меню');
      return;
    }
    setError('');
    setNotice('');
    if (window.kabalAPI) {
      const result = await window.kabalAPI.claimOrder({ rowNumber: order.rowNumber, printer });
      if (!result.success) {
        setError(result.error || 'Не удалось взять заявку');
        return;
      }
      if (result.warning) setNotice(result.warning);
      await load();
    } else {
      const current = localMockOrders.find((o) => o.rowNumber === order.rowNumber);
      if (current && current.printer && current.printer !== printer) {
        setError(`Заявка уже взята печатником: ${PRINTERS_CONFIG[current.printer]?.label || current.printer}`);
        return;
      }
      localMockOrders = localMockOrders.map((o) => (o.rowNumber === order.rowNumber ? { ...o, printer } : o));
      setOrders([...localMockOrders]);
    }
  }

  // Unclaim Order (Release)
  async function handleUnclaim(order: Order, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    setError('');
    setNotice('');
    if (window.kabalAPI && window.kabalAPI.unclaimOrder) {
      const result = await window.kabalAPI.unclaimOrder({ rowNumber: order.rowNumber });
      if (!result.success) {
        setError(result.error || 'Не удалось освободить заявку');
        return;
      }
      if (result.warning) setNotice(result.warning);
      await load();
    } else {
      localMockOrders = localMockOrders.map((o) => (o.rowNumber === order.rowNumber ? { ...o, printer: '' } : o));
      setOrders([...localMockOrders]);
    }
  }

  // Complete Order — открывает форму заполнения F/G/H/I
  function handleComplete(order: Order, e?: React.MouseEvent) {
    openCompleteForm(order, e);
  }

  // Обновление: загрузка и установка
  const handleUpdateNow = () => {
    window.kabalAPI?.downloadUpdate?.();
  };

  const handleUpdateLater = () => {
    window.kabalAPI?.dismissUpdate?.();
    setUpdateState({ status: 'idle' });
  };

  // Открыть форму завершения с предзаполнением из ТЗ
  const openCompleteForm = (order: Order, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    // Если форму для этой заявки уже открывали и закрывали без завершения —
    // вернуть сохранённый черновик вместо предзаполнения из ТЗ
    const draft = loadCompleteDraft(order.rowNumber);
    if (draft) {
      setCompletePapers(draft.papers && draft.papers.length ? draft.papers : [{ qty: '', density: '' }]);
      setCompleteColor(draft.color);
      setCompletePostpress(draft.postpress);
      setCompleteTarget(order);
      setError('');
      setNotice('');
      return;
    }

    const parsed = parsedOrdersMap.get(order.rowNumber) || parseTz(order.tz);

    // Плотности бумаги из ТЗ — каждая становится отдельной строкой (листов = пусто)
    const densitySet = new Set<string>();
    for (const tagId of parsed.tags) {
      const tag = TAG_BY_ID[tagId];
      if (tag?.category === 'density') densitySet.add(tag.label.replace(/\s*г\/м²$/, ''));
    }
    // Плюс значения вида «350 гр», «300гр», «80 г/м2» из текста
    const densityMatches = parsed.lines.join(' ').matchAll(/(\d{2,3})\s*(?:г\/м²|г\/м2|гр(?![а-яё])|г(?![а-яё]))/gi);
    for (const m of densityMatches) densitySet.add(m[1]);

    const densities = Array.from(densitySet);
    setCompletePapers(
      densities.length
        ? densities.map((d) => ({ qty: '', density: d }))
        : [{ qty: '', density: parsed.paper !== 'Не указана' ? parsed.paper : '' }],
    );

    setCompleteColor(parsed.color || order.colorMode || '');

    const opLabels = parsed.tags
      .map((id) => TAG_BY_ID[id])
      .filter((t) => t && t.category === 'operation')
      .map((t) => t!.label);
    setCompletePostpress(opLabels.join(', '));

    setCompleteTarget(order);
    setError('');
    setNotice('');
  };

  const closeCompleteForm = () => {
    setCompleteTarget(null);
    setIsCompleting(false);
  };

  // Подтвердить завершение — записать F/G/H/I и закрыть заявку
  async function submitComplete() {
    if (!completeTarget) return;
    const papers = completePapers.filter((p) => p.qty.trim() || p.density.trim());
    const paperQty = papers.map((p) => p.qty.trim()).filter(Boolean).join('\n');
    const paperDensity = papers.map((p) => p.density.trim()).filter(Boolean).join('\n');

    setIsCompleting(true);
    try {
      if (window.kabalAPI) {
        const result = await window.kabalAPI.completeOrder({
          rowNumber: completeTarget.rowNumber,
          paperQty,
          paperDensity,
          colorMode: completeColor.trim(),
          postpress: completePostpress.trim(),
        });
        if (!result.success) {
          setError(result.error || 'Не удалось завершить заявку');
          setIsCompleting(false);
          return;
        }
        if (result.warning) setNotice(result.warning);
      } else {
        localMockOrders = localMockOrders.map((o) =>
          o.rowNumber === completeTarget.rowNumber
            ? { ...o, completed: true, paperQuantity: paperQty, paperType: paperDensity, colorMode: completeColor, note: completePostpress }
            : o,
        );
        setOrders([...localMockOrders]);
      }
      closeCompleteForm();
      clearCompleteDraft(completeTarget.rowNumber);
      await load();
    } catch (err: any) {
      setError(err.message || 'Ошибка завершения заявки');
      setIsCompleting(false);
    }
  }

  const handleCopyOrder = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedOrderId(text);
    setTimeout(() => setCopiedOrderId(null), 2000);
  };

  // Открыть папку заказа в проводнике
  async function handleOpenFolder(folderPath: string, e: React.MouseEvent) {
    e.stopPropagation();
    setError('');
    setNotice('');
    if (!folderPath) {
      setError('В ТЗ заявки не указан путь к папке');
      return;
    }
    if (!window.kabalAPI?.openFolder) {
      setError('Открытие папки доступно только в приложении (не в браузере)');
      return;
    }
    const result = await window.kabalAPI.openFolder(folderPath);
    if (!result.success) {
      setError(`Не удалось открыть папку: ${result.error || 'неизвестная ошибка'}`);
    }
  }

  // Печать: сначала пробуем файл техкарты из папки заказа,
  // если его нет — печатаем сгенерированную карточку заявки.
  async function handlePrintCard(order: Order, e: React.MouseEvent) {
    e.stopPropagation();
    setError('');
    setNotice('');

    const parsed = parsedOrdersMap.get(order.rowNumber) || parseTz(order.tz);

    if (window.kabalAPI?.printOrderDocument) {
      const result = await window.kabalAPI.printOrderDocument({
        folderPath: parsed.folderPath,
        orderNumber: order.orderNumber,
      });

      if (result.success) {
        setNotice(`Печатается файл техкарты: ${result.printedFile || 'документ из папки заявки'}`);
        return;
      }

      // Файла нет (или нет пути) — печатаем техкарту, собранную программой
      if (result.noDocument || !parsed.folderPath) {
        setNotice('Файл техкарты в папке не найден — печатается техкарта из программы');
        window.print();
        return;
      }

      setError(result.error || 'Не удалось напечатать файл техкарты');
      return;
    }

    window.print();
  }

  // Parsed cache
  const parsedOrdersMap = useMemo(() => {
    const map = new Map<number, ParsedTz>();
    for (const o of orders) {
      map.set(o.rowNumber, parseTz(o.tz, o.paperQuantity, o.paperType));
    }
    return map;
  }, [orders]);

  // Unique materials and products for filter dropdowns
  const availableMaterials = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => {
      const parsed = parsedOrdersMap.get(o.rowNumber);
      if (parsed?.paper && parsed.paper !== 'Не указана') {
        set.add(parsed.paper);
      }
    });
    return Array.from(set).sort();
  }, [orders, parsedOrdersMap]);

  const availableProducts = useMemo(() => {
    // Полный справочник видов продукции (как у менеджеров) + виды, найденные
    // в текущих заявках. «Другое...» — служебный пункт формы, в фильтр не попадает.
    const set = new Set<string>();
    orders.forEach((o) => {
      const parsed = parsedOrdersMap.get(o.rowNumber);
      if (parsed?.product) {
        set.add(parsed.product);
      }
    });
    PRODUCT_TYPES.forEach((p) => {
      if (p !== 'Другое...') set.add(p);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [orders, parsedOrdersMap]);

  // Status counts
  const stats = useMemo(() => {
    const active = orders.filter((o) => !o.completed);
    const free = active.filter((o) => !o.printer).length;
    const myOrders = printer ? active.filter((o) => o.printer === printer).length : 0;
    const completed = orders.filter((o) => o.completed).length;
    return {
      totalActive: active.length,
      free,
      myOrders,
      completed,
    };
  }, [orders, printer]);

  // Filtered and sorted orders
  const filteredOrders = useMemo(() => {
    return orders
      .filter((order) => {
        const q = query.trim().toLowerCase();
        const matchNumber = q !== '' && order.orderNumber.toLowerCase().includes(q);
        const matchClient = q !== '' && order.client.toLowerCase().includes(q);

        // Completed toggle: если идёт поиск по номеру заявки или заказчику —
        // выполненные заявки показываем тоже, галочка «Показать архив» не нужна
        if (!showCompleted && order.completed && !matchNumber && !matchClient) return false;

        // Status Filter
        if (statusFilter === 'free' && order.printer) return false;
        if (statusFilter === 'my') {
          if (!printer || order.printer !== printer) return false;
        }
        if (statusFilter === 'в' && order.printer !== 'в') return false;
        if (statusFilter === 'к' && order.printer !== 'к') return false;
        if (statusFilter === 'm' && order.printer !== 'm') return false;

        const parsed = parsedOrdersMap.get(order.rowNumber);

        // Product Filter
        if (productFilter !== 'all' && parsed?.product !== productFilter) {
          return false;
        }

        // Material Filter
        if (materialFilter !== 'all') {
          if (!parsed?.paper.toLowerCase().includes(materialFilter.toLowerCase())) return false;
        }

        // Lamination Filter — источник истины тот же, что у тегов (detectLamination),
        // иначе дропдаун и панель тегов показывали разные наборы заявок.
        if (laminationFilter === 'with') {
          if (!parsed?.hasLamination) return false;
          // Уточнение по виду ламинации (тег из справочника)
          if (laminationKind !== 'all' && !(parsed?.tags || []).includes(laminationKind)) {
            return false;
          }
        } else if (laminationFilter === 'without') {
          if (parsed?.hasLamination) return false;
        }

        // Tag Filter: внутри категории — ИЛИ, между категориями — И
        if (selectedTags.length > 0) {
          const orderTags = parsed?.tags || [];
          const byCategory = new Map<TagCategory, string[]>();
          for (const id of selectedTags) {
            const def = TAG_BY_ID[id];
            if (!def) continue;
            const list = byCategory.get(def.category) || [];
            list.push(id);
            byCategory.set(def.category, list);
          }
          for (const ids of byCategory.values()) {
            if (!ids.some((id) => orderTags.includes(id))) return false;
          }
        }

        // Search Query
        if (q) {
          const matchTz = order.tz.toLowerCase().includes(q);
          const matchManager = order.manager.toLowerCase().includes(q);
          const matchPaper = (order.paperType || '').toLowerCase().includes(q);
          const matchProduct = (parsed?.product || '').toLowerCase().includes(q);
          if (!matchNumber && !matchClient && !matchTz && !matchManager && !matchPaper && !matchProduct) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const aDate = parseDateTimeValue(a.deadline);
        const bDate = parseDateTimeValue(b.deadline);
        // Единственная сортировка списка — по сроку сдачи.
        const cmp = Number.isNaN(aDate) || Number.isNaN(bDate)
          ? (a.deadline || '').localeCompare(b.deadline || '', 'ru')
          : aDate - bDate;

        return sortDirection === 'asc' ? cmp : -cmp;
      });
  }, [
    orders,
    showCompleted,
    statusFilter,
    printer,
    productFilter,
    materialFilter,
    laminationFilter,
    laminationKind,
    selectedTags,
    query,
    sortDirection,
    parsedOrdersMap,
  ]);

  const toggleDeadlineSort = () => {
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  const toggleTag = (id: string) => {
    setSelectedTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const toggleCat = (cat: string) => {
    setExpandedCats((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  // Сколько заявок содержит каждый тег — только ещё не готовые (архив не считаем)
  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const order of orders) {
      if (order.completed) continue;
      const tags = parsedOrdersMap.get(order.rowNumber)?.tags || [];
      for (const id of tags) map.set(id, (map.get(id) || 0) + 1);
    }
    return map;
  }, [orders, parsedOrdersMap]);

  // Срок сдачи «сегодня» — выделяем, чтобы сразу было видно, что заявка сдаётся сегодня
  const parseDeadlineDate = (deadline: string): Date | null => {
    const m = deadline.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1]);
  };

  const isDeadlineToday = (deadline: string): boolean => {
    const d = parseDeadlineDate(deadline);
    if (!d) return false;
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  };

  const getUrgencyBadge = (deadline: string) => {
    if (!deadline) return null;
    const lower = deadline.toLowerCase();
    // Quick heuristic
    if (lower.includes('сроч') || lower.includes('горит') || lower.includes('сегодня') || lower.includes('17.10')) {
      return <span className="urgency-badge urgent">Срочно</span>;
    }
    return null;
  };

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="header-brand">
          <div className="logo-icon">
            <PrinterIcon size={22} className="text-blue-600" />
          </div>
          <div>
            <div className="brand-title-wrap">
              <h1>Оскар-Принт Производство</h1>
              <button
                className={`version-pill ${updateState?.status === 'checking' ? 'checking' : ''}`}
                onClick={() => window.kabalAPI?.checkUpdates?.()}
                title={isElectron ? 'Проверить обновления' : 'Проверка обновлений доступна в приложении'}
              >
                v{appVersion || '1.0.0'}
              </button>
              {!isElectron && <span className="badge-preview">Веб-режим</span>}
              {updateState?.status === 'available' && (
                <span className="badge-update" title="Доступно обновление приложения">
                  Обновление {updateState.version}
                </span>
              )}
              {updateState?.status === 'downloading' && (
                <span className="badge-update" title="Идёт загрузка обновления">
                  Загрузка {updateState.percent ?? 0}%
                </span>
              )}
              {updateState?.status === 'downloaded' && (
                <span className="badge-update" title="Обновление загружено, перезапустите приложение">
                  Готово к установке
                </span>
              )}
            </div>
            <p className="brand-subtitle">Компактный диспетчер производственных заявок печати</p>
          </div>
        </div>

        {/* User Identity Selector */}
        <div className="printer-identity-card">
          <div className="identity-label">
            <User size={15} />
            <span>Печатник:</span>
          </div>
          <select
            className="identity-select"
            value={printer}
            onChange={(e) => {
              setPrinter(e.target.value);
            }}
          >
            <option value="">-- Выберите себя --</option>
            {Object.entries(PRINTERS_CONFIG).map(([key, config]) => (
              <option key={key} value={key}>
                {config.label} ({key})
              </option>
            ))}
          </select>
          {printer && (
            <span className={`printer-chip ${PRINTERS_CONFIG[printer]?.badgeClass || ''}`}>
              {PRINTERS_CONFIG[printer]?.label}
            </span>
          )}
        </div>
      </header>

      {/* Stats Counter Bar */}
      <div className="stats-bar">
        <div
          className={`stat-pill ${statusFilter === 'all' ? 'active' : ''}`}
          onClick={() => setStatusFilter('all')}
        >
          <span className="stat-label">Всего активных:</span>
          <span className="stat-value">{stats.totalActive}</span>
        </div>

        <div
          className={`stat-pill free-pill ${statusFilter === 'free' ? 'active' : ''}`}
          onClick={() => setStatusFilter('free')}
        >
          <span className="stat-indicator green-dot" />
          <span className="stat-label">Свободные (ждут):</span>
          <span className="stat-value">{stats.free}</span>
        </div>

        {printer && (
          <div
            className={`stat-pill my-pill ${statusFilter === 'my' ? 'active' : ''}`}
            onClick={() => setStatusFilter('my')}
          >
            <span className="stat-indicator blue-dot" />
            <span className="stat-label">Мои в работе ({PRINTERS_CONFIG[printer]?.label}):</span>
            <span className="stat-value">{stats.myOrders}</span>
          </div>
        )}

        {/* Per-printer pills */}
        {Object.entries(PRINTERS_CONFIG).map(([key, config]) => {
          const count = orders.filter((o) => !o.completed && o.printer === key).length;
          return (
            <div
              key={key}
              className={`stat-pill ${statusFilter === key ? 'active' : ''}`}
              onClick={() => setStatusFilter(key as any)}
            >
              <span className="stat-label">{config.label}:</span>
              <span className="stat-value">{count}</span>
            </div>
          );
        })}

        <div
          className={`stat-pill done-pill ${showCompleted ? 'active' : ''}`}
          onClick={() => setShowCompleted(!showCompleted)}
        >
          <span className="stat-label">Выполненные:</span>
          <span className="stat-value">{stats.completed}</span>
        </div>

        <button
          className={`btn-refresh ${isRefreshing ? 'spinning' : ''}`}
          onClick={load}
          title="Обновить таблицу из Google Sheets"
        >
          <RefreshCw size={15} />
          <span>{isRefreshing ? 'Синхронизация...' : 'Обновить'}</span>
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <AlertTriangle size={18} />
          <span>{error}</span>
          <button onClick={() => setError('')}>✕</button>
        </div>
      )}

      {notice && (
        <div className="notice-banner">
          <AlertTriangle size={18} />
          <span>{notice}</span>
          <button onClick={() => setNotice('')}>✕</button>
        </div>
      )}

      {/* Control Panel: Filters, Search, Sorting */}
      <div className="control-panel">
        {/* Search */}
        <div className="search-box">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="Поиск по № заявки, клиенту, ТЗ, менеджеру, материалу..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="clear-search" onClick={() => setQuery('')}>
              ✕
            </button>
          )}
        </div>

        {/* Filters Group */}
        <div className="filters-group">
          {/* Status Filter Dropdown */}
          <div className="filter-item">
            <span className="filter-label">Статус:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
            >
              <option value="all">Все статусы</option>
              <option value="free">🟢 Только свободные (не в работе)</option>
              {printer && <option value="my">👤 Только мои ({PRINTERS_CONFIG[printer]?.label})</option>}
              <option value="в">Валера (в)</option>
              <option value="к">Андрей (к)</option>
              <option value="m">Коля (m)</option>
            </select>
          </div>

          {/* Product Filter */}
          <div className="filter-item">
            <span className="filter-label">Продукция:</span>
            <select
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
            >
              <option value="all">Все виды</option>
              {availableProducts.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Material Filter */}
          <div className="filter-item">
            <span className="filter-label">Материал:</span>
            <select
              value={materialFilter}
              onChange={(e) => setMaterialFilter(e.target.value)}
            >
              <option value="all">Любой материал</option>
              <option value="мелован">Мелованная бумага</option>
              <option value="color copy">Color Copy</option>
              <option value="картон">Картон</option>
              <option value="самоклей">Самоклейка</option>
              <option value="офсет">Офсетная</option>
            </select>
          </div>

          {/* Lamination Filter */}
          <div className="filter-item">
            <span className="filter-label">Ламинация:</span>
            <select
              value={laminationFilter}
              onChange={(e) => {
                setLaminationFilter(e.target.value);
                // При смене режима сбрасываем уточнение, если оно больше не нужно
                if (e.target.value !== 'with') setLaminationKind('all');
              }}
            >
              <option value="all">Любая</option>
              <option value="with">С ламинацией</option>
              <option value="without">Без ламинации</option>
            </select>
          </div>

          {/* Вид ламинации — появляется только при выборе «С ламинацией» */}
          {laminationFilter === 'with' && (
            <div className="filter-item filter-item-sub">
              <span className="filter-label">Вид:</span>
              <select
                value={laminationKind}
                onChange={(e) => setLaminationKind(e.target.value)}
              >
                <option value="all">Любой вид</option>
                <option value="lam-glyantsevaya">Глянцевая</option>
                <option value="lam-matovaya">Матовая</option>
                <option value="lam-soft-touch">Софт-тач (Soft-Touch)</option>
              </select>
            </div>
          )}

          {/* Show Completed Toggle */}
          <label className="toggle-completed">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
            />
            <span>Показать архив ({stats.completed})</span>
          </label>
        </div>

        {/* Tag Filter Panel */}
        <div className="tag-filter-panel">
          <button
            className={`tag-panel-toggle ${selectedTags.length ? 'has-active' : ''}`}
            onClick={() => setTagPanelOpen((v) => !v)}
          >
            <Tag size={14} />
            <span>Фильтр по работам, материалам и продукции</span>
            {selectedTags.length > 0 && <span className="tag-count-badge">{selectedTags.length}</span>}
            {tagPanelOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {selectedTags.length > 0 && (
            <div className="tag-active-row">
              {selectedTags.map((id) => (
                <button key={id} className="tag-chip active" onClick={() => toggleTag(id)}>
                  {TAG_BY_ID[id]?.label}
                  <span className="tag-chip-x">✕</span>
                </button>
              ))}
              <button className="tag-clear" onClick={() => setSelectedTags([])}>
                Сбросить все
              </button>
            </div>
          )}

          {tagPanelOpen && (
            <div className="tag-panel-body">
              <div className="tag-search-box">
                <div className="tag-search-inner">
                  <Search size={15} className="tag-search-icon" />
                  <input
                    autoFocus
                    type="text"
                    placeholder="Найти тег: уф, биговка, мелованная…"
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                  />
                  {tagSearch && (
                    <button className="tag-search-clear" onClick={() => setTagSearch('')} title="Очистить">
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {(() => {
                const q = tagSearch.trim().toLowerCase();
                const groups = CATEGORY_ORDER.map((cat) => {
                  const all = TAGS_BY_CATEGORY[cat]
                    .filter((t) => (tagCounts.get(t.id) || 0) > 0)
                    .sort((a, b) => (tagCounts.get(b.id) || 0) - (tagCounts.get(a.id) || 0));
                  const matched = q ? all.filter((t) => t.label.toLowerCase().includes(q)) : all;
                  return { cat, matched, total: all.length };
                }).filter((g) => g.matched.length > 0);

                if (groups.length === 0) {
                  return <div className="tag-empty">Ничего не найдено по запросу «{tagSearch}»</div>;
                }

                return groups.map(({ cat, matched, total }) => {
                  const isOpen = q ? true : !!expandedCats[cat];
                  const activeInCat = matched.filter((t) => selectedTags.includes(t.id)).length;
                  return (
                    <div key={cat} className="tag-group-block">
                      <button className="tag-group-header" onClick={() => toggleCat(cat)}>
                        {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        <span className="tag-group-name">{CATEGORY_LABELS[cat]}</span>
                        <span className="tag-group-count">
                          {q ? `${matched.length} из ${total}` : total}
                        </span>
                        {activeInCat > 0 && <span className="tag-group-active">{activeInCat} выбрано</span>}
                      </button>
                      {isOpen && (
                        <div className="tag-group-chips">
                          {matched.map((tag) => {
                            const count = tagCounts.get(tag.id) || 0;
                            const active = selectedTags.includes(tag.id);
                            return (
                              <button
                                key={tag.id}
                                className={`tag-chip ${active ? 'active' : ''}`}
                                onClick={() => toggleTag(tag.id)}
                                title={`${tag.label} — заявок: ${count}`}
                              >
                                {tag.label}
                                <span className="tag-chip-count">{count}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Main Table / Compact List */}
      <main className="orders-wrapper">
        <div className="compact-table-container">
          {/* Table Header with interactive sort clicks */}
          <div className="compact-table-header" style={gridStyle}>
            <div className="col col-num">
              <span>№ Заявки</span>
              <div className="resize-handle" onMouseDown={(e) => handleResizeStart(0, e)} />
            </div>
            <div className="col col-dates" onClick={toggleDeadlineSort}>
              <span>Срок сдачи</span>
              {sortDirection === 'asc' ? ' ↑' : ' ↓'}
              <div className="resize-handle" onMouseDown={(e) => handleResizeStart(1, e)} />
            </div>
            <div className="col col-client">
              <span>Заказчик</span>

              <div className="resize-handle" onMouseDown={(e) => handleResizeStart(2, e)} />
            </div>
            <div className="col col-product">
              <span>Вид продукции</span>

              <div className="resize-handle" onMouseDown={(e) => handleResizeStart(3, e)} />
            </div>
            <div className="col col-qty">
              <span>Тираж</span>
              <div className="resize-handle" onMouseDown={(e) => handleResizeStart(4, e)} />
            </div>
            <div className="col col-folder">
              <span>Папка</span>
              <div className="resize-handle" onMouseDown={(e) => handleResizeStart(5, e)} />
            </div>
            <div className="col col-paper">
              <span>Материал / Ламинация</span>

              <div className="resize-handle" onMouseDown={(e) => handleResizeStart(6, e)} />
            </div>
            <div className="col col-tags">
              <span>Работы / Операции</span>

              <div className="resize-handle" onMouseDown={(e) => handleResizeStart(7, e)} />
            </div>
            <div className="col col-status">
              <span>Печатник / Статус</span>

              <div className="resize-handle" onMouseDown={(e) => handleResizeStart(8, e)} />
            </div>
            <div className="col col-actions">
              <span>Действие</span>
            </div>
          </div>

          {/* Table Rows */}
          {filteredOrders.length === 0 ? (
            <div className="empty-state">
              <Package size={40} className="text-slate-400" />
              <h3>Заявок не найдено</h3>
              <p>Попробуйте сбросить фильтры или изменить поисковый запрос</p>
              <button
                className="btn-reset"
                onClick={() => {
                  setQuery('');
                  setStatusFilter('all');
                  setProductFilter('all');
                  setMaterialFilter('all');
                  setLaminationFilter('all');
                  setShowCompleted(false);
                  setSelectedTags([]);
                }}
              >
                Сбросить фильтры
              </button>
            </div>
          ) : (
            <div className="compact-table-body">
              {filteredOrders.map((order) => {
                const parsed = parsedOrdersMap.get(order.rowNumber) || parseTz(order.tz);
                const isExpanded = expandedId === `${order.rowNumber}-${order.orderNumber}`;
                const isMyOrder = printer && order.printer === printer;
                const printerConfig = PRINTERS_CONFIG[order.printer];

                return (
                  <div
                    key={`${order.rowNumber}-${order.orderNumber}`}
                    className={`order-row-group ${isExpanded ? 'expanded' : ''} ${order.completed ? 'completed' : ''} ${order.printer ? 'claimed' : 'free'}`}
                    style={
                      order.printer && printerConfig && !order.completed
                        ? ({
                            '--row-tint': hexToRgba(printerConfig.color, 0.13),
                            '--row-tint-hover': hexToRgba(printerConfig.color, 0.2),
                            '--row-accent': printerConfig.color,
                          } as React.CSSProperties)
                        : undefined
                    }
                  >
                    {/* Compact Single-Line Row */}
                    <div
                      className="compact-row"
                      style={gridStyle}
                      onClick={() => setExpandedId(isExpanded ? null : `${order.rowNumber}-${order.orderNumber}`)}
                    >
                      {/* Order Number */}
                      <div className="col col-num">
                        <div className="order-num-tag">
                          <strong>№ {order.orderNumber}</strong>
                          <button
                            className="btn-copy-num"
                            title="Скопировать номер"
                            onClick={(e) => handleCopyOrder(order.orderNumber, e)}
                          >
                            {copiedOrderId === order.orderNumber ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </div>
                        {order.manager && <span className="manager-tag">{order.manager}</span>}
                      </div>

                      {/* Dates */}
                      <div className="col col-dates">
                        <div className="dates-flow">
                          <span className={`date-deadline ${isDeadlineToday(order.deadline) ? 'today' : ''}`} title="Срок сдачи">
                            {order.deadline || '—'}
                          </span>
                        </div>
                        {isDeadlineToday(order.deadline) && <span className="urgency-badge today">Сегодня</span>}
                        {getUrgencyBadge(order.deadline)}
                      </div>

                      {/* Client */}
                      <div className="col col-client">
                        <span className="client-name" title={order.client}>
                          {order.client}
                        </span>
                      </div>

                      {/* Product — только вид продукции, без цветности и примечаний */}
                      <div className="col col-product">
                        <span className="product-badge" title={parsed.product}>
                          {parsed.product}
                        </span>
                      </div>

                      {/* Quantity */}
                      <div className="col col-qty">
                        <span className="qty-value" title={parsed.quantity}>
                          {parsed.quantity}
                        </span>
                        {order.paperQuantity && order.paperQuantity !== parsed.quantity && (
                          <span className="paper-qty-sub" title={order.paperQuantity}>
                            {order.paperQuantity}
                          </span>
                        )}
                      </div>

                      {/* Папка заказа */}
                      <div className="col col-folder">
                        {parsed.folderPath ? (
                          <button
                            className="btn-open-folder"
                            title={`Открыть папку: ${parsed.folderPath}`}
                            onClick={(e) => handleOpenFolder(parsed.folderPath, e)}
                          >
                            {isRemoteResource(parsed.folderPath) ? <Globe2 size={14} /> : <FolderOpen size={14} />}
                            <span>Открыть</span>
                          </button>
                        ) : (
                          <span className="folder-missing" title="В ТЗ не указан путь к папке">—</span>
                        )}
                      </div>

                      {/* Material & Lamination */}
                      <div className="col col-paper">
                        <span className="paper-text" title={parsed.paper}>
                          {parsed.paper}
                        </span>
                        {parsed.lamination && parsed.lamination !== '—' && (
                          <span className="lamination-tag" title={parsed.lamination}>
                            {parsed.lamination}
                          </span>
                        )}
                      </div>

                      {/* Работы / Операции */}
                      <div className="col col-tags">
                        {(() => {
                          const opTags = parsed.tags
                            .map((id) => TAG_BY_ID[id])
                            .filter((t) => t && t.category === 'operation');
                          if (opTags.length === 0) return <span className="tags-empty">—</span>;
                          const shown = opTags.slice(0, 3);
                          const rest = opTags.length - shown.length;
                          return (
                            <>
                              {shown.map((t) => (
                                <button
                                  key={t.id}
                                  className={`op-chip ${selectedTags.includes(t.id) ? 'selected' : ''}`}
                                  title={`Фильтровать по: ${t.label}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleTag(t.id);
                                  }}
                                >
                                  {t.label}
                                </button>
                              ))}
                              {rest > 0 && (
                                <span className="op-chip-more" title={opTags.map((t) => t.label).join(', ')}>
                                  +{rest}
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </div>

                      {/* Status / Printer */}
                      <div className="col col-status">
                        {order.completed ? (
                          <span className="status-badge badge-done">
                            <CheckCircle2 size={13} />
                            Готово
                            {printerConfig?.label && <span className="status-printer-name">· {printerConfig.label}</span>}
                          </span>
                        ) : order.printer ? (
                          <span className={`status-badge ${printerConfig?.badgeClass || 'badge-claimed'}`}>
                            <User size={13} />
                            {printerConfig?.label || order.printer}
                          </span>
                        ) : (
                          <span className="status-badge badge-free">
                            <span className="pulse-dot" />
                            Свободна
                          </span>
                        )}
                      </div>

                      {/* Quick Action Button */}
                      <div className="col col-actions" onClick={(e) => e.stopPropagation()}>
                        {order.completed ? (
                          <span className="text-xs text-slate-400 font-medium">Сдана</span>
                        ) : !order.printer ? (
                          <button
                            className="btn-claim-compact"
                            onClick={(e) => handleClaim(order, e)}
                            disabled={!printer}
                            title={printer ? `Взять заказ на ${PRINTERS_CONFIG[printer]?.label}` : 'Выберите себя в меню'}
                          >
                            Взять
                          </button>
                        ) : isMyOrder ? (
                          <div className="actions-cluster">
                            <button
                              className="btn-done-compact"
                              onClick={(e) => handleComplete(order, e)}
                              title="Отметить заказ как выполненный"
                            >
                              Готово
                            </button>
                            <button
                              className="btn-unclaim-compact"
                              onClick={(e) => handleUnclaim(order, e)}
                              title="Отменить взятие заказа (вернуть в свободные)"
                            >
                              <Undo2 size={13} />
                            </button>
                          </div>
                        ) : (
                          <span className="in-progress-note">В работе</span>
                        )}

                        <button
                          className="btn-expand-toggle"
                          onClick={() =>
                            setExpandedId(isExpanded ? null : `${order.rowNumber}-${order.orderNumber}`)
                          }
                          title={isExpanded ? 'Свернуть' : 'Развернуть полное ТЗ'}
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </div>
                    </div>

                    {/* Expandable Full Information Panel */}
                    {isExpanded && (
                      <div className="expanded-details-panel">
                        <div className="details-grid">
                          {/* Col 1: Summary Facts */}
                          <div className="details-col details-meta">
                            <h4>
                              <FileText size={16} /> Детали заявки № {order.orderNumber}
                            </h4>
                            <div className="meta-list">
                              <div className="meta-row">
                                <span className="meta-key">Заказчик:</span>
                                <span className="meta-val font-semibold">{order.client}</span>
                              </div>
                              <div className="meta-row">
                                <span className="meta-key">Менеджер:</span>
                                <span className="meta-val">{order.manager || '—'}</span>
                              </div>
                              <div className="meta-row">
                                <span className="meta-key">Печатник:</span>
                                <span className="meta-val">
                                  {order.printer && PRINTERS_CONFIG[order.printer] ? (
                                    <span className={`printer-chip ${PRINTERS_CONFIG[order.printer].badgeClass || ''}`}>
                                      {PRINTERS_CONFIG[order.printer].label}
                                    </span>
                                  ) : (
                                    '—'
                                  )}
                                </span>
                              </div>
                              <div className="meta-row">
                                <span className="meta-key">Дата постановки:</span>
                                <span className="meta-val">{order.created || '—'}</span>
                              </div>
                              <div className="meta-row">
                                <span className="meta-key">Срок сдачи:</span>
                                <span className="meta-val text-red-700 font-semibold">{order.deadline || '—'}</span>
                              </div>
                              <div className="meta-row">
                                <span className="meta-key">Кол-во бумаги:</span>
                                <span className="meta-val">{order.paperQuantity || '—'}</span>
                              </div>
                              <div className="meta-row">
                                <span className="meta-key">Тип бумаги:</span>
                                <span className="meta-val">{order.paperType || '—'}</span>
                              </div>
                              <div className="meta-row">
                                <span className="meta-key">Цветность:</span>
                                <span className="meta-val">{order.colorMode || parsed.color || '—'}</span>
                              </div>
                              {order.note && (
                                <div className="meta-row note-row">
                                  <span className="meta-key">
                                    {order.completed ? 'Послепечатные работы:' : 'Примечание:'}
                                  </span>
                                  <span className="meta-val text-amber-800">{order.note}</span>
                                </div>
                              )}
                              {parsed.folderPath && (
                                <div className="meta-row">
                                  <span className="meta-key">Папка:</span>
                                  <span className="meta-val">
                                    <button
                                      className="folder-link"
                                      title={parsed.folderPath}
                                      onClick={(e) => handleOpenFolder(parsed.folderPath, e)}
                                    >
                                      {isRemoteResource(parsed.folderPath) ? <Globe2 size={12} /> : <FolderOpen size={12} />}
                                      {parsed.folderPath}
                                    </button>
                                  </span>
                                </div>
                              )}
                              {parsed.tags.length > 0 && (
                                <div className="meta-row">
                                  <span className="meta-key">Теги:</span>
                                  <span className="meta-val flex gap-1 flex-wrap">
                                    {parsed.tags.map((id) => {
                                      const t = TAG_BY_ID[id];
                                      if (!t) return null;
                                      return (
                                        <button
                                          key={id}
                                          className={`detail-tag-chip cat-${t.category} ${selectedTags.includes(id) ? 'selected' : ''}`}
                                          title={`${CATEGORY_LABELS[t.category]}: ${t.label} — нажмите для фильтра`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleTag(id);
                                          }}
                                        >
                                          {t.label}
                                        </button>
                                      );
                                    })}
                                  </span>
                                </div>
                              )}
                            </div>

                            <div className="details-actions-bar">
                              {order.completed ? (
                                <span className="actions-note">Заявка завершена</span>
                              ) : !order.printer ? (
                                <button
                                  className="btn-claim-large"
                                  onClick={(e) => handleClaim(order, e)}
                                  disabled={!printer}
                                  title={printer ? '' : 'Выберите себя в меню «Печатник»'}
                                >
                                  Взять в работу {printer ? `(${PRINTERS_CONFIG[printer]?.label})` : ''}
                                </button>
                              ) : isMyOrder ? (
                                <div className="flex gap-2">
                                  <button
                                    className="btn-done-large"
                                    onClick={(e) => handleComplete(order, e)}
                                  >
                                    <CheckCircle2 size={16} /> Завершить
                                  </button>
                                  <button
                                    className="btn-unclaim-large"
                                    onClick={(e) => handleUnclaim(order, e)}
                                  >
                                    <Undo2 size={16} /> Отказаться
                                  </button>
                                </div>
                              ) : (
                                <span className="actions-note">
                                  В работе: {printerConfig?.label || order.printer}
                                </span>
                              )}
                              <button
                                className="btn-print-card"
                                onClick={(e) => handlePrintCard(order, e)}
                                title="Распечатать техкарту заявки"
                              >
                                <PrinterIcon size={15} /> Распечатать
                              </button>
                            </div>
                          </div>

                          {/* Col 2: Structured TZ (Raw Text) */}
                          <div className="details-col details-tz">
                            <div className="tz-header">
                              <h4>
                                <Layers size={16} /> Структурированное ТЗ из ячейки
                              </h4>
                              <button
                                className="btn-copy-tz"
                                onClick={(e) => handleCopyOrder(order.tz, e)}
                              >
                                {copiedOrderId === order.tz ? 'Скопировано!' : 'Скопировать ТЗ'}
                              </button>
                            </div>
                            <pre className="tz-pre-block">{order.tz}</pre>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Окно обновления: прогресс загрузки и автоперезапуск */}
      {updateState && ['available', 'downloading', 'downloaded', 'error'].includes(updateState.status) && (
        <div className="update-overlay">
          <div className="update-window">
            <div className="update-icon">
              <RefreshCw
                size={26}
                className={updateState.status === 'downloading' ? 'spin-icon' : ''}
              />
            </div>

            {updateState.status === 'available' && (
              <>
                <h2>Доступно обновление</h2>
                <p className="update-text">
                  Новая версия <strong>{updateState.version}</strong>. Загрузка начнётся сразу
                  после нажатия — приложение перезапустится автоматически.
                </p>
                <div className="update-actions">
                  <button className="update-btn-primary" onClick={handleUpdateNow}>
                    Обновить
                  </button>
                  <button className="update-btn-secondary" onClick={handleUpdateLater}>
                    Позже
                  </button>
                </div>
              </>
            )}

            {updateState.status === 'downloading' && (
              <>
                <h2>Загрузка обновления</h2>
                <p className="update-text update-version-line">
                  Версия {updateState.version || ''}
                </p>

                <div className="update-progress-track">
                  <div
                    className="update-progress-fill"
                    style={{ width: `${Math.min(100, Math.max(0, updateState.percent ?? 0))}%` }}
                  />
                </div>

                <div className="update-progress-meta">
                  <span className="update-percent">{updateState.percent ?? 0}%</span>
                  <span className="update-bytes">
                    {formatBytes(updateState.transferred)} из {formatBytes(updateState.total)}
                    {updateState.bytesPerSecond
                      ? ` · ${formatBytes(updateState.bytesPerSecond)}/с`
                      : ''}
                  </span>
                </div>

                <p className="update-hint">
                  Не закрывайте приложение. После загрузки оно перезапустится само.
                </p>
              </>
            )}

            {updateState.status === 'downloaded' && (
              <>
                <h2>Установка</h2>
                <p className="update-text">
                  Версия {updateState.version} загружена. Приложение перезапустится
                  через пару секунд.
                </p>
                <div className="update-progress-track">
                  <div className="update-progress-fill" style={{ width: '100%' }} />
                </div>
                <div className="update-progress-meta">
                  <span className="update-percent">100%</span>
                  <span className="update-bytes">перезапуск…</span>
                </div>
              </>
            )}

            {updateState.status === 'error' && (
              <>
                <h2>Не удалось обновить</h2>
                <p className="update-text update-error-text">
                  {updateState.error || 'Неизвестная ошибка'}
                </p>
                <div className="update-actions">
                  <button className="update-btn-primary" onClick={() => window.kabalAPI?.checkUpdates?.()}>
                    Повторить
                  </button>
                  <button className="update-btn-secondary" onClick={handleUpdateLater}>
                    Закрыть
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Форма завершения заявки: F/G/H/I */}
      {completeTarget && (
        <div className="modal-overlay" onClick={closeCompleteForm}>
          <div className="modal-window complete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Завершение заявки № {completeTarget.orderNumber}</h2>
                <p className="modal-sub">
                  {completeTarget.client} · Заполните фактический расход бумаги и выполненные работы
                </p>
              </div>
              <button className="btn-modal-close" onClick={closeCompleteForm}>×</button>
            </div>

            <div className="modal-body complete-body">
              {/* ТЗ заявки — дублируется слева, чтобы не забыть, что было заказано */}
              <aside className="complete-tz">
                <div className="complete-tz-head">
                  <h3>ТЗ заявки</h3>
                  <span className="complete-tz-num">№ {completeTarget.orderNumber}</span>
                </div>
                <pre className="complete-tz-text">{completeTarget.tz || 'ТЗ не заполнено'}</pre>
              </aside>

              <div className="complete-form">
              {/* F + G: бумага */}
              <div className="complete-section">
                <div className="complete-section-head">
                  <h3>Использованная бумага</h3>
                  <button
                    className="btn-add-paper"
                    onClick={() => setCompletePapers((prev) => [...prev, { qty: '', density: '' }])}
                  >
                    + Добавить вид бумаги
                  </button>
                </div>

                <div className="paper-rows">
                  <div className="paper-row-head">
                    <span>Кол-во листов (F)</span>
                    <span>Плотность / тип (G)</span>
                    <span />
                  </div>
                  {completePapers.map((paper, idx) => (
                    <div className="paper-row" key={idx}>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="напр. 120"
                        value={paper.qty}
                        onChange={(e) =>
                          setCompletePapers((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, qty: e.target.value } : p)),
                          )
                        }
                      />
                      <input
                        type="text"
                        placeholder="напр. 350 / картон / дизайнерская"
                        value={paper.density}
                        onChange={(e) =>
                          setCompletePapers((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, density: e.target.value } : p)),
                          )
                        }
                      />
                      <button
                        className="btn-remove-paper"
                        title="Удалить этот вид бумаги"
                        disabled={completePapers.length === 1}
                        onClick={() => setCompletePapers((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* H: цветность */}
              <div className="complete-section">
                <h3>Цветность (H)</h3>
                <input
                  className="complete-input"
                  type="text"
                  placeholder="напр. 4+4"
                  value={completeColor}
                  onChange={(e) => setCompleteColor(e.target.value)}
                />
              </div>

              {/* I: послепечатные работы */}
              <div className="complete-section">
                <h3>Послепечатные работы (I)</h3>
                <textarea
                  className="complete-textarea"
                  rows={3}
                  placeholder="ламинация, сшивка, биговка, упаковка и т.д."
                  value={completePostpress}
                  onChange={(e) => setCompletePostpress(e.target.value)}
                />
                <p className="complete-hint">
                  Всё, что было сделано кроме печати. Значения взяты из ТЗ — поправьте при необходимости.
                </p>
              </div>
              </div>
            </div>

            <div className="modal-footer">
              <span className="complete-footer-note">После завершения заявка станет жёлтой</span>
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={closeCompleteForm} disabled={isCompleting}>
                  Отмена
                </button>
                <button className="btn-done-large" onClick={submitComplete} disabled={isCompleting}>
                  <CheckCircle2 size={16} /> {isCompleting ? 'Завершаем…' : 'Завершить заявку'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
