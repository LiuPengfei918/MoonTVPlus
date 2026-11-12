/** @jest-environment node */
import { webcrypto } from 'crypto';
import { Response as EdgeResponse } from 'next/dist/compiled/@edge-runtime/primitives';

import { getAuthInfoFromBrowserCookie } from './auth';
import { localGuestFetch } from './local-guest.client';

jest.mock('./auth', () => ({ getAuthInfoFromBrowserCookie: jest.fn() }));

const auth = jest.mocked(getAuthInfoFromBrowserCookie);
const memory = new Map<string, string>();
const network = jest.fn();
const song = (songId: string) => ({
  songId,
  source: 'wy',
  name: songId,
  artist: 'artist',
});
async function request(path: string, method = 'GET', body?: object) {
  return (
    await localGuestFetch(`/api/music/v2/${path}`, {
      method,
      body: body ? JSON.stringify(body) : undefined,
    })
  ).json();
}

beforeEach(() => {
  memory.clear();
  network.mockReset();
  auth.mockReturnValue({ username: 'alice', role: 'user' });
  Object.assign(global, {
    Response: EdgeResponse,
    crypto: webcrypto,
    window: {
      RUNTIME_CONFIG: { LOCAL_GUEST: true },
      location: { origin: 'http://localhost' },
      fetch: network,
    },
    localStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
  });
});

test('本地音乐队列保存、重复播放、拖拽及删除不会访问云端', async () => {
  await request('history', 'POST', {
    records: [{ song: song('a') }, { song: song('b') }],
  });
  await request('history', 'POST', { song: song('a'), playProgressSec: 42 });
  let result = await request('history');
  expect(result.data.records.map((r: { songId: string }) => r.songId)).toEqual([
    'a',
    'b',
  ]);
  expect(result.data.records[0].playProgressSec).toBe(42);
  await request('history', 'PATCH', { songId: 'b', nextSongId: 'a' });
  result = await request('history');
  expect(result.data.records.map((r: { songId: string }) => r.songId)).toEqual([
    'b',
    'a',
  ]);
  await request('history?songId=a', 'DELETE');
  expect((await request('history')).data.records).toHaveLength(1);
  await request('history', 'DELETE');
  expect((await request('history')).data.records).toEqual([]);
  expect(network).not.toHaveBeenCalled();
});

test('本地歌单增删、去重和账号隔离', async () => {
  const result = await request('playlists', 'POST', { name: '我的歌单' });
  const id = result.data.playlist.id;
  await request(`playlists/${id}/songs`, 'POST', { song: song('a') });
  await request(`playlists/${id}/songs`, 'POST', { song: song('a') });
  expect((await request(`playlists/${id}/songs`)).data.songs).toHaveLength(1);
  expect((await request('playlists')).data.playlists[0].song_count).toBe(1);
  auth.mockReturnValue({ username: 'bob', role: 'user' });
  expect((await request('playlists')).data.playlists).toEqual([]);
  auth.mockReturnValue({ username: 'alice', role: 'user' });
  await request(`playlists/${id}/songs?songId=a`, 'DELETE');
  expect((await request(`playlists/${id}/songs`)).data.songs).toEqual([]);
  await request(`playlists/${id}`, 'DELETE');
  expect((await request('playlists')).data.playlists).toEqual([]);
  expect(network).not.toHaveBeenCalled();
});

test('音乐公共服务及普通用户继续使用现有网络请求', async () => {
  network.mockResolvedValue({ json: async () => ({ fromNetwork: true }) });
  expect(await request('search?q=test')).toEqual({ fromNetwork: true });
  Object.assign(window, { RUNTIME_CONFIG: { LOCAL_GUEST: false } });
  expect(await request('history')).toEqual({ fromNetwork: true });
  expect(network).toHaveBeenCalledTimes(2);
});
