import { createContext, useContext } from 'react'

export type Lang = 'zh' | 'en'

const zh = {
  subtitle: '运动 · 学习 · 音乐 · 代码',
  updated: '更新于',
  yearTotal: (y: number) => `${y} 合计`,
  activeDays: '活跃天数',
  goalDays: '达标天数',
  pb: '个人最佳',
  tabOverview: '概览',
  tabMap: '地图',
  tabActivities: '运动记录',
  viewCards: '卡片',
  viewTable: '表格',
  cols: { date: '日期', type: '类型', name: '名称', distance: '距离', time: '用时', pace: '配速 / 速度', elev: '爬升', hr: '心率', weather: '天气', source: '来源' },
  sortBy: (col: string) => `按${col}排序`,
  routesCount: (n: number) => `${n} 条路线`,
  noRoutes: '这段时间没有带路线的运动',
  showInList: '在列表中查看',
  showOnMap: '在地图中查看',
  mapNoToken: '地图需要 Mapbox token:在 .env 里设置 VITE_MAPBOX_TOKEN(线上用仓库变量 VITE_MAPBOX_TOKEN)。',
  downloadPng: '下载热力图 PNG',
  pbNote: '没有分段数据:只统计总距离为目标 98%–110% 的跑步，并按整次平均配速折算到目标距离',
  pbJump: '点击查看这次跑步',
  pbNone: '暂无',
  mile: '1 英里',
  k5: '5 公里',
  k10: '10 公里',
  half: '半程马拉松',
  full: '全程马拉松',
  feelsLike: (c: string) => `体感 ${c}`,
  humidity: (p: number) => `湿度 ${p}%`,
  allTime: '累计',
  longestStreak: '最长连续',
  activeIn: (n: number) => `${n} 天有记录`,
  overviewLabel: (label: string, total: string, unit: string) => `${label}历年每月热力图,累计 ${total} ${unit}`,
  streak: '当前连续',
  days: '天',
  noRecord: '无记录',
  less: '少',
  more: '多',
  months: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  weekdays: ['一', '三', '五'], // Mon, Wed, Fri rows
  heatmapLabel: (y: number, label: string, total: string, unit: string) => `${y} 年${label}每日热力图,合计 ${total} ${unit}`,
  activities: '运动记录',
  all: '全部',
  loadMore: (n: number) => `加载更多(还有 ${n} 条)`,
  emptyYear: '这一年还没有任何记录。',
  loadError: (e: string) => `读取 data.json 失败(${e})。先运行 go run ./cmd/lifelog export,或加 -demo 生成示例数据。`,
  duration: (h: number, m: number) => (h > 0 ? `${h}小时${m}分` : `${m}分钟`),
  toLight: '切换到白天模式',
  toDark: '切换到夜间模式',
  otherLang: 'EN',
  otherLangLabel: 'Switch to English',
}

const en: typeof zh = {
  subtitle: 'Sport · Learning · Music · Code',
  updated: 'Updated',
  yearTotal: (y: number) => `${y} total`,
  activeDays: 'Active days',
  goalDays: 'Goal met',
  pb: 'Personal bests',
  tabOverview: 'Overview',
  tabMap: 'Map',
  tabActivities: 'Activities',
  viewCards: 'Cards',
  viewTable: 'Table',
  cols: { date: 'Date', type: 'Type', name: 'Name', distance: 'Distance', time: 'Time', pace: 'Pace / speed', elev: 'Elev.', hr: 'HR', weather: 'Weather', source: 'Source' },
  sortBy: (col: string) => `Sort by ${col}`,
  routesCount: (n: number) => `${n} routes`,
  noRoutes: 'No activities with a route in this period',
  showInList: 'Show in list',
  showOnMap: 'Show on map',
  mapNoToken: 'The map needs a Mapbox token: set VITE_MAPBOX_TOKEN in .env (and the VITE_MAPBOX_TOKEN repository variable for the live site).',
  downloadPng: 'Download heatmap as PNG',
  pbNote: 'No split data: only runs whose total distance is 98–110% of the target count, scaled to the exact distance at their average pace',
  pbJump: 'Show this run',
  pbNone: 'None yet',
  mile: '1 mile',
  k5: '5K',
  k10: '10K',
  half: 'Half marathon',
  full: 'Marathon',
  feelsLike: (c: string) => `feels ${c}`,
  humidity: (p: number) => `${p}% humidity`,
  allTime: 'All time',
  longestStreak: 'Longest streak',
  activeIn: (n: number) => `${n} active days`,
  overviewLabel: (label: string, total: string, unit: string) => `${label} per month across all years, total ${total} ${unit}`,
  streak: 'Current streak',
  days: 'd',
  noRecord: 'No activity',
  less: 'Less',
  more: 'More',
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  weekdays: ['Mon', 'Wed', 'Fri'],
  heatmapLabel: (y: number, label: string, total: string, unit: string) => `${label} per day in ${y}, total ${total} ${unit}`,
  activities: 'Activities',
  all: 'All',
  loadMore: (n: number) => `Load more (${n} left)`,
  emptyYear: 'Nothing recorded this year.',
  loadError: (e: string) => `Could not load data.json (${e}). Run go run ./cmd/lifelog export first, or add -demo for sample data.`,
  duration: (h: number, m: number) => (h > 0 ? `${h}h ${m}m` : `${m} min`),
  toLight: 'Switch to light mode',
  toDark: 'Switch to dark mode',
  otherLang: '中',
  otherLangLabel: '切换到中文',
}

export type Dict = typeof zh
export const DICTS: Record<Lang, Dict> = { zh, en }
export const LOCALE: Record<Lang, string> = { zh: 'zh-CN', en: 'en-US' }

export const I18n = createContext<{ lang: Lang; t: Dict }>({ lang: 'zh', t: zh })
export const useI18n = () => useContext(I18n)

// Per-viewer preferences; storage can be unavailable (private mode), so never rely on it.
export function load(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
export function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export function initialLang(): Lang {
  const saved = load('lang')
  if (saved === 'zh' || saved === 'en') return saved
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
