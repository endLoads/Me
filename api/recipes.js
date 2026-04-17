// api/recipes.js — Vercel Serverless Function
// Список всех рецептов из Notion data source.

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = '2025-09-03';

// Data source ID основной базы (collection:// URL из Notion)
// База рецептов имеет несколько data sources; используем главный — "🍽️ Книга рецептов"
const DATA_SOURCE_ID = '252e8d34-ac92-42af-bedf-cfbd7f3a4e9d';

export default async function handler(req, res) {
  try {
    if (!NOTION_TOKEN) {
      return res.status(500).json({ error: 'NOTION_TOKEN не задан в environment variables' });
    }

    const pages = await queryAllPages(DATA_SOURCE_ID.trim());

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

    recipes.sort((a, b) => {
      if (a.tested !== b.tested) return b.tested - a.tested;
      return a.title.localeCompare(b.title, 'ru');
    });

    const filters = {
      categories: uniq(recipes.map(r => r.category).filter(Boolean)),
      for_whom: uniq(recipes.flatMap(r => r.for_whom || [])),
      techniques: uniq(recipes.flatMap(r => r.techniques || []))
    };

    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json({ recipes, filters, total: recipes.length });
  } catch (err) {
    console.error('[api/recipes]', err);
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}

async function queryAllPages(dataSourceId) {
  const all = [];
  let cursor = null;
  do {
    const body = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) };
    const r = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN.trim()}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Notion API ${r.status}: ${text}`);
    const json = JSON.parse(text);
    all.push(...(json.results || []));
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);
  return all;
}

function extractTitle(prop) {
  if (!prop || prop.type !== 'title') return '';
  return (prop.title || []).map(r => r.plain_text).join('').replace(/^\d+\.\d+\s+/, '').trim();
}
function extractRichText(prop) {
  if (!prop || !prop.rich_text) return '';
  return (prop.rich_text || []).map(r => r.plain_text).join('');
}
function extractSelect(prop) { return prop?.type === 'select' ? (prop.select?.name || null) : null; }
function extractMultiSelect(prop) { return prop?.type === 'multi_select' ? (prop.multi_select || []).map(o => o.name) : []; }
function extractCheckbox(prop) { return prop?.type === 'checkbox' ? !!prop.checkbox : false; }
function extractIcon(icon) {
  if (!icon) return null;
  if (icon.type === 'emoji') return icon.emoji;
  if (icon.type === 'external') return icon.external?.url;
  if (icon.type === 'file') return icon.file?.url;
  return null;
}
function uniq(arr) { return [...new Set(arr)].sort((a, b) => a.localeCompare(b, 'ru')); }
