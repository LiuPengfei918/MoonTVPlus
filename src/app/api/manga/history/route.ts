import { withLocalGuestPolicy } from '@/lib/local-guest.server';

import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { MangaReadRecord } from '@/lib/manga.types';

import { getAuthorizedUsername } from '../_utils';

export const runtime = 'nodejs';

async function handleGET(request: NextRequest) {
  const username = await getAuthorizedUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const key = new URL(request.url).searchParams.get('key');
    if (key) {
      const [sourceId, mangaId] = key.split('+');
      if (!sourceId || !mangaId) {
        return NextResponse.json({ error: 'Invalid key format' }, { status: 400 });
      }
      const record = await db.getMangaReadRecord(username, sourceId, mangaId);
      return NextResponse.json(record, { status: 200 });
    }

    const records = await db.getAllMangaReadRecords(username);
    return NextResponse.json(records, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function handlePOST(request: NextRequest) {
  const username = await getAuthorizedUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const { key, record }: { key: string; record: MangaReadRecord } = await request.json();
    if (!key || !record?.chapterId) {
      return NextResponse.json({ error: 'Missing key or record' }, { status: 400 });
    }

    const [sourceId, mangaId] = key.split('+');
    if (!sourceId || !mangaId) {
      return NextResponse.json({ error: 'Invalid key format' }, { status: 400 });
    }

    await db.saveMangaReadRecord(username, sourceId, mangaId, {
      ...record,
      saveTime: record.saveTime ?? Date.now(),
    });

    if ((db as any).storage.cleanupOldMangaReadRecords) {
      (db as any).storage.cleanupOldMangaReadRecords(username).catch((err: Error) => {
        console.error('异步清理漫画阅读历史失败:', err);
      });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function handleDELETE(request: NextRequest) {
  const username = await getAuthorizedUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const key = new URL(request.url).searchParams.get('key');
    if (key) {
      const [sourceId, mangaId] = key.split('+');
      if (!sourceId || !mangaId) {
        return NextResponse.json({ error: 'Invalid key format' }, { status: 400 });
      }
      await db.deleteMangaReadRecord(username, sourceId, mangaId);
    } else {
      const all = await db.getAllMangaReadRecords(username);
      await Promise.all(Object.keys(all).map(async (itemKey) => {
        const [sourceId, mangaId] = itemKey.split('+');
        if (sourceId && mangaId) {
          await db.deleteMangaReadRecord(username, sourceId, mangaId);
        }
      }));
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export const GET = withLocalGuestPolicy(handleGET);
export const POST = withLocalGuestPolicy(handlePOST);
export const DELETE = withLocalGuestPolicy(handleDELETE);
