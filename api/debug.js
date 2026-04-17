// api/debug.js — диагностика подключения к Notion.
// Не использует никаких API-специфичных эндпоинтов, кроме базовых. Безопасно публикуется.
// Удалить после фикса.

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = '2022-06-28';
const DATABASE_ID    = 'adf9da1a-986c-4b2d-a0bc-e2ee88c8f192';
const DATA_SOURCE_ID = '252e8d34-ac92-42af-bedf-cfbd7f3a4e9d';

export default async function handler(req, res) {
  const report = {
    env: {
      has_token: !!NOTION_TOKEN,
      token_length: NOTION_TOKEN ? NOTION_TOKEN.length : 0,
      token_prefix: NOTION_TOKEN ? NOTION_TOKEN.slice(0, 6) + '...' : null,
      token_suffix: NOTION_TOKEN ? '...' + NOTION_TOKEN.slice(-4) : null,
      token_has_whitespace: NOTION_TOKEN ? NOTION_TOKEN !== NOTION_TOKEN.trim() : false,
      token_looks_like_secret: NOTION_TOKEN ? /^(secret_|ntn_)/.test(NOTION_TOKEN.trim()) : false
    },
    checks: []
  };

  if (!NOTION_TOKEN) {
    report.error = 'NOTION_TOKEN env variable is missing';
    return res.status(200).json(report);
  }

  const token = NOTION_TOKEN.trim();

  // 1) Кто мы? — /v1/users/me
  report.checks.push(await callNotion('users/me (whoami)', 'GET', `https://api.notion.com/v1/users/me`, token));

  // 2) Что видит интеграция? — /v1/search (пустой запрос = всё доступное)
  report.checks.push(await callNotion('search (list of accessible objects)', 'POST', `https://api.notion.com/v1/search`, token, {
    page_size: 20
  }));

  // 3) Пробуем достать саму базу (databases endpoint со старым API)
  report.checks.push(await callNotion(`databases/${DATABASE_ID}`, 'GET', `https://api.notion.com/v1/databases/${DATABASE_ID}`, token));

  // 4) Query database с database_id
  report.checks.push(await callNotion(`databases/${DATABASE_ID}/query`, 'POST', `https://api.notion.com/v1/databases/${DATABASE_ID}/query`, token, { page_size: 1 }));

  // 5) Query database с data_source_id
  report.checks.push(await callNotion(`databases/${DATA_SOURCE_ID}/query (data_source_id)`, 'POST', `https://api.notion.com/v1/databases/${DATA_SOURCE_ID}/query`, token, { page_size: 1 }));

  return res.status(200).json(report);
}

async function callNotion(label, method, url, token, body) {
  const t0 = Date.now();
  try {
    const opts = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      }
    };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(url, opts);
    const text = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}

    // Собираем только важное, чтобы не раздувать ответ
    const summary = {
      label,
      status: r.status,
      ok: r.ok,
      ms: Date.now() - t0
    };
    if (r.ok) {
      if (parsed?.object === 'user') {
        summary.result = { type: parsed.type, name: parsed.name, bot_workspace: parsed.bot?.workspace_name, bot_owner: parsed.bot?.owner?.type };
      } else if (parsed?.object === 'list') {
        summary.result = {
          total_returned: (parsed.results || []).length,
          has_more: !!parsed.has_more,
          sample: (parsed.results || []).slice(0, 5).map(x => ({
            object: x.object,
            id: x.id,
            title: extractTitle(x)
          }))
        };
      } else if (parsed?.object === 'database') {
        summary.result = { title: extractTitle(parsed), id: parsed.id, archived: parsed.archived };
      } else {
        summary.result = { object: parsed?.object };
      }
    } else {
      summary.error = {
        code: parsed?.code,
        message: parsed?.message,
        integration_id: parsed?.additional_data?.integration_id
      };
    }
    return summary;
  } catch (e) {
    return { label, status: 0, ok: false, error: { message: e.message } };
  }
}

function extractTitle(obj) {
  const t = obj?.title || obj?.properties?.title?.title || obj?.properties?.Name?.title;
  if (Array.isArray(t)) return t.map(x => x.plain_text).join('');
  if (Array.isArray(obj?.title)) return obj.title.map(x => x.plain_text).join('');
  return obj?.url || null;
}
