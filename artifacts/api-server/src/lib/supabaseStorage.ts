import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import logger from "./logger";

const BUCKET_NAME = "claim-documents";

function getSupabaseUrl(): string {
  const dbUrl = process.env.SUPABASE_DATABASE_URL || "";
  const match = dbUrl.match(/postgres\.([a-z0-9]+)[:/]/);
  if (match) {
    return `https://${match[1]}.supabase.co`;
  }
  throw new Error("Cannot derive Supabase URL from SUPABASE_DATABASE_URL");
}

function getClient() {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE is not set");
  }
  return createClient(url, key);
}

let _client: any = null;
function supabase() {
  if (!_client) {
    _client = getClient();
  }
  return _client;
}

export async function ensureBucket(): Promise<void> {
  const { data, error } = await supabase().storage.getBucket(BUCKET_NAME);
  if (data) return;

  const { error: createError } = await supabase().storage.createBucket(BUCKET_NAME, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
  });
  if (createError && !createError.message.includes("already exists")) {
    throw new Error(`Failed to create bucket: ${createError.message}`);
  }
  logger.info({ bucket: BUCKET_NAME }, `Supabase Storage bucket "${BUCKET_NAME}" ensured`);
}

export async function uploadFile(
  fileBuffer: Buffer,
  fileName: string,
  contentType: string
): Promise<string> {
  await ensureBucket();
  const fileId = randomUUID();
  const storagePath = `uploads/${fileId}/${fileName}`;

  const { error } = await supabase().storage
    .from(BUCKET_NAME)
    .upload(storagePath, fileBuffer, {
      contentType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  return storagePath;
}

export async function downloadFile(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase().storage
    .from(BUCKET_NAME)
    .download(storagePath);

  if (error || !data) {
    throw new Error(`Supabase download failed: ${error?.message || "No data"}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function getSignedUrl(storagePath: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase().storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create signed URL: ${error?.message || "No URL"}`);
  }

  return data.signedUrl;
}

export async function fileExists(storagePath: string): Promise<boolean> {
  try {
    const parts = storagePath.split("/");
    const fileName = parts.pop()!;
    const folder = parts.join("/");
    const { data, error } = await supabase().storage
      .from(BUCKET_NAME)
      .list(folder, { limit: 1, search: fileName });
    if (error) return false;
    return Array.isArray(data) && data.some((f: any) => f.name === fileName);
  } catch {
    return false;
  }
}

export async function deleteFile(storagePath: string): Promise<void> {
  const { error } = await supabase().storage
    .from(BUCKET_NAME)
    .remove([storagePath]);

  if (error) {
    logger.error({ err: error }, "Failed to delete file from storage");
  }
}

export { BUCKET_NAME };
