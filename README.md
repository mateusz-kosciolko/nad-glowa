# 10x Astro Starter

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v7 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v6 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run smoke` - Smoke test the auth flow against a running server (`BASE_URL`, defaults to `http://localhost:4321`); reads `.dev.vars` and needs the local Supabase `service_role` key
- `npm run cron:local` - Run the minute job locally: calls the Worker's `scheduled` handler every 60 s on a running `npm run dev` (`BASE_URL`, defaults to `http://localhost:4321`). Each run is recorded in the `cron_runs` table and shown on the dashboard as "Last cron run"
- `npm run test:db` - Run the pgTAP database tests in `supabase/tests/` against the local Supabase
- `npm run cf:types` - Regenerate `worker-configuration.d.ts` (Cloudflare Workers types)

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── assets/ # Static assets
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

Add the `service_role` key to `.dev.vars` only (never to client code). The minute job (`npm run cron:local`) uses it to record its runs, because it has no user session, and `npm run smoke` uses it to create and delete its test account. Print it again at any time with `npx supabase status`:

```
SUPABASE_SERVICE_KEY=<service_role key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

`npx supabase start` applies the migrations in `supabase/migrations/` (alert settings and the `cron_runs` job log). To apply migrations added later without wiping local data, run `npx supabase migration up`.

### Telegram alerts

Aircraft alerts are delivered by a Telegram bot. To set up the channel from scratch:

1. In Telegram, talk to [@BotFather](https://t.me/BotFather), send `/newbot` and follow the prompts. It replies with the bot token.
2. Add the token to `.dev.vars` (production prerequisites are listed in `context/deployment/deploy-plan.md`). It is a server-only secret read through `astro:env/server`:

```
TELEGRAM_BOT_TOKEN=<token from BotFather>
```

3. Open a chat with your bot and press **Start** — a bot cannot message you before you do.
4. Get your chat ID from [@userinfobot](https://t.me/userinfobot) (send it any message; it replies with your numeric ID).
5. Paste the chat ID into **Telegram chat ID** on `/settings` and save.
6. Press **Send test message** below the settings form. The message arrives in your chat, or the page shows Telegram's error (e.g. "chat not found").

To stop alerts for a while (e.g. on holiday), press **Pause alerts** on the dashboard; no alerts are sent until you press **Resume alerts**. The minute job keeps running and your settings stay as they are.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Creating accounts

Access is by invitation only: the app has no sign-up page and Supabase rejects sign-ups (`enable_signup = false` in the `[auth]` section of `supabase/config.toml` — not in `[auth.email]`, which would also disable email sign-in; on production, **Authentication → Sign In / Providers → Allow new users to sign up** is off). An administrator creates each account by hand:

1. Open the Supabase dashboard for the project (locally: Studio at `http://127.0.0.1:54323`)
2. Go to **Authentication → Users → Add user → Create new user**
3. Enter the email and password and tick **Auto Confirm User**

The user can sign in right away. A trigger creates the account's `alert_settings` row.

### Auth routes

| Route          | Description                                                         |
| -------------- | ------------------------------------------------------------------- |
| `/auth/signin` | Email/password sign-in form (the only page open to anonymous users) |
| `/`            | Redirects to `/dashboard`                                           |
| `/dashboard`   | Dashboard for signed-in users                                       |

Route protection is handled in `src/middleware.ts` and is closed by default: every route requires a signed-in user unless its exact path is listed in `PUBLIC_ROUTES` there (sign-in page plus the sign-in and sign-out endpoints). Anonymous requests to any other path are redirected to `/auth/signin`.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

## Smoke test

`scripts/smoke.mjs` is a dependency-free Node script that walks the whole auth flow over HTTP: anonymous redirects, closed sign-up (in the app and in Supabase), sign-in, protected pages, settings and sign-out. Run it against the dev server or the production preview after dependency upgrades:

```bash
npm run dev            # or: npm run build && npm run preview
npm run smoke          # BASE_URL defaults to http://localhost:4321
```

Because sign-up is closed, the script creates its test account through the Supabase Admin API and deletes it after the run, even when a step fails. It reads `SUPABASE_URL`, `SUPABASE_KEY` and `SUPABASE_SERVICE_KEY` from `.dev.vars` and needs the `service_role` key of the **local** Supabase. It refuses to run (without sending any request) when `SUPABASE_URL` is not `127.0.0.1`, `localhost` or `::1` — never point it at production.

> **Note:** this script exists primarily to guard the development of the starter itself — it is a fast sanity check that dependency upgrades did not break the build, the Cloudflare adapter or the Supabase auth flow. It is **not** a substitute for a real test suite. Once you build your own product on top of this starter, add proper tests (unit, integration, end-to-end) suited to your application.

## CI

GitHub Actions runs two jobs on every push and PR to `master`:

- **ci** — lint, `astro check` and build. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets for the build step.
- **smoke** — starts a local Supabase via the Supabase CLI, builds, serves the production preview on the Cloudflare runtime and runs `npm run smoke` against it. No secrets required.

## License

MIT
