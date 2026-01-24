/**
 * Copy frontend files to dist folder
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
const distDir = path.join(__dirname, '..', 'dist');

// Create dist directories
fs.mkdirSync(path.join(distDir, 'styles'), { recursive: true });
fs.mkdirSync(path.join(distDir, 'scripts'), { recursive: true });

// Copy HTML template
fs.copyFileSync(
    path.join(srcDir, 'templates', 'index.html'),
    path.join(distDir, 'index.html')
);

// Copy CSS
fs.copyFileSync(
    path.join(srcDir, 'styles', 'main.css'),
    path.join(distDir, 'styles', 'main.css')
);

// Copy JS files
const jsFiles = ['app.js', 'search.js', 'export.js', 'settings.js'];
for (const jsFile of jsFiles) {
    fs.copyFileSync(
        path.join(srcDir, 'scripts', jsFile),
        path.join(distDir, 'scripts', jsFile)
    );
}

console.log('✅ Frontend files copied to dist/');
