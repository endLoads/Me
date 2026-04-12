async function fetchChildren(id, token) {
  const rows = [];
  let cursor;
  do {
    const url = `https://api.notion.com/v1/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" },
    });
    const data = await r.json();
    if (!r.ok) break;
    rows.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return rows;
}

function rt(arr) {
  return (arr || []).map((t) => t.plain_text).join("").trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: "NOTION_TOKEN not set" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "id required" });

  try {
    const blocks = await fetchChildren(id, token);
    const lines = [];

    for (const b of blocks) {
      const type = b.type;

      // ── Таблица — читаем дочерние строки ──────────────────────────────
      if (type === "table") {
        const hasHdr = b.table?.has_column_header ?? true;
        const children = await fetchChildren(b.id, token);
        children.forEach((row, i) => {
          if (hasHdr && i === 0) return; // пропускаем заголовок
          const cells = (row.table_row?.cells || []).map((c) =>
            c.map((t) => t.plain_text).join("").trim()
          );
          if (cells.some(Boolean)) lines.push({ type: "table_row", cells });
        });
        continue;
      }

      // ── Callout ────────────────────────────────────────────────────────
      if (type === "callout") {
        const text = rt(b.callout?.rich_text);
        const icon = b.callout?.icon?.emoji || "";
        if (text) lines.push({ type: "callout", text: (icon ? icon + " " : "") + text });
        continue;
      }

      // ── Quote ──────────────────────────────────────────────────────────
      if (type === "quote") {
        const text = rt(b.quote?.rich_text);
        if (text) lines.push({ type: "callout", text });
        continue;
      }

      // ── Заголовки ──────────────────────────────────────────────────────
      if (type === "heading_1" || type === "heading_2" || type === "heading_3") {
        const text = rt(b[type]?.rich_text);
        if (text) lines.push({ type, text });
        continue;
      }

      // ── Нумерованный список ────────────────────────────────────────────
      if (type === "numbered_list_item") {
        const text = rt(b.numbered_list_item?.rich_text);
        if (text) lines.push({ type: "numbered_list_item", text });
        continue;
      }

      // ── Маркированный список ───────────────────────────────────────────
      if (type === "bulleted_list_item") {
        const text = rt(b.bulleted_list_item?.rich_text);
        if (text) lines.push({ type: "bulleted_list_item", text });
        continue;
      }

      // ── Параграф ───────────────────────────────────────────────────────
      if (type === "paragraph") {
        const text = rt(b.paragraph?.rich_text);
        if (text) lines.push({ type: "paragraph", text });
        continue;
      }

      // ── Разделитель ────────────────────────────────────────────────────
      if (type === "divider") {
        lines.push({ type: "divider", text: "" });
        continue;
      }
    }

    res.status(200).json({ lines });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
