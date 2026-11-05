import { getNativePicker } from './NativeFeedpulsePicker';

/** config のローカル保存。 */
export interface ConfigStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

/** プロセス内だけに持つ実装（テスト用・ネイティブ非対応環境用）。 */
export class MemoryConfigStore implements ConfigStore {
  private readonly m = new Map<string, string>();
  async read(key: string): Promise<string | null> {
    return this.m.get(key) ?? null;
  }
  async write(key: string, value: string): Promise<void> {
    this.m.set(key, value);
  }
}

/**
 * ネイティブの永続ストア（iOS: UserDefaults、Android: SharedPreferences）。
 * 依存を増やさないためこのパッケージ自身のネイティブモジュールを使う。
 * ネイティブが無い・失敗したときはプロセス内のメモリに退避する（キャッシュなので無くても動く）。
 */
export class NativeConfigStore implements ConfigStore {
  private readonly fallback = new MemoryConfigStore();

  async read(key: string): Promise<string | null> {
    const n = getNativePicker();
    if (n?.storeRead) {
      try {
        const v = await n.storeRead(key);
        if (typeof v === 'string') return v;
      } catch {
        // メモリへ
      }
    }
    return this.fallback.read(key);
  }

  async write(key: string, value: string): Promise<void> {
    await this.fallback.write(key, value);
    const n = getNativePicker();
    if (n?.storeWrite) {
      try {
        await n.storeWrite(key, value);
      } catch {
        // 保存できなくても動く
      }
    }
  }
}
