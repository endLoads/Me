// api/page.js — Vercel Serverless Function
// Читает страницу рецепта из Notion, возвращает структурированные данные.
//
// Ответ:
//   { format: "v1", data: {...}, warnings: [...], last_edited, created_at, id }
//   { format: "v0", blocks: [...], last_edited, created_at, id }   ← legacy fallback
//   { error: "...", details: [...] }                                 ← невалидный JSON

import { validate } from '../lib/validator.mjs';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = '2025-09-03';

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id parameter' });

  try {
    const pageId = normalizeId(id);

    const [pageMeta, blocks] = await Promise.all([
      fetchPageMeta(pageId),
      fetchAllBlocks(pageId)
    ]);

    const metadata = {
      id: pageId,
      last_edited: pageMeta.last_edited_time,
      created_at: pageMeta.created_time
    };

    // Ищем первый code-блок с language=json, начинающийся с { "schema": ...
    const jsonBlock = blocks.find(b =>
      b.type === 'code' &&
      b.code?.language === 'json' &&
      extractText(b.code.rich_text).trim().startsWith('{')
    );

    if (jsonBlock) {
      const raw = extractText(jsonBlock.code.rich_text);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return res.status(200).json({
          error: 'invalid_json',
          message: 'JSON не парсится: ' + e.message,
          raw_snippet: raw.slice(0, 200),
          ...metadata
        });
      }

      const schemaVersion = String(parsed.schema || '');
      const major = schemaVersion.split('.')[0];
      if (major !== '1') {
        return res.status(200).json({
          error: 'unsupported_schema',
          message: `Схема ${schemaVersion} не поддерживается (ожидается 1.x)`,
          ...metadata
        });
      }

      const result = validate(parsed);
      if (!result.valid) {
        return res.status(200).json({
          error: 'validation_failed',
          message: 'Рецепт не соответствует схеме',
          details: result.errors,
          ...metadata
        });
      }

      return res.status(200).json({
        format: 'v1',
        data: result.data,
        warnings: result.warnings,
        ...metadata
      });
    }

    // FALLBACK: старый формат
    const v0Blocks = await hydrateLegacyBlocks(blocks);
    return res.status(200).json({
      format: 'v0',
      blocks: v0Blocks,
      ...metadata
    });
  } catch (err) {
    console.error('[api/page]', err);
    return res.status(500).json({ error: err.message });
  }
}

async function notionFetch(path) {
  const r = await fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN.trim()}`,
      'Notion-Version': NOTION_VERSION
    }
  });
  if (!r.ok) throw new Error(`Notion API ${r.status}: ${await r.text()}`);
  return r.json();
}

async function fetchPageMeta(pageId) {
  return notionFetch(`/pages/${pageId}`);
}

async function fetchAllBlocks(parentId) {
  const all = [];
  let cursor = null;
  do {
    const q = cursor ? `?start_cursor=${cursor}&page_size=100` : '?page_size=100';
    const res = await notionFetch(`/blocks/${parentId}/children${q}`);
    all.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return all;
}

async function hydrateLegacyBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === 'table') {
      const rows = await fetchAllBlocks(b.id);
      out.push({ ...b, _children: rows });
    } else {
      out.push(b);
    }
  }
  return out;
}

function normalizeId(id) {
  const hex = id.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('Invalid Notion page ID');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function extractText(richText) {
  return (richText || []).map(r => r.plain_text || '').join('');
}
