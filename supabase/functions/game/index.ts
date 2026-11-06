// @ts-nocheck
// Şahkart / Chromate online sunucusu (Supabase Edge Function).
// Hatalar dilden bağımsız kod olarak döner ({ error: 'roomFull' }); istemci kendi dilinde gösterir.
// Oyun durumu veritabanında tutulur; her eylem burada doğrulanır, sonra iki oyuncuya
// kendi gizli realtime kanalından kendi görebileceği durum gönderilir.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Core from './core.js';
const { act, checkTimeout, newGame, viewFor } = Core;

const URL = Deno.env.get('SUPABASE_URL');
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
const TC_ALLOWED = new Set(['0', '60+2', '180+2', '300+0', '300+3', '600+0', '600+5', '900+10']);
const LETTERS = 'ABCDEFGHJKLMNPRSTUVYZ';

// Sohbet: hazır mesajlar ve emojiler her oyunda; serbest yazı sadece arkadaş odalarında.
// Mesajlar saklanmaz, sadece iki oyuncuya iletilir.
const PHRASES = new Set(['hi', 'gl', 'nice', 'wow', 'oops', 'thanks', 'think', 'hurry', 'gg', 'rematch']);
const EMOJIS = new Set(['👍', '😂', '😮', '😅', '🔥', '👏', '😎', '🤔', '😢', '❤️']);
const chatTimes = new Map(); // oyun+taraf -> son mesaj zamanları (basit hız sınırı)
function chatAllowed(key) {
  const now = Date.now();
  const list = (chatTimes.get(key) || []).filter(x => now - x < 10000);
  if (list.length >= 6) return false;
  list.push(now);
  chatTimes.set(key, list);
  if (chatTimes.size > 5000) chatTimes.clear();
  return true;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const secret = () => crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
const roomCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

function sideOf(g, token) {
  if (typeof token !== 'string' || token.length < 20) return -1;
  if (g.p0_token === token) return 0;
  if (g.p1_token === token) return 1;
  return -1;
}

function payloadFor(g, side) {
  return {
    id: g.id, side, status: g.status, rematch: g.rematch, v: g.version,
    view: g.state ? viewFor(g.state, side) : null,
  };
}

// Her oyuncuya kendi kanalından güncel durumu gönder
async function broadcast(g) {
  const messages = [];
  if (g.p0_chan) messages.push({ topic: g.p0_chan, event: 'state', payload: payloadFor(g, 0) });
  if (g.p1_chan) messages.push({ topic: g.p1_chan, event: 'state', payload: payloadFor(g, 1) });
  try {
    await fetch(URL + '/realtime/v1/api/broadcast', {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
  } catch (_) { /* istemciler ayrıca yoklama yapıyor */ }
}

async function sendChat(g, msg) {
  const messages = [g.p0_chan, g.p1_chan].filter(Boolean).map(topic => ({ topic, event: 'chat', payload: msg }));
  try {
    await fetch(URL + '/realtime/v1/api/broadcast', {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
  } catch (_) { /* sohbet en iyi çaba ile iletilir */ }
}

async function load(id) {
  if (typeof id !== 'string' || id.length > 24) return null;
  const { data } = await db.from('games').select('*').eq('id', id).maybeSingle();
  return data;
}

// Sürüm kontrollü kayıt: arada başka bir yazma olduysa false döner
async function save(g, patch) {
  const { data, error } = await db.from('games')
    .update({ ...patch, version: g.version + 1, updated_at: new Date().toISOString() })
    .eq('id', g.id).eq('version', g.version).select('*');
  if (error || !data || !data.length) return null;
  return data[0];
}

// Durumu değiştiren bir işlemi, çakışmada yeniden deneyerek uygula
async function mutate(id, token, fn) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const g = await load(id);
    if (!g) return { error: 'notFound' };
    const side = sideOf(g, token);
    if (side < 0) return { error: 'notPlayer' };
    const res = fn(g, side);
    if (res && res.error) return res;
    if (!res) return payloadFor(g, side); // değişiklik yok
    const saved = await save(g, res);
    if (saved) { await broadcast(saved); return payloadFor(saved, side); }
  }
  return { error: 'busy' };
}

async function cleanup() {
  const old = new Date(Date.now() - 2 * 864e5).toISOString();
  await db.from('games').delete().lt('updated_at', old);
}

async function handle(b) {
  const tc = TC_ALLOWED.has(String(b.tc)) ? String(b.tc) : '0';

  switch (b.action) {
    case 'create': {
      if (Math.random() < 0.1) await cleanup();
      for (let i = 0; i < 6; i++) {
        const row = { id: roomCode(), kind: 'room', tc, p0_token: secret(), p0_chan: 'sk-' + secret() };
        const { error } = await db.from('games').insert(row);
        if (!error) return { id: row.id, side: 0, token: row.p0_token, chan: row.p0_chan, status: 'waiting' };
      }
      return { error: 'createFailed' };
    }

    case 'join': {
      const code = String(b.code || '').toUpperCase();
      for (let attempt = 0; attempt < 3; attempt++) {
        const g = await load(code);
        if (!g || g.kind !== 'room' || g.status === 'cancelled') return { error: 'noRoom' };
        if (g.status !== 'waiting' || g.p1_token) return { error: 'roomFull' };
        const token = secret(), chan = 'sk-' + secret();
        const saved = await save(g, { p1_token: token, p1_chan: chan, status: 'playing', state: newGame(g.tc) });
        if (saved) {
          await broadcast(saved);
          return { ...payloadFor(saved, 1), token, chan };
        }
      }
      return { error: 'joinFailed' };
    }

    case 'quick': {
      if (Math.random() < 0.1) await cleanup();
      const token = secret(), chan = 'sk-' + secret();
      const { data: matched } = await db.rpc('quick_match', { p_tc: tc, p_token: token, p_chan: chan });
      if (matched && matched.id) {
        const saved = await save(matched, { state: newGame(matched.tc) });
        const g = saved || matched;
        await broadcast(g);
        return { ...payloadFor(g, 1), token, chan };
      }
      for (let i = 0; i < 4; i++) {
        const row = { id: 'Q' + secret().slice(0, 10), kind: 'quick', tc, p0_token: token, p0_chan: chan };
        const { error } = await db.from('games').insert(row);
        if (!error) return { id: row.id, side: 0, token, chan, status: 'waiting' };
      }
      return { error: 'quickFailed' };
    }

    case 'wait': {
      // Bekleyen oyuncunun nabzı: hızlı eşleşmede sırada kalmak için gerekli
      const g = await load(b.id);
      if (!g) return { error: 'notFound' };
      const side = sideOf(g, b.token);
      if (side < 0) return { error: 'notPlayer' };
      if (g.status === 'waiting') {
        await db.from('games').update({ updated_at: new Date().toISOString() }).eq('id', g.id).eq('status', 'waiting');
      }
      return payloadFor(g, side);
    }

    case 'chat': {
      const g = await load(b.id);
      if (!g) return { error: 'notFound' };
      const side = sideOf(g, b.token);
      if (side < 0) return { error: 'notPlayer' };
      if (!g.state) return { error: 'notStarted' };
      let value = b.value;
      if (b.kind === 'phrase' && PHRASES.has(value)) { /* geçerli */ }
      else if (b.kind === 'emoji' && EMOJIS.has(value)) { /* geçerli */ }
      else if (b.kind === 'text' && g.kind === 'room' && typeof value === 'string' && value.trim()) value = value.trim().slice(0, 200);
      else return { error: 'badChat' };
      if (!chatAllowed(g.id + ':' + side)) return { error: 'chatTooFast' };
      const msg = { id: crypto.randomUUID().slice(0, 8), from: side, kind: b.kind, value, at: Date.now() };
      await sendChat(g, msg);
      return { ok: true, msg };
    }

    case 'cancel':
      return mutate(b.id, b.token, g => (g.status === 'waiting' ? { status: 'cancelled' } : null));

    case 'state':
      return mutate(b.id, b.token, g => {
        if (!g.state || g.status !== 'playing' || !checkTimeout(g.state)) return null;
        return { state: g.state, status: 'over' };
      });

    case 'rematch':
      return mutate(b.id, b.token, (g, side) => {
        if (!g.state || !g.state.over) return { error: 'notOver' };
        const rematch = [...g.rematch];
        rematch[side] = true;
        if (rematch[0] && rematch[1]) return { state: newGame(g.tc), status: 'playing', rematch: [false, false] };
        return { rematch };
      });

    case 'play': case 'draw': case 'pass': case 'resign':
      return mutate(b.id, b.token, (g, side) => {
        if (!g.state || g.status === 'waiting') return { error: 'notStarted' };
        const err = act(g.state, side, b);
        if (err) return { error: err };
        return { state: g.state, status: g.state.over ? 'over' : 'playing' };
      });
  }
  return { error: 'unknown' };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'badRequest' }, 405);
  let body;
  try { body = await req.json(); } catch (_) { return json({ error: 'badRequest' }, 400); }
  try {
    const res = await handle(body || {});
    return json(res, res && res.error ? 400 : 200);
  } catch (e) {
    console.error(e);
    return json({ error: 'server' }, 500);
  }
});
