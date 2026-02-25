# Obsidian Notes Publisher (Live Server Edition)

A live server that automatically syncs your Obsidian notes from Google Drive and publishes them as a beautiful website.

## Features

- 🔄 **Auto-sync** from Google Drive - no manual rebuilds
- 🧠 **Incremental sync** with persisted registry/render cache
- 📝 Full Obsidian syntax support
- 🔍 Full-text search with query filters (`tag:`, `folder:`, `vault:`, `is:`)
- 🏷️ Tag and metadata endpoints
- 🔐 Frontmatter publishing controls (`draft`, `private`, `unlisted`, `published_at`)
- 🧵 Comment workflow with inline anchors, resolve/reopen, and mentions
- 🔔 Web push notifications (published notes + mentions/replies)
- 🗂️ Vault-aware API surface
- 📥 Export as Markdown or PDF
- 🌙 Dark/Light mode
- 📱 Mobile responsive

## Quick Start

### 1. Set Up Google Cloud (one-time, ~10 min)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Enable the **Google Drive API**:
   - Go to APIs & Services → Library
   - Search "Google Drive API" → Enable
4. Create OAuth credentials:
   - Go to APIs & Services → Credentials
   - Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Add authorized redirect URIs:
     - `http://localhost:3000/auth/google/callback` (app login)
     - `http://localhost:3001/callback` (setup script)
   - Save your **Client ID** and **Client Secret**

### 2. Get Your Google Drive Folder ID

1. Open Google Drive in your browser
2. Navigate to your "OME Medicine 1" folder
3. Copy the folder ID from the URL:
   ```
   https://drive.google.com/drive/folders/THIS_IS_YOUR_FOLDER_ID
                                          ^^^^^^^^^^^^^^^^^^^^^^^^
   ```

### 3. Configure the App

Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` with your values:
```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REFRESH_TOKEN=  # We'll get this next
GOOGLE_DRIVE_FOLDER_ID=your_folder_id
SITE_NAME=OME Medicine Notes
```

### 4. Get Refresh Token

Make sure your `.env` contains `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then run:
```bash
npm install
npm run setup
```

This will open a browser window. Authorize the app, then copy the refresh token to your `.env` file.

### 5. Run Locally

```bash
npm run build  # Copy frontend files
npm start      # Start server
```

Open http://localhost:3000

## Deploy to Render

### 1. Push to GitHub

```bash
git init
echo "node_modules/" > .gitignore
echo ".env" >> .gitignore
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. Deploy on Render

1. Go to [render.com](https://render.com) and sign up
2. New → Web Service
3. Connect your GitHub repo
4. Configure:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
5. Add Environment Variables (from your `.env` file)
6. Deploy!

Your site will be live at `https://your-app.onrender.com`

### 3. Custom Domain (Optional)

In Render dashboard → Your service → Settings → Custom Domains

## Deploy on Private Server (HomeLab)

For the current self-hosted production topology (Docker Compose, systemd timer auto-deploy, Cloudflare Tunnel, and Caddy routing), see:

- `docs/DEPLOYMENT-HOMELAB.md`

## How It Works

1. When someone visits your site, the server fetches notes from Google Drive
2. Notes are cached for 5 minutes for performance
3. When you update notes in Obsidian → they sync to Google Drive → site shows updates automatically

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | OAuth client ID from Google Cloud |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Generated via setup script |
| `GOOGLE_DRIVE_FOLDER_ID` | ID of your notes folder |
| `ATTACHMENTS_FOLDER_ID` | Google Drive folder ID for your attachments/images |
| `CORS_ORIGIN` | Comma-separated allowlist for cross-origin requests |
| `DRIVE_FETCH_CONCURRENCY` | Parallel fetch count for Drive note loading (default: 6) |
| `SYNC_INTERVAL_SECONDS` | Background sync interval in seconds (default: 180) |
| `VAPID_PUBLIC_KEY` | VAPID public key for Web Push |
| `VAPID_PRIVATE_KEY` | VAPID private key for Web Push |
| `VAPID_SUBJECT` | VAPID subject (for example: `mailto:admin@domain.com`) |
| `SITE_NAME` | Title shown in header |
| `PORT` | Server port (default: 3000) |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/notes` | Get all notes with folder tree |
| `GET /api/vaults` | List visible vaults |
| `GET /api/vaults/:vaultId/notes` | Get notes for one vault |
| `GET /api/search` | Get search index |
| `GET /api/vaults/:vaultId/search?q=...` | Vault-scoped ranked search |
| `GET /api/vaults/:vaultId/tags` | List visible tags |
| `GET /api/vaults/:vaultId/tags/:tag` | List notes for one tag |
| `GET /api/vaults/:vaultId/meta/:field/:value` | Filter notes by frontmatter field/value |
| `POST /api/admin/sync` | Trigger immediate sync (admin only) |
| `POST /api/refresh` | Clear cache and refresh notes (admin only) |
| `POST /api/push/subscribe` | Register push subscription |
| `POST /api/push/unsubscribe` | Remove push subscription |
| `POST /api/push/test` | Send test push notification (admin only) |
| `POST /api/comments/:commentId/resolve` | Resolve comment thread |
| `POST /api/comments/:commentId/reopen` | Reopen comment thread |
| `GET /api/users/mentions?q=...` | Mention lookup |
| `GET /api/attachment/:name` | Get image/file from attachments |
| `GET /api/health` | Health check |

## Troubleshooting

### "Failed to load notes"
- Check your environment variables are set correctly
- Make sure the folder ID is correct
- Verify the refresh token is valid

### Notes not updating
- Cache lasts 5 minutes by default
- Call `POST /api/refresh` to force update
- Or restart the server

## License

MIT
