import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { createClient } from "@supabase/supabase-js";

const { BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY, WEBHOOK_SECRET } = process.env;

const REPORT_TTL_MS = 3 * 60 * 60 * 1000; // скільки живе повідомлення
const COOLDOWN_MS = 30 * 1000;            // пауза між повідомленнями
const FEED_LIMIT = 8;
const HIDE_AT = 3;                        // ховаємо, якщо (мінуси - плюси) >= 3
const MAX_TEXT = 200;
const H = { parse_mode: "HTML" };

const CATS = {
  light: "💡 Світло",
  queue: "🧍 Черга",
  traffic: "🚗 Затор",
  shop: "🏪 Магазин / заправка",
  other: "📌 Інше",
};

const WELCOME =
  "👋 <b>Що там у місті</b>\n\n" +
  "Жива стрічка від людей: де світло, де черга, де затор, що відкрите.\n\n" +
  "/report — розповісти, що зараз відбувається\n" +
  "/feed — що кажуть у твоєму місті\n" +
  "/city — змінити місто";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});
const bot = new Bot(BOT_TOKEN);

// ---------- Допоміжне ----------

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&", "<": "<", ">": ">" })[c]);
const titleCase = (s) => s.replace(/(^|[\s-])\S/g, (m) => m.toUpperCase());

const ago = (iso) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "щойно";
  if (m < 60) return `${m} хв тому`;
  return `${Math.floor(m / 60)} год тому`;
};

async function getUser(id) {
  const { data } = await sb.from("users").select("*").eq("user_id", id).maybeSingle();
  return data;
}

async function patchUser(id, patch) {
  const { error } = await sb.from("users").upsert({ user_id: id, ...patch });
  if (error) throw error;
}

async function askCity(ctx) {
  await patchUser(ctx.from.id, { mode: "city" });
  await ctx.reply("Напиши назву свого міста, наприклад: <b>Київ</b>", H);
}

const voteKb = (id) =>
  new InlineKeyboard().text("👍 Актуально", `vote:${id}:up`).text("👎 Вже ні", `vote:${id}:down`);

// ---------- Команди ----------

bot.command("start", async (ctx) => {
  const user = await getUser(ctx.from.id);
  await patchUser(ctx.from.id, { mode: null });
  await ctx.reply(WELCOME, H);
  if (!user?.city) await askCity(ctx);
});

bot.command("city", askCity);

bot.command("cancel", async (ctx) => {
  await patchUser(ctx.from.id, { mode: null });
  await ctx.reply("Скасовано.");
});

bot.command("report", async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (!user?.city) return askCity(ctx);

  const wait = COOLDOWN_MS - (Date.now() - new Date(user.last_report).getTime());
  if (wait > 0) {
    return ctx.reply(`Зачекай ще ${Math.ceil(wait / 1000)} с перед наступним повідомленням.`);
  }

  const kb = new InlineKeyboard();
  Object.entries(CATS).forEach(([k, v], i) => {
    kb.text(v, `cat:${k}`);
    if (i % 2) kb.row();
  });
  await ctx.reply("Що саме відбувається?", { reply_markup: kb });
});

bot.callbackQuery(/^cat:(\w+)$/, async (ctx) => {
  const cat = ctx.match[1];
  if (!CATS[cat]) return ctx.answerCallbackQuery();
  await patchUser(ctx.from.id, { mode: "text", cat });
  await ctx.editMessageText(
    `${CATS[cat]}\n\nНапиши, де саме і що там. Наприклад:\n` +
      "<i>Оболонь, АТБ на Богатирській — черга хвилин на 15</i>\n\n/cancel — скасувати",
    H
  );
  await ctx.answerCallbackQuery();
});

bot.command("feed", async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (!user?.city) return askCity(ctx);

  const since = new Date(Date.now() - REPORT_TTL_MS).toISOString();
  const { data } = await sb
    .from("reports")
    .select("*")
    .eq("city", user.city)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(30);

  const rows = (data ?? []).filter((r) => r.downs - r.ups < HIDE_AT).slice(0, FEED_LIMIT);
  const title = esc(titleCase(user.city));

  if (!rows.length) {
    return ctx.reply(`У місті <b>${title}</b> поки тихо. Будь першим: /report`, H);
  }

  await ctx.reply(`📍 <b>${title}</b>: останні повідомлення`, H);
  for (const r of rows) {
    await ctx.reply(
      `${CATS[r.category] ?? "📌"} · <i>${ago(r.created_at)}</i>\n` +
        `${esc(r.text)}\n👍 ${r.ups}   👎 ${r.downs}`,
      { ...H, reply_markup: voteKb(r.id) }
    );
  }
});

bot.callbackQuery(/^vote:(\d+):(up|down)$/, async (ctx) => {
  const { data } = await sb.rpc("vote_report", {
    p_report: Number(ctx.match[1]),
    p_user: ctx.from.id,
    p_dir: ctx.match[2],
  });
  const texts = {
    ok: "Дякую! 🙌",
    own: "Свій запис оцінювати не можна 🙂",
    dup: "Ти вже голосував за цей запис.",
    gone: "Запис уже зник.",
  };
  await ctx.answerCallbackQuery({
    text: texts[data] ?? "Щось пішло не так.",
    show_alert: data === "own" || data === "dup",
  });
  if (data === "ok" || data === "gone") await ctx.editMessageReplyMarkup().catch(() => {});
});

// ---------- Вільний текст (місто / текст повідомлення) ----------

bot.on("message:text", async (ctx) => {
  const user = await getUser(ctx.from.id);
  const t = ctx.message.text.trim();

  if (user?.mode === "city") {
    const city = t.toLowerCase().split(/\s+/).join(" ");
    if (city.length < 2 || city.length > 40) {
      return ctx.reply("Напиши коротку назву міста, до 40 символів.");
    }
    await patchUser(ctx.from.id, { city, mode: null });
    return ctx.reply(
      `✅ Місто: <b>${esc(titleCase(city))}</b>\nТепер можна /report або /feed`,
      H
    );
  }

  if (user?.mode === "text" && user.city) {
    if (t.length < 5) return ctx.reply("Занадто коротко, напиши трохи детальніше.");
    if (t.length > MAX_TEXT) return ctx.reply(`Занадто довго, максимум ${MAX_TEXT} символів.`);

    const { error } = await sb.from("reports").insert({
      city: user.city,
      category: user.cat,
      text: t,
      user_id: ctx.from.id,
    });
    if (error) throw error;
    await patchUser(ctx.from.id, { mode: null, last_report: new Date().toISOString() });
    return ctx.reply("✅ Дякую! Твоє повідомлення вже в стрічці міста. /feed");
  }

  await ctx.reply("Скористайся командами: /report або /feed");
});

bot.catch((err) => console.error("Bot error:", err));

// ---------- Webhook для Netlify ----------

export default webhookCallback(bot, "std/http", { secretToken: WEBHOOK_SECRET });
export const config = { path: "/api/bot" };
