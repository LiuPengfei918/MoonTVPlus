import { withLocalGuestPolicy } from '@/lib/local-guest.server';

import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { MangaShelfItem } from '@/lib/manga.types';

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
      const item = await db.getMangaShelf(username, sourceId, mangaId);
      return NextResponse.json(item, { status: 200 });
    }

    const records = await db.getAllMangaShelf(username);
    return NextResponse.json(records, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

async function handlePOST(request: NextRequest) {
  const username = await getAuthorizedUsername(request);
  if (username instanceof NextResponse) return username;

  try {
    const { key, item }: { key: string; item: MangaShelfItem } = await request.json();
    if (!key || !item?.title) {
      return NextResponse.json({ error: 'Missing key or item' }, { status: 400 });
    }

    const [sourceId, mangaId] = key.split('+');
    if (!sourceId || !mangaId) {
      return NextResponse.json({ error: 'Invalid key format' }, { status: 400 });
    }

    await db.saveMangaShelf(username, sourceId, mangaId, {
      ...item,
      saveTime: item.saveTime ?? Date.now(),
    });
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
      await db.deleteMangaShelf(username, sourceId, mangaId);
    } else {
      const all = await db.getAllMangaShelf(username);
      await Promise.all(Object.keys(all).map(async (itemKey) => {
        const [sourceId, mangaId] = itemKey.split('+');
        if (sourceId && mangaId) {
          await db.deleteMangaShelf(username, sourceId, mangaId);
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
