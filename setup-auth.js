/**
 * Google OAuth Setup Script
 * Run this locally to get your refresh token
 */

require('dotenv').config();
const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const destroyer = require('server-destroy');
const { exec } = require('child_process');

// Read from .env file
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3001/callback';

const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
);

const scopes = [
    'https://www.googleapis.com/auth/drive.readonly'
];

async function main() {
    console.log(`
╔════════════════════════════════════════════════════════════════════════╗
║                                                                        ║
║   Google Drive OAuth Setup                                             ║
║                                                                        ║
║   Before running this:                                                 ║
║   1. Go to https://console.cloud.google.com                            ║
║   2. Create a new project                                              ║
║   3. Enable "Google Drive API"                                         ║
║   4. Create OAuth credentials (Web application)                        ║
║   5. Add http://localhost:3001/callback as authorized redirect URI     ║
║   6. Copy Client ID and Secret into this script                        ║
║                                                                        ║
╚════════════════════════════════════════════════════════════════════════╝
  `);

    if (!CLIENT_ID || !CLIENT_SECRET || CLIENT_ID === 'your_client_id_here') {
        console.error('❌ Please add your GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the .env file');
        process.exit(1);
    }

    const authorizeUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent'
    });

    console.log('🔗 Opening browser for authorization...\n');

    // Create local server to receive callback
    const server = http.createServer(async (req, res) => {
        try {
            const parsedUrl = url.parse(req.url, true);

            if (parsedUrl.pathname === '/callback') {
                const code = parsedUrl.query.code;

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
          <html>
            <body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1>✅ Authorization successful!</h1>
              <p>You can close this window and return to your terminal.</p>
            </body>
          </html>
        `);

                // Exchange code for tokens
                const { tokens } = await oauth2Client.getToken(code);

                console.log('✅ Authorization successful!\n');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('Add these to your .env file:\n');
                console.log(`GOOGLE_CLIENT_ID=${CLIENT_ID}`);
                console.log(`GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}`);
                console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                server.destroy();
            }
        } catch (e) {
            console.error('Error:', e);
            res.writeHead(500);
            res.end('Error getting token');
        }
    });

    destroyer(server);

    server.listen(3001, () => {
        // Open browser on macOS
        console.log('\n📋 If the browser doesn\'t open, visit this URL:\n');
        console.log(authorizeUrl);
        console.log('\n');
        exec(`open "${authorizeUrl}"`);
    });
}

main().catch(console.error);
