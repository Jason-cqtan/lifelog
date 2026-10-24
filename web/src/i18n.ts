import { createContext, useContext } from 'react'

export type Lang = 'zh' | 'en'

const zh = {
  subtitle: '运动 · 学习 · 音乐 · 代码',
  updated: '更新于',
  yearTotal: (y: number) => `${y} 合计`,
  activeDays: '活跃天数',
  goalDays: '达标天数',
  streak: '连续',
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
  streak: 'Streak',
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
