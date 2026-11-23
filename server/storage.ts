import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Binary object storage. The local implementation writes under DATA_DIR/objects;
 * an S3/R2/GCS implementation only needs these four methods.
 */
export interface ObjectStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const SAFE_KEY = /^[A-Za-z0-9_\-/.]+$/;

export class LocalStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    if (!SAFE_KEY.test(key) || key.includes("..") || key.startsWith("/")) throw new Error("Invalid storage key");
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, data: Uint8Array) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async get(key: string) {
    return readFile(this.path(key));
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }

  async exists(key: string) {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
}
