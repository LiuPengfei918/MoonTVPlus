import { withLocalGuestPolicy } from '@/lib/local-guest.server';

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  createTelegramBindSession,
  getTelegramBinding,
  getTelegramConfig,
  getTelegramConfigProblems,
  getTelegramDeepLink,
} from '@/lib/telegram';

export const runtime = 'nodejs';

async function handleGET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await getTelegramConfig();
  const binding = await getTelegramBinding(authInfo.username);
  const problems = getTelegramConfigProblems(config, 'binding');
  return NextResponse.json({
    enabled: problems.length === 0,
    problems,
    botUsername: config.botUsername.replace(/^@/, ''),
    binding,
  });
}

async function handlePOST(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await getTelegramConfig();
  const problems = getTelegramConfigProblems(config, 'binding');
  if (problems.length > 0) {
    return NextResponse.json({
      error: `Telegram 绑定不可用：${problems.join('、')}`,
      config: {
        enabled: config.enabled,
        bindingEnabled: config.bindingEnabled,
        hasBotToken: Boolean(config.botToken),
        hasBotUsername: Boolean(config.botUsername),
        botUsername: config.botUsername || '',
      },
    }, { status: 400 });
  }

  const session = await createTelegramBindSession(authInfo.username);
  const botUsername = config.botUsername.replace(/^@/, '');
  return NextResponse.json({
    code: session.code,
    expiresAt: session.expiresAt,
    botUsername,
    deepLink: getTelegramDeepLink(botUsername, `bind_${session.code}`),
  });
}

export const GET = withLocalGuestPolicy(handleGET);
export const POST = withLocalGuestPolicy(handlePOST);
