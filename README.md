## DCA Bot Suite

This repository is split into two deployable apps:

- `bot/` - the Discord bot runtime, slash commands, ticket threads, reaction roles, YouTube checks, and member count sync.
- `dashboard/` - the standalone React dashboard with an Express API. It is ready for Vercel.

For separate deployments, set the same `DATABASE_URL` in both apps. The dashboard and bot share configuration, tickets, recruitment logs, and combined bot logs through that database. Without `DATABASE_URL`, each app falls back to local JSON files for development.

## Recruitment Tickets

The recruitment panel posts an `Apply!` button. Applicants get ephemeral prompts, upload an uncropped driver's license screenshot, choose whether they have recent team event score screenshots, and then receive a recruitment thread in the same channel.

Recruiters can manage everything from buttons or `/tickets` slash subcommands:

- `/tickets setup`, `/tickets sync-panel`, `/tickets status`, `/tickets logs`
- `/tickets claim`, `/tickets close`, `/tickets add`, `/tickets massadd`
- `/tickets remove`, `/tickets rename`, `/tickets tutorial`, `/tickets archive`, `/tickets delete`

Closing a ticket requires the recruiter to choose `Discord`, `Discord²`, `Discord 3™`, `Nascar DC`, or `Rejected`. Accepted recruits can automatically increment the configured member count team, and all outcomes are written to recruitment logs plus the combined dashboard log.

Discord does not support collecting file uploads inside ephemeral messages, so the bot prompts privately and collects the applicant's next image upload in the channel.

## Bot Setup On Render

```bash
cd bot
npm install
npm run deploy:commands
npm start
```

Required Render env:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DATABASE_URL=postgres_connection_string_shared_with_dashboard
```

Optional bootstrap env:

```env
DISCORD_GUILD_ID=your_server_id
RECRUITER_ROLE_ID=role_that_can_manage_recruitment
PORT=3001
DATABASE_SSL=true
```

Guild ID, recruiter role, logging channels, ticket panel channels, reaction roles, YouTube feeds, welcome/leave messages, and member count settings can be managed from the dashboard after the first login.

## Dashboard Setup On Vercel

```bash
cd dashboard
npm install
npm run build
npm start
```

Required Vercel env:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_CLIENT_SECRET=your_oauth_secret
DATABASE_URL=same_postgres_connection_string_as_bot
DASHBOARD_BASE_URL=https://your-dashboard.vercel.app
DISCORD_REDIRECT_URI=https://your-dashboard.vercel.app/auth/discord/callback
DASHBOARD_SESSION_SECRET=a_long_random_secret
```

Bootstrap env for first dashboard login:

```env
DISCORD_GUILD_ID=your_server_id
DASHBOARD_ALLOWED_ROLE_ID=role_that_can_open_dashboard
```

After login, those IDs can be saved in the Server page. Keep the Discord OAuth secret, bot token, session secret, and database URL in env.

Optional upload env:

```env
DASHBOARD_UPLOAD_CHANNEL_ID=discord_channel_for_tutorial_video_attachments
DASHBOARD_UPLOAD_LIMIT=100mb
DATABASE_SSL=true
```

The dashboard also has a `Tutorial upload channel` selector in ticket settings. On Vercel, use a Discord upload channel or paste video URLs manually, because serverless disk storage is temporary.

## Local Development

Run the bot:

```bash
cd bot
npm install
npm run deploy:commands
npm start
```

Run the dashboard API and built UI:

```bash
cd dashboard
npm install
npm run build
npm start
```

Open `http://localhost:3000/dashboard`.

For Vite frontend development, run `npm run dev` in `dashboard/` and keep the dashboard API on port `3000`.

## Notes

- Use one shared Postgres database for Render and Vercel.
- JSON fallback paths can be overridden with `DASHBOARD_CONFIG_PATH`, `RECRUITMENT_TICKETS_PATH`, `RECRUITMENT_LOGS_PATH`, and `BOT_LOGS_PATH`.
- The bot exposes `/` and `/health` for Render health checks; the dashboard has its own `/` and `/health`.

## Contributors

- **Drago**
- **Devil**
- **BlackWing**
