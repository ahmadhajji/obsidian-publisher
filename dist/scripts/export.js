/**
 * Obsidian Publisher - Export Functionality
 */

// DOM Elements
const exportMdBtn = document.getElementById('exportMd');
const exportPdfBtn = document.getElementById('exportPdf');

// Export as Markdown
exportMdBtn.addEventListener('click', async () => {
    const { state, hideExportModal } = window.obsidianPublisher;
    const selectedNotes = getSelectedNotes();

    if (selectedNotes.length === 0) return;

    if (selectedNotes.length === 1) {
        // Single file download
        downloadMarkdownFile(selectedNotes[0]);
    } else {
        // Multiple files - create zip
        await downloadMarkdownZip(selectedNotes);
    }

    hideExportModal();
});

// Export as PDF
exportPdfBtn.addEventListener('click', async () => {
    const { state, hideExportModal } = window.obsidianPublisher;
    const selectedNotes = getSelectedNotes();

    if (selectedNotes.length === 0) return;

    // Create a printable document
    await exportAsPdf(selectedNotes);

    hideExportModal();
});

// Get selected notes data
function getSelectedNotes() {
    const { state } = window.obsidianPublisher;
    return state.notes.filter(note => state.selectedNotes.has(note.id));
}

// Download single markdown file
function downloadMarkdownFile(note) {
    const filename = sanitizeFilename(note.title) + '.md';
    const content = note.content;

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(blob, filename);
}

// Download multiple files as ZIP
async function downloadMarkdownZip(notes) {
    // Simple ZIP implementation without external library
    // For a production app, you'd use JSZip or similar

    // Alternative: download each file individually with a small delay
    // This is simpler and doesn't require a ZIP library

    const shouldProceed = confirm(
        `Download ${notes.length} markdown files?\n\nThey will be downloaded individually.`
    );

    if (!shouldProceed) return;

    for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        setTimeout(() => {
            downloadMarkdownFile(note);
        }, i * 300); // Stagger downloads
    }
}

// Export as PDF using print functionality
async function exportAsPdf(notes) {
    // Create a temporary print window with the selected notes
    const printWindow = window.open('', '_blank');

    if (!printWindow) {
        alert('Please allow popups to export PDFs');
        return;
    }

    // Get current theme
    const isDark = document.documentElement.dataset.theme === 'dark';

    // Build print document
    const content = notes.map(note => `
    <article class="print-note">
      <h1 class="print-title">${escapeHtml(note.title)}</h1>
      <div class="print-meta">${escapeHtml(note.path)}</div>
      <div class="print-body">${note.html}</div>
    </article>
  `).join('<div class="page-break"></div>');

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${notes.length === 1 ? notes[0].title : 'Exported Notes'}</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          line-height: 1.6;
          color: #1e1e1e;
          background: white;
          padding: 40px;
          max-width: 800px;
          margin: 0 auto;
        }
        
        .print-note {
          page-break-inside: avoid;
        }
        
        .print-title {
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 8px;
          color: #1e1e1e;
          border-bottom: 2px solid #7c3aed;
          padding-bottom: 12px;
        }
        
        .print-meta {
          font-size: 12px;
          color: #666;
          margin-bottom: 24px;
        }
        
        .print-body {
          font-size: 14px;
        }
        
        .print-body h1 { font-size: 24px; margin: 24px 0 12px; }
        .print-body h2 { font-size: 20px; margin: 20px 0 10px; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; }
        .print-body h3 { font-size: 18px; margin: 18px 0 8px; }
        .print-body h4, .print-body h5, .print-body h6 { font-size: 16px; margin: 14px 0 6px; }
        
        .print-body p { margin: 0 0 12px; }
        
        .print-body ul, .print-body ol {
          margin: 0 0 12px;
          padding-left: 24px;
        }
        
        .print-body li { margin-bottom: 4px; }
        
        .print-body code {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          background: #f5f5f5;
          padding: 2px 6px;
          border-radius: 3px;
        }
        
        .print-body pre {
          background: #f5f5f5;
          padding: 12px;
          border-radius: 6px;
          overflow-x: auto;
          margin: 12px 0;
          border: 1px solid #e0e0e0;
        }
        
        .print-body pre code {
          background: none;
          padding: 0;
        }
        
        .print-body blockquote {
          border-left: 4px solid #7c3aed;
          padding: 8px 16px;
          margin: 12px 0;
          background: #f9f9f9;
          color: #555;
        }
        
        .print-body table {
          width: 100%;
          border-collapse: collapse;
          margin: 12px 0;
          font-size: 13px;
        }
        
        .print-body th, .print-body td {
          border: 1px solid #e0e0e0;
          padding: 8px 10px;
          text-align: left;
        }
        
        .print-body th {
          background: #f5f5f5;
          font-weight: 600;
        }
        
        .print-body hr {
          border: none;
          border-top: 1px solid #e0e0e0;
          margin: 24px 0;
        }
        
        .print-body img {
          max-width: 100%;
          height: auto;
        }
        
        .print-body a {
          color: #7c3aed;
          text-decoration: none;
        }
        
        .print-body .tag {
          display: inline-block;
          background: #f0e6ff;
          color: #7c3aed;
          padding: 2px 8px;
          border-radius: 100px;
          font-size: 11px;
          font-weight: 500;
        }
        
        .print-body .callout {
          padding: 12px;
          border-radius: 6px;
          margin: 12px 0;
          border-left: 4px solid;
        }
        
        .print-body .callout-title {
          font-weight: 600;
          font-size: 12px;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        
        .print-body .callout-note { background: #eff6ff; border-color: #3b82f6; }
        .print-body .callout-note .callout-title { color: #3b82f6; }
        
        .print-body .callout-tip { background: #ecfdf5; border-color: #10b981; }
        .print-body .callout-tip .callout-title { color: #10b981; }
        
        .print-body .callout-warning, .print-body .callout-important { 
          background: #fffbeb; border-color: #f59e0b; 
        }
        .print-body .callout-warning .callout-title,
        .print-body .callout-important .callout-title { color: #f59e0b; }
        
        .print-body .callout-caution, .print-body .callout-danger { 
          background: #fef2f2; border-color: #ef4444; 
        }
        .print-body .callout-caution .callout-title,
        .print-body .callout-danger .callout-title { color: #ef4444; }
        
        .page-break {
          page-break-after: always;
          margin: 40px 0;
          border-top: 1px dashed #ccc;
        }
        
        @media print {
          body {
            padding: 0;
          }
          
          .page-break {
            border: none;
            margin: 0;
          }
          
          .print-note {
            page-break-after: always;
          }
          
          .print-note:last-child {
            page-break-after: auto;
          }
        }
        
        .print-actions {
          position: fixed;
          top: 20px;
          right: 20px;
          display: flex;
          gap: 10px;
          z-index: 100;
        }
        
        .print-actions button {
          padding: 10px 20px;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .print-btn {
          background: #7c3aed;
          color: white;
        }
        
        .print-btn:hover {
          background: #6d28d9;
        }
        
        .close-btn {
          background: #e0e0e0;
          color: #333;
        }
        
        .close-btn:hover {
          background: #d0d0d0;
        }
        
        @media print {
          .print-actions {
            display: none;
          }
        }
      </style>
    </head>
    <body>
      <div class="print-actions">
        <button class="print-btn" onclick="window.print()">Save as PDF / Print</button>
        <button class="close-btn" onclick="window.close()">Close</button>
      </div>
      ${content}
      <script>
        // Auto-trigger print dialog after a short delay
        // setTimeout(() => window.print(), 500);
      </script>
    </body>
    </html>
  `;

    printWindow.document.write(html);
    printWindow.document.close();
}

// Utility: sanitize filename
function sanitizeFilename(name) {
    return name
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

// Utility: download blob
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Utility: escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
