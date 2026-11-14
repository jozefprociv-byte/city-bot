# Що там у місті — Telegram-бот на Netlify

Node.js (grammY) + webhook + Supabase (Postgres). Без постійного процесу.

## Розгортання

1. **Supabase**: створи проєкт → SQL Editor → встав `schema.sql` → Run.
   Settings → API: скопіюй `Project URL` і ключ `service_role`.
2. **Telegram**: @BotFather → `/newbot` → скопіюй токен.
3. **Netlify**: New site from Git → вибери цей репозиторій.
   У Site settings → Environment variables додай:
   - `BOT_TOKEN` — токен від BotFather
   - `SUPABASE_URL` — Project URL
   - `SUPABASE_SERVICE_KEY` — ключ service_role (секретний!)
   - `WEBHOOK_SECRET` — довільний рядок (літери, цифри, `_`, `-`)
4. Після деплою відкрий у браузері (підстав свої значення):
   ```
   https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<твій-сайт>.netlify.app/api/bot&secret_token=<WEBHOOK_SECRET>
   ```
   Має відповісти `"ok": true`.
5. Напиши боту `/start`.
