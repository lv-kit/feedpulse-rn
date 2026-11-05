const native: Record<string, jest.Mock> = {};
let hasModule = true;
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  NativeModules: new Proxy({}, { get: (_t, p) => (p === 'FeedpulsePicker' && hasModule ? native : undefined) }),
}));

import { NativeAppAttestor } from '../attestor';
import { NativeConfigStore } from '../store';

beforeEach(() => {
  hasModule = true;
  for (const k of Object.keys(native)) delete native[k];
});

describe('NativeAppAttestor', () => {
  test('ネイティブの戻り値をそのまま返す', async () => {
    native.environment = jest.fn().mockResolvedValue({ platform: 'android', appId: 'com.example.app', os: 'Android 15', timezone: 'Asia/Tokyo' });
    native.attest = jest.fn().mockResolvedValue({ type: 'play_integrity', token: 't' });
    native.commitAttestation = jest.fn().mockResolvedValue(undefined);
    native.resetAttestation = jest.fn().mockResolvedValue(undefined);
    const a = new NativeAppAttestor();
    await expect(a.environment()).resolves.toMatchObject({ platform: 'android', appId: 'com.example.app' });
    await expect(a.attest('chal')).resolves.toEqual({ type: 'play_integrity', token: 't' });
    expect(native.attest).toHaveBeenCalledWith('chal');
    await a.commit();
    await a.reset();
    expect(native.commitAttestation).toHaveBeenCalled();
    expect(native.resetAttestation).toHaveBeenCalled();
  });

  test('ネイティブの reject は attestation_unavailable（コード付き）', async () => {
    native.environment = jest.fn();
    native.attest = jest.fn().mockRejectedValue(Object.assign(new Error('unsupported'), { code: 'app_attest_unsupported' }));
    await expect(new NativeAppAttestor().attest('c')).rejects.toMatchObject({
      code: 'attestation_unavailable',
      message: 'app_attest_unsupported: unsupported',
    });
  });

  test('モジュールが無い・古いビルドは attestation_unavailable', async () => {
    hasModule = false;
    await expect(new NativeAppAttestor().environment()).rejects.toMatchObject({ code: 'attestation_unavailable' });
    hasModule = true; // pickTarget だけの古いビルド
    await expect(new NativeAppAttestor().attest('c')).rejects.toMatchObject({ code: 'attestation_unavailable' });
    await expect(new NativeAppAttestor().commit()).resolves.toBeUndefined();
  });

  test('不正な environment は attestation_unavailable', async () => {
    native.attest = jest.fn();
    native.environment = jest.fn().mockResolvedValue({ platform: 'web', appId: '' });
    await expect(new NativeAppAttestor().environment()).rejects.toMatchObject({ code: 'attestation_unavailable' });
  });
});

describe('NativeConfigStore', () => {
  test('ネイティブに保存し読む', async () => {
    const mem = new Map<string, string>();
    native.storeRead = jest.fn(async (k: string) => mem.get(k) ?? null);
    native.storeWrite = jest.fn(async (k: string, v: string) => void mem.set(k, v));
    const s = new NativeConfigStore();
    await s.write('k', 'v');
    expect(mem.get('k')).toBe('v');
    expect(await new NativeConfigStore().read('k')).toBe('v');
    expect(await new NativeConfigStore().read('none')).toBeNull();
  });

  test('ネイティブが無い・失敗してもメモリで動く', async () => {
    hasModule = false;
    const s = new NativeConfigStore();
    await s.write('k', 'v');
    expect(await s.read('k')).toBe('v');
    hasModule = true;
    native.storeRead = jest.fn().mockRejectedValue(new Error('x'));
    native.storeWrite = jest.fn().mockRejectedValue(new Error('x'));
    await s.write('k2', 'v2');
    expect(await s.read('k2')).toBe('v2');
  });
});
