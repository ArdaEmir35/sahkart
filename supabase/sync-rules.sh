#!/bin/sh
# Kurallar tek yerde: istemcideki rules.js'i sunucu fonksiyonuna modül olarak kopyalar.
cd "$(dirname "$0")/.."
{ echo "// OTOMATİK ÜRETİLDİ: kökteki rules.js'ten kopyalandı (supabase/sync-rules.sh). Elle düzenleme."; cat rules.js; echo; echo "export default Rules;"; } > supabase/functions/game/rules.js
