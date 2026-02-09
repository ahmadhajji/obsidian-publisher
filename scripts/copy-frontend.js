/**
 * Copy frontend files to dist folder
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
const distDir = path.join(__dirname, '..', 'dist');
const staticDir = path.join(srcDir, 'static');

// Create dist directories
fs.mkdirSync(path.join(distDir, 'styles'), { recursive: true });
fs.mkdirSync(path.join(distDir, 'scripts'), { recursive: true });

// Copy HTML templates
fs.copyFileSync(
    path.join(srcDir, 'templates', 'index.html'),
    path.join(distDir, 'index.html')
);
fs.copyFileSync(
    path.join(srcDir, 'templates', 'about.html'),
    path.join(distDir, 'about.html')
);
fs.copyFileSync(
    path.join(srcDir, 'templates', 'feedback.html'),
    path.join(distDir, 'feedback.html')
);

// Copy CSS
fs.copyFileSync(
    path.join(srcDir, 'styles', 'main.css'),
    path.join(distDir, 'styles', 'main.css')
);

// Copy JS files
const jsFiles = [
    'app.js',
    'search.js',
    'export.js',
    'settings.js',
    'tabs.js',
    'typography.js',
    'auth-ui.js',
    'comments-ui.js',
    'analytics-dashboard.js'
];
for (const jsFile of jsFiles) {
    fs.copyFileSync(
        path.join(srcDir, 'scripts', jsFile),
        path.join(distDir, 'scripts', jsFile)
    );
}

// Copy static assets (manifest, service worker, icons, etc.)
if (fs.existsSync(staticDir)) {
    for (const file of fs.readdirSync(staticDir)) {
        fs.copyFileSync(
            path.join(staticDir, file),
            path.join(distDir, file)
        );
    }
}

console.log('✅ Frontend files copied to dist/');
