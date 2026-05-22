const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isFile() && !entry.name.endsWith('.ts')) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy the renderer files
const srcDir = path.join(__dirname, '..', 'src', 'renderer');
const destDir = path.join(__dirname, '..', 'dist', 'renderer');

if (fs.existsSync(srcDir)) {
  copyDir(srcDir, destDir);
  console.log('Copied static assets from src/renderer to dist/renderer.');
} else {
  console.error('Source directory does not exist:', srcDir);
}

// Copy node_modules/sql.js/dist/sql-wasm.wasm to dist/sql-wasm.wasm
const wasmSrc = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
const wasmDest = path.join(__dirname, '..', 'dist', 'sql-wasm.wasm');

if (fs.existsSync(wasmSrc)) {
  // Ensure dist directory exists
  const distDir = path.dirname(wasmDest);
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }
  fs.copyFileSync(wasmSrc, wasmDest);
  console.log('Successfully copied sql-wasm.wasm to dist/');
} else {
  console.error('Warning: sql-wasm.wasm not found in node_modules/sql.js/dist/');
}

