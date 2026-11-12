/** @jest-environment node */
import { NextRequest } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

import { POST as detail } from './detail/route';
import { POST as manifest } from './read/manifest/route';

jest.mock('next/server', () => ({
  NextResponse: class {
    static json(body: unknown, init?: { status?: number }) {
      return { status: init?.status || 200, json: async () => body };
    }
  },
}));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('./_utils', () => ({
  getAuthorizedBooksUsername: jest.fn(async () => 'alice'),
}));
jest.mock('@/lib/db', () => ({
  db: { getBookShelf: jest.fn(), getBookReadRecord: jest.fn() },
}));
jest.mock('@/lib/book-provider', () => ({
  bookProvider: {
    getBookDetail: jest.fn(async () => ({
      id: 'book',
      title: '书',
      acquisitionLinks: [],
    })),
    getPreferredAcquisition: jest.fn(async () => ({
      format: 'epub',
      href: 'https://books.example/book.epub',
    })),
  },
}));

function request(body: object): NextRequest {
  return { json: async () => body } as NextRequest;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(getConfig)
    .mockResolvedValue({
      UserConfig: { LocalGuestUsers: ['alice'] },
    } as Awaited<ReturnType<typeof getConfig>>);
});

test('访客的书籍详情和阅读清单使用客户端链接，不读取云端书架及进度', async () => {
  const payload = {
    sourceId: 'source',
    bookId: 'book',
    href: 'https://books.example/book',
    acquisitionHref: 'https://books.example/book.epub',
  };
  expect((await detail(request(payload))).status).toBe(200);
  const response = await manifest(request(payload));
  expect(response.status).toBe(200);
  expect((await response.json()).lastRecord).toBeNull();
  expect(db.getBookShelf).not.toHaveBeenCalled();
  expect(db.getBookReadRecord).not.toHaveBeenCalled();
});

test('普通用户仍可通过云端书架恢复阅读链接', async () => {
  jest
    .mocked(getConfig)
    .mockResolvedValue({ UserConfig: {} } as Awaited<
      ReturnType<typeof getConfig>
    >);
  jest
    .mocked(db.getBookShelf)
    .mockResolvedValue({
      detailHref: 'https://books.example/book',
    } as NonNullable<Awaited<ReturnType<typeof db.getBookShelf>>>);
  const response = await manifest(
    request({ sourceId: 'source', bookId: 'book' })
  );
  expect(response.status).toBe(200);
  expect(db.getBookShelf).toHaveBeenCalledWith('alice', 'source', 'book');
  expect(db.getBookReadRecord).toHaveBeenCalled();
});
