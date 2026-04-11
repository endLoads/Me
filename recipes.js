const DB_ID = "adf9da1a986c4b2da0bce2ee88c8f192";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: "NOTION_TOKEN not set" });

  try {
    let results = [];
    let cursor = undefined;

    do {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;

      const r = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);

      results = results.concat(data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const recipes = results.map((p) => ({
      id: p.id,
      title: p.properties["Название"]?.title?.[0]?.plain_text || "Без названия",
      cat: p.properties["Раздел"]?.select?.name || "",
      time: p.properties["Время"]?.rich_text?.[0]?.plain_text || "",
      tech: (p.properties["Техника"]?.multi_select || []).map((t) => t.name),
      who: (p.properties["Для кого"]?.multi_select || []).map((t) => t.name),
      checked: p.properties["Проверен"]?.checkbox || false,
    }));

    recipes.sort((a, b) => a.title.localeCompare(b.title, "ru"));

    res.status(200).json(recipes);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
