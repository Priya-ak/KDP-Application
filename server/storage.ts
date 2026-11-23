import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";

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

export interface S3Options {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** S3-compatible storage (Neon object storage, Cloudflare R2, AWS S3, MinIO). Same four methods as LocalStorage. */
export class S3Storage implements ObjectStorage {
  private client?: S3Client;

  constructor(private readonly opts: S3Options) {}

  private async sdk() {
    return import("@aws-sdk/client-s3");
  }

  private async s3(): Promise<S3Client> {
    if (!this.client) {
      const { S3Client } = await this.sdk();
      this.client = new S3Client({
        region: this.opts.region,
        endpoint: this.opts.endpoint || undefined,
        forcePathStyle: true,
        credentials: { accessKeyId: this.opts.accessKeyId, secretAccessKey: this.opts.secretAccessKey },
      });
    }
    return this.client;
  }

  private key(key: string): string {
    if (!SAFE_KEY.test(key) || key.includes("..") || key.startsWith("/")) throw new Error("Invalid storage key");
    return key;
  }

  async put(key: string, data: Uint8Array) {
    const { PutObjectCommand } = await this.sdk();
    await (await this.s3()).send(new PutObjectCommand({ Bucket: this.opts.bucket, Key: this.key(key), Body: data }));
  }

  async get(key: string) {
    const { GetObjectCommand } = await this.sdk();
    const res = await (await this.s3()).send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: this.key(key) }));
    if (!res.Body) throw new Error(`Object not found: ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async delete(key: string) {
    const { DeleteObjectCommand } = await this.sdk();
    await (await this.s3()).send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: this.key(key) }));
  }

  async exists(key: string) {
    const { HeadObjectCommand } = await this.sdk();
    try {
      await (await this.s3()).send(new HeadObjectCommand({ Bucket: this.opts.bucket, Key: this.key(key) }));
      return true;
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
  }
}
