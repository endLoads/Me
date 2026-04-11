export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: "NOTION_TOKEN not set" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "id required" });

  try {
    const r = await fetch(`https://api.notion.com/v1/blocks/${id}/children?page_size=100`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
      },
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    const blocks = data.results || [];
    const lines = [];

    for (const b of blocks) {
      const type = b.type;
      const rich = b[type]?.rich_text || [];
      const text = rich.map((t) => t.plain_text).join("").trim();
      if (text) lines.push({ type, text });
    }

    res.status(200).json({ lines });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
