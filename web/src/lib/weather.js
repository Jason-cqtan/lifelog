// Garmin's weatherTypeDTO.desc values (English) -> icon and Chinese name.
// The first group has been seen in real data; the rest are common extras.
const TYPES = {
    Clear: ['☀️', '晴'],
    Fair: ['🌤️', '晴'],
    'Mostly Clear': ['🌤️', '大部晴朗'],
    'Partly Cloudy': ['⛅', '局部多云'],
    Cloudy: ['☁️', '多云'],
    Fog: ['🌫️', '雾'],
    'Light Rain': ['🌦️', '小雨'],
    Showers: ['🌦️', '阵雨'],
    Rain: ['🌧️', '雨'],
    'Heavy Rain': ['🌧️', '大雨'],
    Sunny: ['☀️', '晴'],
    'Mostly Cloudy': ['🌥️', '大部多云'],
    Overcast: ['☁️', '阴'],
    Haze: ['🌫️', '霾'],
    Mist: ['🌫️', '薄雾'],
    Drizzle: ['🌦️', '毛毛雨'],
    Thunderstorms: ['⛈️', '雷雨'],
    'Light Snow': ['🌨️', '小雪'],
    Snow: ['❄️', '雪'],
    Sleet: ['🌨️', '雨夹雪'],
    Windy: ['💨', '大风'],
};
const WIND_ZH = {
    N: '北', NNE: '北偏东', NE: '东北', ENE: '东偏北', E: '东', ESE: '东偏南', SE: '东南', SSE: '南偏东',
    S: '南', SSW: '南偏西', SW: '西南', WSW: '西偏南', W: '西', WNW: '西偏北', NW: '西北', NNW: '北偏西',
};
/** Icon and localized description; "Unknown" or unmapped types keep a neutral icon. */
export function weatherLabel(desc, lang) {
    const t = desc ? TYPES[desc] : undefined;
    if (!t)
        return { icon: '🌡️', text: desc && desc !== 'Unknown' && lang === 'en' ? desc : '' };
    return { icon: t[0], text: lang === 'zh' ? t[1] : desc };
}
export function windLabel(dir, ms, lang) {
    const speed = `${ms.toFixed(1)} m/s`;
    if (!dir)
        return speed;
    return lang === 'zh' ? `${WIND_ZH[dir] ?? dir}风 ${speed}` : `${dir} ${speed}`;
}
