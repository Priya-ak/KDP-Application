import type { AppContext } from "../context.ts";
import { notFound } from "../errors.ts";
import { decodeImage, downscale, encodePng, type Raster } from "../imaging/codec.ts";
import { randomId, sha256 } from "../security/crypto.ts";
import type { Queryable } from "../db/index.ts";

export type AssetKind = "illustration" | "original" | "upload" | "cover_art" | "reference" | "interior_pdf" | "cover_pdf" | "package";

export interface Asset {
  id: string;
  user_id: string;
  project_id: string | null;
  kind: AssetKind;
  storage_key: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  sha256: string;
  provider: string;
  is_demo: boolean;
  meta: Record<string, unknown>;
  created_at: string;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf", "application/zip": "zip" };
export const THUMB_SIZE = 480;

export interface SaveAssetInput {
  userId: string;
  projectId: string | null;
  kind: AssetKind;
  bytes: Uint8Array;
  mime: string;
  provider: string;
  isDemo?: boolean;
  width?: number;
  height?: number;
  meta?: Record<string, unknown>;
  /** For images: a raster to build the thumbnail from (avoids decoding again). */
  raster?: Raster;
}

/** Writes the binary to object storage (plus a thumbnail for images) and records it. */
export async function saveAsset(app: AppContext, input: SaveAssetInput, tx: Queryable = app.db): Promise<Asset> {
  const id = randomId("ast");
  const key = `u/${input.userId}/${input.projectId ?? "_"}/${id}.${EXT[input.mime] ?? "bin"}`;
  await app.storage.put(key, input.bytes);
  if (input.mime.startsWith("image/")) {
    const raster = input.raster ?? decodeImage(input.bytes);
    await app.storage.put(`${key}.thumb.png`, encodePng(downscale(raster, THUMB_SIZE)));
  }
  const rows = await tx.query<Asset>(
    `INSERT INTO assets (id, user_id, project_id, kind, storage_key, mime, bytes, width, height, sha256, provider, is_demo, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [id, input.userId, input.projectId, input.kind, key, input.mime, input.bytes.length, input.width ?? null, input.height ?? null, sha256(input.bytes), input.provider, !!input.isDemo, input.meta ?? {}],
  );
  return rows[0]!;
}

/** Loads an asset only if it belongs to the user (object-level authorization). */
export async function getOwnedAsset(app: AppContext, userId: string, assetId: string): Promise<Asset> {
  const asset = await app.db.one<Asset>("SELECT * FROM assets WHERE id = $1 AND user_id = $2", [assetId, userId]);
  if (!asset) throw notFound("File");
  return asset;
}

export async function readAsset(app: AppContext, asset: Asset, variant: "full" | "thumb" = "full"): Promise<Buffer> {
  if (variant === "thumb" && asset.mime.startsWith("image/")) {
    const thumbKey = `${asset.storage_key}.thumb.png`;
    if (await app.storage.exists(thumbKey)) return app.storage.get(thumbKey);
  }
  return app.storage.get(asset.storage_key);
}

export async function loadRaster(app: AppContext, assetId: string): Promise<Raster | null> {
  const asset = await app.db.one<Asset>("SELECT * FROM assets WHERE id = $1", [assetId]);
  if (!asset || !asset.mime.startsWith("image/")) return null;
  return decodeImage(await app.storage.get(asset.storage_key));
}
