export const getRecoveryKey = key => `${key}-recovery`;

export function writeDraft(storage, key, serialized, unreadableRaw = null) {
  if (unreadableRaw !== null) {
    const recoveryKey = getRecoveryKey(key);
    const previous = storage.getItem(recoveryKey);
    if (previous !== unreadableRaw) {
      if (previous !== null) {
        let suffix = 1, archiveKey, archived;
        do {
          archiveKey = `${recoveryKey}-${suffix++}`;
          archived = storage.getItem(archiveKey);
        } while (archived !== null && archived !== previous);
        if (archived === null) storage.setItem(archiveKey, previous);
      }
      storage.setItem(recoveryKey, unreadableRaw);
    }
  }
  // Preserve every unreadable source before replacing the only active draft.
  storage.setItem(key, serialized);
}
