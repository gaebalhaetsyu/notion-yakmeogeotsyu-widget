// 약 먹었슈 v1.1 중계 서버 (Vercel 함수 한 개)
// 위젯(브라우저)은 노션을 직접 못 부르므로, 이 서버가 대신 노션 표를 읽고 쓴다.
// 환경변수: NOTION_TOKEN(노션 통합 토큰), DATABASE_ID(「약 먹었슈 기록」 표 id), KEY(주소 뒤에 붙이는 암호)
const NOTION = "https://api.notion.com/v1";
const COL = { am: "아침", noon: "점심", pm: "저녁", bed: "자기 전" };
const okDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const okTime = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

async function notion(path, method, body) {
  const r = await fetch(NOTION + path, {
    method,
    headers: {
      Authorization: "Bearer " + process.env.NOTION_TOKEN,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error("notion " + r.status + " " + (j.message || ""));
  return j;
}

function props(date, day) {
  const p = { 이름: { title: [{ text: { content: date } }] }, 날짜: { date: { start: date } } };
  Object.keys(COL).forEach((k) => {
    p[COL[k]] = { rich_text: okTime(day[k]) ? [{ text: { content: day[k] } }] : [] };
  });
  return p;
}

function readDay(page) {
  const day = {};
  Object.keys(COL).forEach((k) => {
    const t = ((page.properties[COL[k]] || {}).rich_text || []).map((x) => x.plain_text).join("").trim();
    if (okTime(t)) day[k] = t;
  });
  return day;
}

async function query(filter) {
  const pages = [];
  let cursor;
  do {
    const j = await notion("/databases/" + process.env.DATABASE_ID + "/query", "POST", {
      filter, page_size: 100, start_cursor: cursor,
    });
    pages.push(...j.results);
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor);
  return pages;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!process.env.KEY || req.query.key !== process.env.KEY) return res.status(401).json({ error: "key" });

  try {
    if (req.method === "GET") {
      const from = okDate(req.query.from) ? req.query.from : "2000-01-01";
      const pages = await query({ property: "날짜", date: { on_or_after: from } });
      const log = {};
      pages.forEach((p) => {
        const d = ((p.properties["날짜"] || {}).date || {}).start;
        const day = readDay(p);
        if (okDate(d) && Object.keys(day).length) log[d] = Object.assign(log[d] || {}, day);
      });
      return res.status(200).json({ log });
    }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const date = body.date, day = body.day && typeof body.day === "object" ? body.day : {};
      if (!okDate(date)) return res.status(400).json({ error: "date" });
      const found = await query({ property: "날짜", date: { equals: date } });
      const empty = !Object.keys(COL).some((k) => okTime(day[k]));
      if (found.length) {
        // 같은 날짜 줄이 여러 개면 첫 줄만 쓰고 나머지는 휴지통으로
        await notion("/pages/" + found[0].id, "PATCH", empty ? { archived: true } : { properties: props(date, day) });
        for (const extra of found.slice(1)) await notion("/pages/" + extra.id, "PATCH", { archived: true });
      } else if (!empty) {
        await notion("/pages", "POST", { parent: { database_id: process.env.DATABASE_ID }, properties: props(date, day) });
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "method" });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
};
