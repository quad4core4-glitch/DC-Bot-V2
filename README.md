## DCA Bot Suite

This repository is split into two deployable apps:

- `bot/` - the Discord bot runtime and slash commands.
- `dashboard/` - the standalone Express dashboard and static control panel.

They can be copied into separate GitHub repositories. For separate deployments, set the same `DATABASE_URL` in both apps so dashboard changes, recruitment tickets, and member logs are shared. Without `DATABASE_URL`, each app falls back to local JSON files for development.

## Recruitment Tickets

The recruitment system posts an Apply panel with an `Apply!` button. Applicants are guided through ephemeral prompts, upload their driver's license screenshot, optionally upload team event screenshots, and then get a recruitment thread in the same parent channel.

Recruiters can use thread buttons to claim tickets, send uploaded dashboard tutorial videos, and close the ticket. Closing asks for one outcome button: `Discord`, `Discord²`, `Discord 3™`, `Nascar DC`, or `Rejected`. The result is stored in member logs and posted to the configured log channel.

Discord does not support uploading files directly inside ephemeral messages, so the bot asks privately and collects the applicant's next image upload in the channel. It deletes the upload message when it has permission to do so.

## Bot Setup

```bash
cd bot
npm install
npm run deploy:commands
npm start
```

Required bot env:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_server_id
RECRUITER_ROLE_ID=role_that_can_manage_recruitment
DATABASE_URL=postgres_connection_string_recommended_for_split_deploys
PORT=3000
```

Recruiter role members should have access to the recruitment parent channel. If private threads are enabled, give recruiters `Manage Threads` in that channel so they can see private application threads.

## Dashboard Setup

```bash
cd dashboard
npm install
npm start
```

Required dashboard env:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_CLIENT_SECRET=your_oauth_secret
DISCORD_GUILD_ID=your_server_id
DASHBOARD_ALLOWED_ROLE_ID=role_that_can_open_dashboard
RECRUITER_ROLE_ID=role_that_can_manage_recruitment
DATABASE_URL=same_postgres_connection_string_as_bot
DASHBOARD_BASE_URL=https://your-dashboard-host
DISCORD_REDIRECT_URI=https://your-dashboard-host/auth/discord/callback
DASHBOARD_SESSION_SECRET=a_long_random_secret
DASHBOARD_PUBLIC_URL=https://your-dashboard-host
```

Optional dashboard env:

```env
DASHBOARD_UPLOAD_DIR=/persistent/uploads
DASHBOARD_UPLOAD_LIMIT=100mb
DATABASE_SSL=true
```

Add the same redirect URL in the Discord Developer Portal under OAuth2 redirects. Uploaded tutorial videos are served from `/uploads/...`, so use persistent storage for `DASHBOARD_UPLOAD_DIR` on hosts with ephemeral filesystems.

## Dashboard

Open `/dashboard` on the dashboard app. Current sections:

- Welcome and leave messages
- Recruitment ticket configuration, tutorial uploads, Apply panel sync, and member logs
- Reaction role message management
- Access/session status

## Notes

- `DATABASE_URL` is strongly recommended when the bot and dashboard are deployed separately.
- JSON fallback paths can be overridden with `DASHBOARD_CONFIG_PATH`, `RECRUITMENT_TICKETS_PATH`, and `RECRUITMENT_LOGS_PATH`.
- The bot still exposes `/` and `/health` for host health checks; the dashboard has its own `/` and `/health`.

## Contributors
- **Drago**
- **Devil**
- **BlackWing**