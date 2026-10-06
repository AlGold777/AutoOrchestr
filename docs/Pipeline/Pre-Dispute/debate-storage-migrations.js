(function initDebateStorageMigrations(root) {
  'use strict';
  const VERSION = 1;
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const TARGETS = Object.freeze({
    case: () => Number(root.DebateCaseSchema?.VERSION || 4),
    run: () => Number(root.DebateRunStore?.VERSION || 5),
    revision: () => Number(root.DebatePlanRevision?.SCHEMA_VERSION || 1),
    trace: () => Number(root.DebateTraceSchema?.VERSION || 4),
    participant: () => 1,
    custom_config: () => 1
  });

  function targetVersion(kind) {
    const resolver = TARGETS[String(kind || '')];
    if (!resolver) throw new Error(`Unsupported persisted data kind: ${kind}`);
    return resolver();
  }

  function migrateRecord(kind, input = {}) {
    const target = targetVersion(kind);
    const source = Number(input.schemaVersion || input.version || 0);
    if (source > target) throw new Error(`Unsupported future ${kind} schema: ${source}`);
    if (kind === 'case' && root.DebateCaseSchema?.migrate) {
      const migrated = source === target ? clone(input) : root.DebateCaseSchema.migrate(input);
      return {
        value: migrated,
        receipt: { kind, sourceVersion: source, targetVersion: target, changed: source !== target }
      };
    }
    if (source === target) {
      return { value: clone(input), receipt: { kind, sourceVersion: source, targetVersion: target, changed: false } };
    }
    const knownEnvelope = new Set(['schemaVersion', 'version', 'migrationHistory', 'extensions']);
    const legacyUnknownFields = Object.fromEntries(Object.entries(input).filter(([key]) => !knownEnvelope.has(key)));
    const value = {
      ...clone(input),
      schemaVersion: target,
      extensions: {
        ...(clone(input.extensions || {})),
        legacyUnknownFields: {
          ...(clone(input.extensions?.legacyUnknownFields || {})),
          ...legacyUnknownFields
        }
      },
      migrationHistory: [
        ...(Array.isArray(input.migrationHistory) ? clone(input.migrationHistory) : []),
        ...(source === target ? [] : [{ from: source, to: target, migrationVersion: VERSION }])
      ]
    };
    return { value, receipt: { kind, sourceVersion: source, targetVersion: target, changed: source !== target } };
  }

  function storagePort(storage) {
    const get = async (key) => {
      if (storage?.getItem) return JSON.parse(storage.getItem(key) || 'null');
      const result = await storage?.get?.(key);
      return result?.[key];
    };
    const set = async (key, value) => {
      if (storage?.setItem) return storage.setItem(key, JSON.stringify(value));
      return storage?.set?.({ [key]: value });
    };
    const remove = async (key) => {
      if (storage?.removeItem) return storage.removeItem(key);
      return storage?.remove?.(key);
    };
    return { get, set, remove };
  }

  function createTransaction(options = {}) {
    const port = storagePort(options.storage);
    const key = String(options.key || '');
    const kind = String(options.kind || '');
    if (!key || !kind) throw new Error('Migration transaction requires key and kind');
    const backupKey = `${key}:backup:migration-v${VERSION}`;
    return Object.freeze({
      backupKey,
      async run() {
        const original = await port.get(key);
        if (original == null) return { ok: false, code: 'MIGRATION_SOURCE_MISSING' };
        await port.set(backupKey, { kind, createdAt: Date.now(), value: clone(original) });
        try {
          const migrated = migrateRecord(kind, original);
          await port.set(key, migrated.value);
          const verified = await port.get(key);
          if (JSON.stringify(verified) !== JSON.stringify(migrated.value)) throw new Error('migration_write_verification_failed');
          return { ok: true, ...migrated, backupKey };
        } catch (error) {
          await port.set(key, original);
          return { ok: false, code: 'MIGRATION_FAILED_ROLLED_BACK', error: String(error?.message || error), backupKey };
        }
      },
      async restore() {
        const backup = await port.get(backupKey);
        if (!backup?.value) return { ok: false, code: 'MIGRATION_BACKUP_MISSING' };
        await port.set(key, backup.value);
        return { ok: true, value: clone(backup.value) };
      },
      async exportBackup() {
        const backup = await port.get(backupKey);
        return backup ? JSON.stringify(backup, null, 2) : '';
      },
      async discardBackup() {
        await port.remove(backupKey);
        return true;
      }
    });
  }

  const api = Object.freeze({ VERSION, TARGETS, targetVersion, migrateRecord, createTransaction });
  root.DebateStorageMigrations = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
