const pick = jest.fn();
const cancel = jest.fn();
let os = 'ios';
jest.mock('react-native', () => ({
  get Platform() { return { OS: os }; },
  NativeModules: { FeedpulsePicker: { pickTarget: (...a: unknown[]) => pick(...a), cancelPick: () => cancel() } },
}));

import { pickTarget, cancelPickTarget, FeedpulsePickError } from '../picker';
import { sanitizeTarget } from '../target';

beforeEach(() => { pick.mockReset(); cancel.mockReset(); os = 'ios'; });

test('testID が target.id になり platform は react-native に上書き', async () => {
  pick.mockResolvedValue({ platform: 'ios', id: 'checkout-button', rect: { x: 1, y: 2, w: 3, h: 4 }, label: 'Buy' });
  const t = await pickTarget({ screen: 'Checkout' });
  expect(t).toEqual({ platform: 'react-native', id: 'checkout-button', rect: { x: 1, y: 2, w: 3, h: 4 }, label: 'Buy', screen: 'Checkout' });
});

test('キャンセルは null（reject しない）', async () => {
  pick.mockResolvedValue(null);
  await expect(pickTarget()).resolves.toBeNull();
});

test('不正な戻り値は invalid_target', async () => {
  pick.mockResolvedValue({ label: 'only label' });
  await expect(pickTarget()).rejects.toMatchObject({ code: 'invalid_target' });
});

test('二重起動は already_picking、完了後は再実行できる', async () => {
  let resolve!: (v: unknown) => void;
  pick.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  const first = pickTarget();
  await expect(pickTarget()).rejects.toBeInstanceOf(FeedpulsePickError);
  resolve(null);
  await first;
  pick.mockResolvedValue(null);
  await expect(pickTarget()).resolves.toBeNull();
});

test('native エラーは native_error', async () => {
  pick.mockRejectedValue(new Error('boom'));
  await expect(pickTarget()).rejects.toMatchObject({ code: 'native_error', message: 'boom' });
});

test('web 等は unavailable', async () => {
  os = 'web';
  await expect(pickTarget()).rejects.toMatchObject({ code: 'unavailable' });
});

test('cancelPickTarget はネイティブへ委譲', () => {
  cancelPickTarget();
  expect(cancel).toHaveBeenCalled();
});

describe('sanitizeTarget', () => {
  test('長さ上限・制御文字・NaN rect', () => {
    const t = sanitizeTarget({ id: 'a\u0000b', label: 'x'.repeat(500), rect: { x: NaN, y: 0, w: 1, h: 1 }, path: 'p' });
    expect(t?.id).toBe('ab');
    expect(t?.label?.length).toBe(80);
    expect(t?.rect).toBeUndefined();
  });
  test('型違いは捨てる', () => {
    expect(sanitizeTarget({ id: 123 })).toBeNull();
    expect(sanitizeTarget('x')).toBeNull();
  });
});
