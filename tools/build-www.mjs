// Mobil uygulama için web dosyalarını www/ klasörüne kopyalar (Capacitor bu klasörü paketler).
// Sunucu kodu (supabase/), araçlar (tools/) ve geliştirme dosyaları uygulamaya girmez.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const FILES = [
  'index.html', 'privacy.html', 'style.css',
  'i18n.js', 'analytics.js', 'online.js', 'sound.js', 'rules.js', 'core.js',
  'tutorial.js', 'puzzles.js', 'game.js',
  'manifest.webmanifest', 'manifest-tr.webmanifest',
];
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of FILES) cpSync(f, 'www/' + f);
cpSync('icons', 'www/icons', { recursive: true });

// Supabase kütüphanesini CDN yerine uygulamanın içinden yükle
mkdirSync('www/vendor');
cpSync('node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'www/vendor/supabase.js');
const html = readFileSync('www/index.html', 'utf8');
const cdn = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+"><\/script>/;
if (!cdn.test(html)) throw new Error('index.html içinde Supabase CDN satırı bulunamadı');
let out = html.replace(cdn, '<script src="vendor/supabase.js"></script>');
// --debug: dokunma olaylarını ekrana yazan geliştirme katmanı
if (process.argv.includes('--debug')) out = out.replace('</head>', readFileSync('tools/debug-overlay.html', 'utf8') + '</head>');
writeFileSync('www/index.html', out);
console.log('www/ hazır:', FILES.length, 'dosya + icons/');
