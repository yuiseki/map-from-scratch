export const LINES = [
    {
        name: '東海道新幹線',
        en: 'Tokaido',
        colour: '#3fa9ff'
    },
    {
        name: '山陽新幹線',
        en: 'Sanyo',
        colour: '#7c83ff'
    },
    {
        name: '東北新幹線',
        en: 'Tohoku',
        colour: '#2ee07a'
    },
    {
        name: '上越新幹線',
        en: 'Joetsu',
        colour: '#ff6fb5'
    },
    {
        name: '北陸新幹線',
        en: 'Hokuriku',
        colour: '#ffb648'
    },
    {
        name: '九州新幹線',
        en: 'Kyushu',
        colour: '#ff5a4e'
    },
    {
        name: '西九州新幹線',
        en: 'Nishi-Kyushu',
        colour: '#ffe066'
    },
    {
        name: '北海道新幹線',
        en: 'Hokkaido',
        colour: '#c77dff'
    },
    {
        name: '秋田新幹線',
        en: 'Akita',
        colour: '#ff2e63',
        fallbackKmh: 130
    },
    {
        name: '山形新幹線',
        en: 'Yamagata',
        colour: '#5ee6ff'
    }
];
export const STATIONS = [
    {
        name: '東京',
        en: 'Tokyo',
        line: '東海道新幹線'
    },
    {
        name: '新富士',
        en: 'Shin-Fuji',
        line: '東海道新幹線'
    },
    {
        name: '名古屋',
        en: 'Nagoya',
        line: '東海道新幹線'
    },
    {
        name: '新大阪',
        en: 'Shin-Osaka',
        line: '東海道新幹線'
    },
    {
        name: '広島',
        en: 'Hiroshima',
        line: '山陽新幹線'
    },
    {
        name: '博多',
        en: 'Hakata',
        line: '山陽新幹線'
    },
    {
        name: '仙台',
        en: 'Sendai',
        line: '東北新幹線'
    },
    {
        name: '新青森',
        en: 'Shin-Aomori',
        line: '東北新幹線'
    },
    {
        name: '新潟',
        en: 'Niigata',
        line: '上越新幹線'
    },
    {
        name: '金沢',
        en: 'Kanazawa',
        line: '北陸新幹線'
    },
    {
        name: '鹿児島中央',
        en: 'Kagoshima-Chuo',
        line: '九州新幹線'
    },
    {
        name: '長崎',
        en: 'Nagasaki',
        line: '西九州新幹線'
    },
    {
        name: '新函館北斗',
        en: 'Shin-Hakodate-Hokuto',
        line: '北海道新幹線'
    },
    {
        name: '秋田',
        en: 'Akita',
        line: '秋田新幹線'
    },
    {
        name: '新庄',
        en: 'Shinjo',
        line: '山形新幹線'
    }
];
export const DETAIL_BOX = [
    118,
    20,
    155,
    50
];
export const hexToRgb = (h)=>[
        1,
        3,
        5
    ].map((i)=>parseInt(h.slice(i, i + 2), 16) / 255);
