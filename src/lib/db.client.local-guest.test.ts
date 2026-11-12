import { getAuthInfoFromBrowserCookie } from './auth';
import { getAllBookShelf, saveBookShelf } from './book.db.client';
import type { BookShelfItem } from './book.types';
import type { Favorite } from './db.client';
import {
  addSearchHistory,
  clearUserCache,
  deleteFavorite,
  getAllFavorites,
  getAllMangaReadRecords,
  getAllMangaShelf,
  getAllSkipConfigs,
  getDanmakuFilterConfig,
  getSearchHistory,
  preloadUserData,
  refreshAllCache,
  saveDanmakuFilterConfig,
  saveFavorite,
  saveMangaReadRecord,
  saveMangaShelf,
  saveSkipConfig,
} from './db.client';
import type { MangaReadRecord,MangaShelfItem } from './manga.types';

jest.mock('./auth', () => {
  Object.assign(window, {
    RUNTIME_CONFIG: { STORAGE_TYPE: 'upstash', LOCAL_GUEST: true },
  });
  return { getAuthInfoFromBrowserCookie: jest.fn() };
});
const auth = jest.mocked(getAuthInfoFromBrowserCookie);
const favorite: Favorite = {
  title: '测试',
  source_name: '源',
  year: '2026',
  cover: '',
  total_episodes: 1,
  save_time: 1,
};

beforeEach(() => {
  localStorage.clear();
  auth.mockReturnValue({ username: 'alice', role: 'user' });
  global.fetch = jest
    .fn()
    .mockRejectedValue(new Error('Unexpected personal network request'));
});

test('访客收藏、搜索、书架及预加载只使用本地存储', async () => {
  await saveFavorite('source', '1', favorite);
  await addSearchHistory('海贼王');
  await saveBookShelf('source', 'book', { title: '书名' } as BookShelfItem);
  await refreshAllCache();
  await preloadUserData();
  expect(await getAllFavorites()).toEqual({ 'source+1': favorite });
  expect(await getSearchHistory()).toEqual(['海贼王']);
  expect(await getAllBookShelf()).toEqual({ 'source+book': { title: '书名' } });
  expect(fetch).not.toHaveBeenCalled();
  await deleteFavorite('source', '1');
  expect(await getAllFavorites()).toEqual({});
});

test('本地数据按账号隔离，退出清理云缓存后仍可恢复', async () => {
  await saveFavorite('source', '1', favorite);
  await addSearchHistory('海贼王');
  clearUserCache();
  auth.mockReturnValue({ username: 'bob', role: 'user' });
  expect(await getAllFavorites()).toEqual({});
  expect(await getSearchHistory()).toEqual([]);
  auth.mockReturnValue({ username: 'alice', role: 'user' });
  expect(await getAllFavorites()).toEqual({ 'source+1': favorite });
  expect(await getSearchHistory()).toEqual(['海贼王']);
  expect(fetch).not.toHaveBeenCalled();
});

test('漫画书架、阅读进度及播放过滤配置均在本地读写', async () => {
  const shelf = { title: '漫画', saveTime: 1 } as MangaShelfItem;
  const history = {
    title: '漫画',
    chapterId: 'chapter',
    saveTime: 1,
  } as MangaReadRecord;
  const skip = { enable: true, intro_time: 90, outro_time: 30 };
  const filter = {
    rules: [{ keyword: '剧透', enabled: true, type: 'normal' as const }],
  };
  await saveMangaShelf('source', '1', shelf);
  await saveMangaReadRecord('source', '1', history);
  await saveSkipConfig('source', '1', skip);
  await saveDanmakuFilterConfig(filter);
  expect(await getAllMangaShelf()).toEqual({ 'source+1': shelf });
  expect(await getAllMangaReadRecords()).toEqual({ 'source+1': history });
  expect(await getAllSkipConfigs()).toEqual({ 'source+1': skip });
  expect(await getDanmakuFilterConfig()).toEqual(filter);
  expect(fetch).not.toHaveBeenCalled();
});
