// api/recipes.js — Vercel Serverless Function
// Возвращает список всех рецептов из data source базы.
//
// Ответ:
//   {
//     recipes: [{
//       id, url, title, icon, category, for_whom, techniques, time_min, tested,
//       last_edited, created_at
//     }],
//     filters: {
//       categories: [...],   // уникальные значения (встречающиеся в базе)
//       for_whom: [...],
//       techniques: [...]
//     },
//     total: number
//   }

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = '2022-06-28';
const DATA_SOURCE_ID = '252e8d34-ac92-42af-bedf-cfbd7f3a4e9d';

export default async function handler(req, res) {
  try {
    const pages = await queryAllPages(DATA_SOURCE_ID);

    const recipes = pages.map(p => {
      const props = p.properties || {};
      return {
        id: p.id,
        url: p.url,
        title: extractTitle(props['Название']),
        icon: extractIcon(p.icon),
        category: extractSelect(props['Раздел']),
        for_whom: extractMultiSelect(props['Для кого']),
        techniques: extractMultiSelect(props['Техника']),
        time_text: extractRichText(props['Время']),
        tested: extractCheckbox(props['Проверен']),
        last_edited: p.last_edited_time,
        created_at: p.created_time
      };
    });

    // Сортировка: проверенные сверху, далее по алфавиту
    recipes.sort((a, b) => {
      if (a.tested !== b.tested) return b.tested - a.tested;
      return a.title.localeCompare(b.title, 'ru');
    });

    // Индексы для фильтров на клиенте
    const filters = {
      categories: uniq(recipes.map(r => r.category).filter(Boolean)),
      for_whom: uniq(recipes.flatMap(r => r.for_whom || [])),
      techniques: uniq(recipes.flatMap(r => r.techniques || []))
    };

    // Кэш на 5 минут — рецепты меняются редко
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json({
      recipes,
      filters,
      total: recipes.length
    });
  } catch (err) {
    console.error('[api/recipes]', err);
    return res.status(500).json({ error: err.message });
  }
}

// ─── Notion API helpers ──────────────────────────────────────────────

async function queryAllPages(dataSourceId) {
  const all = [];
  let cursor = null;
  do {
    const body = {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {})
    };
    const r = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      // Fallback для старых версий API — databases/query
      const r2 = await fetch(`https://api.notion.com/v1/databases/${dataSourceId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (!r2.ok) throw new Error(`Notion API ${r2.status}: ${await r2.text()}`);
      const json = await r2.json();
      all.push(...json.results);
      cursor = json.has_more ? json.next_cursor : null;
    } else {
      const json = await r.json();
      all.push(...json.results);
      cursor = json.has_more ? json.next_cursor : null;
    }
  } while (cursor);
  return all;
}

function extractTitle(prop) {
  if (!prop || prop.type !== 'title') return '';
  const raw = (prop.title || []).map(r => r.plain_text).join('');
  // Убираем числовые префиксы типа "1.1 "
  return raw.replace(/^\d+\.\d+\s+/, '').trim();
}

function extractRichText(prop) {
  if (!prop || !prop.rich_text) return '';
  return (prop.rich_text || []).map(r => r.plain_text).join('');
}

function extractSelect(prop) {
  if (!prop || prop.type !== 'select') return null;
  return prop.select?.name || null;
}

function extractMultiSelect(prop) {
  if (!prop || prop.type !== 'multi_select') return [];
  return (prop.multi_select || []).map(o => o.name);
}

function extractCheckbox(prop) {
  if (!prop || prop.type !== 'checkbox') return false;
  return !!prop.checkbox;
}

function extractIcon(icon) {
  if (!icon) return null;
  if (icon.type === 'emoji') return icon.emoji;
  if (icon.type === 'external') return icon.external?.url;
  if (icon.type === 'file') return icon.file?.url;
  return null;
}

function uniq(arr) {
  return [...new Set(arr)].sort((a, b) => a.localeCompare(b, 'ru'));
}
