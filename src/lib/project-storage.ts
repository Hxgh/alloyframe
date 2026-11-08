export function readProjectStorage(storage: Pick<Storage, "getItem">, key: string, legacyKey: string): string | null {
  return storage.getItem(key) ?? storage.getItem(legacyKey);
}

export function writeProjectStorage(storage: Pick<Storage, "setItem" | "removeItem">, key: string, legacyKey: string, value: string | null): void {
  if (value === null) {
    // 先清旧键，清理失败时保留新键，避免旧备份重新出现。
    storage.removeItem(legacyKey);
    storage.removeItem(key);
  } else {
    storage.setItem(key, value);
    storage.removeItem(legacyKey);
  }
}
