import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from './auth';
import { getConfig } from './config';

export async function isLocalGuestUsername(username: string): Promise<boolean> {
  const config = await getConfig();
  return config.UserConfig.LocalGuestUsers?.includes(username) === true;
}

/** 拦住旧页面/手工调用的个人云端接口；只查公共策略，不读写用户个人数据。 */
export function withLocalGuestPolicy<
  Args extends unknown[],
  Result extends Response
>(handler: (request: NextRequest, ...args: Args) => Promise<Result>) {
  return async (
    request: NextRequest,
    ...args: Args
  ): Promise<Result | NextResponse> => {
    const auth = getAuthInfoFromCookie(request);
    if (auth?.username && auth.role !== 'admin' && auth.role !== 'owner') {
      const config = await getConfig();
      if (config.UserConfig.LocalGuestUsers?.includes(auth.username)) {
        return NextResponse.json(
          {
            error: '本地访客的个人数据仅保存在当前浏览器，此云端功能不可用',
            code: 'LOCAL_GUEST',
          },
          { status: 403, headers: { 'Cache-Control': 'no-store' } }
        );
      }
    }
    return handler(request, ...args);
  };
}
