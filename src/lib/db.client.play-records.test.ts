import { getAuthInfoFromBrowserCookie } from './auth';
import {
  clearUserCache, deletePlayRecords, getAllPlayRecords,
  getCachedPlayRecordsSnapshot, migratePlayRecord, refreshAllCache,
  savePlayRecord, subscribeToDataUpdates,
} from './db.client';
import type { PlayRecord } from './db.client';

jest.mock('./auth', () => {
  Object.assign(window, { RUNTIME_CONFIG: { STORAGE_TYPE: 'upstash' } });
  return { getAuthInfoFromBrowserCookie: jest.fn() };
});

const auth = getAuthInfoFromBrowserCookie as jest.Mock;
const record: PlayRecord = {
  title: '海贼王', source_name: '测试源', year: '1999', cover: '',
  index: 4, total_episodes: 100, play_time: 123, total_time: 1400,
  save_time: 1, search_title: '海贼王',
};

beforeEach(() => {
  localStorage.clear();
  auth.mockReturnValue({ username: 'alice' });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

test('播放进度、换源、删除均在本地完成，空桶不会恢复旧记录', async () => {
  localStorage.setItem('moontv_cache_alice', JSON.stringify({
    playRecords: { data: { 'old+1': record }, timestamp: 0 },
  }));
  expect(await getAllPlayRecords()).toEqual({ 'old+1': record });
  await savePlayRecord('new', '2', record);
  await migratePlayRecord('old', '1', 'next', '3', record);
  expect(Object.keys(getCachedPlayRecordsSnapshot()).sort()).toEqual(['new+2', 'next+3']);
  await deletePlayRecords(['new+2', 'next+3']);
  expect(await getAllPlayRecords()).toEqual({});
  expect(fetch).not.toHaveBeenCalled();
});

test('按用户隔离，退出清缓存后仍保留进度', async () => {
  await savePlayRecord('source', '1', record);
  clearUserCache();
  auth.mockReturnValue({ username: 'bob' });
  expect(await getAllPlayRecords()).toEqual({});
  auth.mockReturnValue({ username: 'alice' });
  expect(await getAllPlayRecords()).toEqual({ 'source+1': record });
});

test('全量刷新不再请求云端播放记录', async () => {
  await savePlayRecord('source', '1', record);
  await refreshAllCache();
  expect(fetch).toHaveBeenCalled();
  expect((fetch as jest.Mock).mock.calls.every(([url]) => !String(url).includes('/api/playrecords'))).toBe(true);
  expect(await getAllPlayRecords()).toEqual({ 'source+1': record });
});

test('同浏览器标签页的更新通知仍正常', async () => {
  const onUpdate = jest.fn();
  const unsubscribe = subscribeToDataUpdates('playRecordsUpdated', onUpdate);
  await savePlayRecord('source', '1', record);
  expect(onUpdate).toHaveBeenCalledWith({ 'source+1': record });
  window.dispatchEvent(new StorageEvent('storage', {
    key: 'moontv_play_records:user:alice', storageArea: localStorage,
  }));
  expect(onUpdate).toHaveBeenCalledTimes(2);
  unsubscribe();
});
