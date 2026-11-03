/** @jest-environment node */
import { NextRequest } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';

import { POST as changePassword } from './route';
import { POST as manageUser } from '../admin/user/route';

jest.mock('next/server', () => {
  return {
    NextRequest: class {
      body: string;
      headers: { get: (key: string) => string | null };
      cookies = { get: () => undefined };
      constructor(
        _url: string,
        init: { body?: string; headers?: Record<string, string> } = {}
      ) {
        this.body = init.body || '{}';
        this.headers = { get: (key) => init.headers?.[key] || null };
      }
      async json() {
        return JSON.parse(this.body);
      }
    },
    NextResponse: {
      json: (
        body: unknown,
        init?: { status?: number; headers?: Record<string, string> }
      ) => ({
        status: init?.status || 200,
        headers: init?.headers || {},
        json: async () => body,
      }),
    },
  };
});

jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  setCachedConfig: jest.fn(),
}));
jest.mock('@/lib/db', () => ({
  db: {
    getAdminConfig: jest.fn(),
    getUserInfoV2: jest.fn(),
    changePasswordV2: jest.fn(),
    saveAdminConfig: jest.fn(),
  },
  getStorage: jest.fn(() => ({})),
}));
jest.mock('@/lib/access-token-invalidation', () => ({
  invalidateDeviceAccessToken: jest.fn(),
  invalidateUserAccessTokens: jest.fn(),
}));
jest.mock('@/lib/refresh-token', () => ({
  getUserDevices: jest.fn(async () => []),
  revokeRefreshToken: jest.fn(),
  revokeAllRefreshTokens: jest.fn(),
}));

const originalEnv = { ...process.env };
let config: AdminConfig;
const auth = jest.mocked(getAuthInfoFromCookie);
const storage = jest.mocked(db);
function request(body: object) {
  return new NextRequest('http://localhost/api/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function toggle(targetUsername: string, enabled: unknown) {
  return manageUser(
    request({ action: 'setUserPasswordChange', targetUsername, enabled })
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'd1';
  process.env.USERNAME = 'owner';
  config = {
    UserConfig: { Users: [], PasswordChangeDisabledUsers: [] },
  } as unknown as AdminConfig;
  storage.getAdminConfig.mockResolvedValue(config);
  jest.mocked(getConfig).mockResolvedValue(config);
  storage.getUserInfoV2.mockImplementation(async (username) => {
    if (username === 'missing') return null;
    return {
      role: username.startsWith('admin') ? 'admin' : 'user',
      banned: username === 'banned',
    } as Awaited<ReturnType<typeof db.getUserInfoV2>>;
  });
  auth.mockReturnValue({ username: 'alice', role: 'user' });
});
afterAll(() => {
  process.env = originalEnv;
});

describe('用户自行改密权限', () => {
  it('被禁用用户直接调用接口也返回 403，不写入密码', async () => {
    config.UserConfig.PasswordChangeDisabledUsers = ['alice'];
    const response = await changePassword(
      request({ newPassword: 'new-secret' })
    );
    expect(response.status).toBe(403);
    expect(storage.changePasswordV2).not.toHaveBeenCalled();
  });
  it('旧配置没有权限字段时仍允许改密', async () => {
    delete config.UserConfig.PasswordChangeDisabledUsers;
    expect(
      (await changePassword(request({ newPassword: 'new-secret' }))).status
    ).toBe(200);
    expect(storage.changePasswordV2).toHaveBeenCalledWith(
      'alice',
      'new-secret'
    );
  });
  it('禁用其他用户不会影响当前用户', async () => {
    config.UserConfig.PasswordChangeDisabledUsers = ['bob'];
    expect(
      (await changePassword(request({ newPassword: 'new-secret' }))).status
    ).toBe(200);
  });
  it('数据库读取失败时不修改密码', async () => {
    storage.getAdminConfig.mockRejectedValue(new Error('database unavailable'));
    expect(
      (await changePassword(request({ newPassword: 'new-secret' }))).status
    ).toBe(500);
    expect(storage.changePasswordV2).not.toHaveBeenCalled();
  });
  it('未登录无法修改密码', async () => {
    auth.mockReturnValue(null);
    expect(
      (await changePassword(request({ newPassword: 'new-secret' }))).status
    ).toBe(401);
    expect(storage.changePasswordV2).not.toHaveBeenCalled();
  });
});

describe('管理员设置用户改密权限', () => {
  it('管理员可禁用、重复禁用和恢复普通用户，且保留其他限制', async () => {
    auth.mockReturnValue({ username: 'admin', role: 'admin' });
    config.UserConfig.PasswordChangeDisabledUsers = ['bob'];
    expect((await toggle('alice', false)).status).toBe(200);
    expect((await toggle('alice', false)).status).toBe(200);
    expect(config.UserConfig.PasswordChangeDisabledUsers).toEqual([
      'bob',
      'alice',
    ]);
    expect(storage.saveAdminConfig).toHaveBeenCalledWith(config);
    expect(setCachedConfig).toHaveBeenCalledWith(config);
    auth.mockReturnValue({ username: 'alice' });
    expect(
      (await changePassword(request({ newPassword: 'secret' }))).status
    ).toBe(403);
    auth.mockReturnValue({ username: 'admin' });
    expect((await toggle('alice', true)).status).toBe(200);
    expect(config.UserConfig.PasswordChangeDisabledUsers).toEqual(['bob']);
    auth.mockReturnValue({ username: 'alice' });
    expect(
      (await changePassword(request({ newPassword: 'secret' }))).status
    ).toBe(200);
  });
  it('普通用户不能解除自己的限制或设置他人的权限', async () => {
    expect((await toggle('alice', true)).status).toBe(400);
    expect((await toggle('bob', false)).status).toBe(401);
    expect(storage.saveAdminConfig).not.toHaveBeenCalled();
  });
  it('管理员不能设置其他管理员的权限', async () => {
    auth.mockReturnValue({ username: 'admin' });
    expect((await toggle('admin2', false)).status).toBe(403);
    expect(storage.saveAdminConfig).not.toHaveBeenCalled();
  });
  it('站长可以设置管理员权限，但不能禁用站长', async () => {
    auth.mockReturnValue({ username: 'owner' });
    expect((await toggle('admin', false)).status).toBe(200);
    expect((await toggle('owner', false)).status).toBe(400);
  });
  it('目标用户不存在或参数无效时不保存', async () => {
    auth.mockReturnValue({ username: 'admin' });
    expect((await toggle('missing', false)).status).toBe(404);
    expect((await toggle('alice', 'false')).status).toBe(400);
    expect(storage.saveAdminConfig).not.toHaveBeenCalled();
  });
  it('管理员仍可为被禁用的普通用户重置密码', async () => {
    auth.mockReturnValue({ username: 'admin' });
    config.UserConfig.PasswordChangeDisabledUsers = ['alice'];
    const response = await manageUser(
      request({
        action: 'changePassword',
        targetUsername: 'alice',
        targetPassword: 'reset-secret',
      })
    );
    expect(response.status).toBe(200);
    expect(storage.changePasswordV2).toHaveBeenCalledWith(
      'alice',
      'reset-secret'
    );
  });
  it('被禁用的管理员无法从管理接口绕过自己的限制', async () => {
    auth.mockReturnValue({ username: 'admin' });
    config.UserConfig.PasswordChangeDisabledUsers = ['admin'];
    const response = await manageUser(
      request({
        action: 'changePassword',
        targetUsername: 'admin',
        targetPassword: 'secret',
      })
    );
    expect(response.status).toBe(403);
    expect(storage.changePasswordV2).not.toHaveBeenCalled();
  });
});
