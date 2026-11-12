/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { getAuthInfoFromBrowserCookie } from './auth';

type GuestResponse = Response;

function jsonResponse(body: unknown, status = 200): GuestResponse {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function guestKey(kind: string) {
  const user = getAuthInfoFromBrowserCookie()?.username || 'anonymous';
  return `moontv_local_guest_${kind}_${encodeURIComponent(user)}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

/** Intercepts personal music APIs for local guests; public discovery/stream APIs use the network. */
export async function localGuestFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
  if (!isLocalGuest() || !url.startsWith('/api/music/v2/'))
    return window.fetch(input, init);
  const path = url.split('?')[0];
  const method = (init?.method || 'GET').toUpperCase();
  if (path === '/api/music/v2/history') {
    const key = guestKey('music_history');
    let records = readJson<any[]>(key, []);
    if (method === 'GET')
      return jsonResponse({ success: true, data: { records } });
    if (method === 'DELETE') {
      const songId = new URL(url, window.location.origin).searchParams.get(
        'songId'
      );
      records = songId ? records.filter((r) => r.songId !== songId) : [];
      writeJson(key, records);
      return jsonResponse({ success: true });
    }
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (method === 'PATCH') {
      const { songId, nextSongId } = body;
      const item = records.find((r) => r.songId === songId);
      if (item) {
        records = records.filter((r) => r.songId !== songId);
        const index = nextSongId
          ? records.findIndex((r) => r.songId === nextSongId)
          : records.length;
        records.splice(index < 0 ? records.length : index, 0, item);
        writeJson(key, records);
      }
      return jsonResponse({ success: true, data: { records } });
    }
    const incoming = Array.isArray(body.records)
      ? body.records
      : [body.record || body];
    const now = Date.now();
    for (const raw of incoming) {
      const song = raw.song || raw;
      if (!song?.songId) continue;
      const previous = records.find((r) => r.songId === song.songId);
      const record = {
        ...song,
        playProgressSec: Number(
          raw.playProgressSec ?? previous?.playProgressSec ?? 0
        ),
        lastPlayedAt: Number(raw.lastPlayedAt ?? now),
        playCount: Number(raw.playCount ?? (previous?.playCount || 0) + 1),
        lastQuality: raw.lastQuality || previous?.lastQuality,
        createdAt: previous?.createdAt || raw.createdAt || now,
        updatedAt: now,
      };
      const index = records.findIndex((r) => r.songId === song.songId);
      if (index < 0) records.push(record);
      else records[index] = record;
    }
    writeJson(key, records);
    return jsonResponse({
      success: true,
      data: Array.isArray(body.records)
        ? { count: incoming.length }
        : {
            record: records.find(
              (r) => r.songId === (incoming[0].song || incoming[0]).songId
            ),
          },
    });
  }
  if (path === '/api/music/v2/playlists') {
    const key = guestKey('music_playlists');
    const playlists = readJson<any[]>(key, []);
    if (method === 'GET')
      return jsonResponse({ success: true, data: { playlists } });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const now = Date.now();
    const playlist = {
      id: crypto.randomUUID(),
      username: getAuthInfoFromBrowserCookie()?.username || 'guest',
      name: body.name || '未命名歌单',
      description: body.description,
      song_count: 0,
      created_at: now,
      updated_at: now,
    };
    playlists.push(playlist);
    writeJson(key, playlists);
    return jsonResponse({ success: true, data: { playlist } });
  }
  const playlistMatch = path.match(
    /^\/api\/music\/v2\/playlists\/([^/]+)(\/songs)?$/
  );
  if (playlistMatch) {
    const playlistId = decodeURIComponent(playlistMatch[1]);
    const playlistKey = guestKey(`music_playlist_${playlistId}`);
    if (playlistMatch[2]) {
      let songs = readJson<any[]>(playlistKey, []);
      if (method === 'GET')
        return jsonResponse({ success: true, data: { songs } });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (method === 'DELETE') {
        const songId = new URL(url, window.location.origin).searchParams.get(
          'songId'
        );
        songs = songs.filter((s) => s.songId !== songId);
      } else if (
        method === 'POST' &&
        body.song?.songId &&
        !songs.some((s) => s.songId === body.song.songId)
      )
        songs.push({
          ...body.song,
          playlistId,
          sortOrder: songs.length * 1000 + 1000,
          addedAt: Date.now(),
          updatedAt: Date.now(),
        });
      writeJson(playlistKey, songs);
      const key = guestKey('music_playlists');
      writeJson(
        key,
        readJson<any[]>(key, []).map((p) =>
          p.id === playlistId
            ? { ...p, song_count: songs.length, updated_at: Date.now() }
            : p
        )
      );
      return jsonResponse({ success: true, data: { songs } });
    }
    const key = guestKey('music_playlists');
    let playlists = readJson<any[]>(key, []);
    if (method === 'DELETE') {
      playlists = playlists.filter((p) => p.id !== playlistId);
      localStorage.removeItem(playlistKey);
      writeJson(key, playlists);
      return jsonResponse({ success: true });
    }
    if (method === 'PATCH') {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      playlists = playlists.map((p) =>
        p.id === playlistId
          ? {
              ...p,
              name: body.name ?? p.name,
              description: body.description ?? p.description,
              cover: body.cover ?? p.cover,
              updated_at: Date.now(),
            }
          : p
      );
      writeJson(key, playlists);
      return jsonResponse({
        success: true,
        data: { playlist: playlists.find((p) => p.id === playlistId) },
      });
    }
  }
  return window.fetch(input, init);
}

export function isLocalGuest(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window as Window & { RUNTIME_CONFIG?: { LOCAL_GUEST?: boolean } })
      .RUNTIME_CONFIG?.LOCAL_GUEST === true
  );
}

export function personalDataKey(key: string): string {
  if (
    !isLocalGuest() ||
    key.startsWith('moontv_cache_') ||
    key.includes(':user:') ||
    key.endsWith(':anonymous')
  )
    return key;
  const username = getAuthInfoFromBrowserCookie()?.username;
  return `${key}:guest:${encodeURIComponent(username || 'anonymous')}`;
}

// 访客数据独立于普通用户的云缓存，退出登录不会清理这些持久数据。
export const personalStorage = {
  getItem(key: string): string | null {
    return localStorage.getItem(personalDataKey(key));
  },
  setItem(key: string, value: string): void {
    localStorage.setItem(personalDataKey(key), value);
  },
  removeItem(key: string): void {
    localStorage.removeItem(personalDataKey(key));
  },
};
