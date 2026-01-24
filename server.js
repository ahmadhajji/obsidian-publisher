/**
 * Obsidian Notes Publisher - Live Server
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { fetchNotes, clearCache, getAttachment } = require('./lib/drive');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from dist folder
app.use(express.static(path.join(__dirname, 'dist')));

// API: Get all notes
app.get('/api/notes', async (req, res) => {
    try {
        const data = await fetchNotes();
        res.json({
            siteName: data.siteName,
            notes: data.notes,
            folderTree: data.folderTree
        });
    } catch (error) {
        console.error('Error fetching notes:', error);
        res.status(500).json({ error: 'Failed to fetch notes', message: error.message });
    }
});

// API: Get search index
app.get('/api/search', async (req, res) => {
    try {
        const data = await fetchNotes();
        res.json(data.searchIndex);
    } catch (error) {
        console.error('Error fetching search index:', error);
        res.status(500).json({ error: 'Failed to fetch search index' });
    }
});

// API: Refresh cache
app.post('/api/refresh', (req, res) => {
    clearCache();
    res.json({ success: true, message: 'Cache cleared' });
});

// API: Get attachment
app.get('/api/attachment/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        const { data, mimeType } = await getAttachment(decodeURIComponent(filename));
        res.set('Content-Type', mimeType);
        res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
        res.send(data);
    } catch (error) {
        console.error('Error fetching attachment:', error);
        res.status(404).json({ error: 'Attachment not found' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve index.html for all other routes (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   🚀 Obsidian Notes Publisher                          ║
║                                                        ║
║   Server running at: http://localhost:${PORT}             ║
║                                                        ║
║   Make sure to set these environment variables:        ║
║   - GOOGLE_CLIENT_ID                                   ║
║   - GOOGLE_CLIENT_SECRET                               ║
║   - GOOGLE_REFRESH_TOKEN                               ║
║   - GOOGLE_DRIVE_FOLDER_ID                             ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
  `);
});
