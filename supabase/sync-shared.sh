#!/bin/sh
# Oyun kuralları ve çekirdeği tek yerde (kökteki rules.js ve core.js). Bu betik onları
# sunucu fonksiyonuna ES modülü olarak kopyalar. rules.js ya da core.js değişince çalıştır
# ve "game" fonksiyonunu yeniden yükle.
cd "$(dirname "$0")/.."
OUT=supabase/functions/game
HDR="// OTOMATİK ÜRETİLDİ (supabase/sync-shared.sh) — elle düzenleme, kökteki dosyayı değiştir."
{ echo "$HDR"; cat rules.js; echo; echo "export default Rules;"; } > $OUT/rules.js
{ echo "$HDR"; echo "import Rules from './rules.js';"; cat core.js; echo; echo "export default Core;"; } > $OUT/core.js
