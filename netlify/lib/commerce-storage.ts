import { getStore } from '@netlify/blobs';

export type Versioned<T> = { data: T; etag: string };
export interface CommerceStorage {
  get<T>(key: string): Promise<Versioned<T> | null>;
  put(key: string, value: unknown, condition: { onlyIfNew: true } | { onlyIfMatch: string }): Promise<boolean>;
  list(cursor?: string): Promise<{ keys: string[]; cursor?: string }>;
  delete(key: string): Promise<void>;
}

/** Site-wide private records, persisted across deployments. Every mutation is conditional. */
export function blobStorage(): CommerceStorage {
  const store = getStore({ name: 'mne-commerce-v1', consistency: 'strong' });
  return {
    async get<T>(key: string) {
      const value = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
      if (value && !value.etag) throw new Error('Storage version missing');
      return value ? { data: value.data as T, etag: value.etag! } : null;
    },
    async put(key, value, condition) {
      return (await store.setJSON(key, value, condition)).modified;
    },
    async list(cursor) {
      // SDK performs pagination internally; return bounded pages using the last key.
      const value = await store.list({ prefix: 'records/' });
      const keys = value.blobs.map(blob => blob.key).sort().filter(key => !cursor || key > cursor);
      return { keys: keys.slice(0, 50), ...(keys.length > 50 ? { cursor: keys[49] } : {}) };
    },
    delete: key => store.delete(key),
  };
}
