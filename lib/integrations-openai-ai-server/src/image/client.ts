import fs from "node:fs";
import { toFile } from "openai";
import { Buffer } from "node:buffer";
import { gemini } from "../client";

export const openai = gemini;

export async function generateImageBuffer(
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024"
): Promise<Buffer> {
  const response = await openai.images.generate({
    model: process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image",
    prompt,
    size,
  });
  const base64 = response.data?.[0]?.b64_json ?? "";
  if (!base64) {
    throw new Error("Image generation returned no image bytes.");
  }
  return Buffer.from(base64, "base64");
}

export async function editImages(
  imageFiles: string[],
  prompt: string,
  outputPath?: string
): Promise<Buffer> {
  const images = await Promise.all(
    imageFiles.map((file) =>
      toFile(fs.createReadStream(file), file, {
        type: "image/png",
      })
    )
  );

  const response = await openai.images.edit({
    model: process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image",
    image: images,
    prompt,
  });

  const imageBase64 = response.data?.[0]?.b64_json ?? "";
  if (!imageBase64) {
    throw new Error("Image edit returned no image bytes.");
  }
  const imageBytes = Buffer.from(imageBase64, "base64");

  if (outputPath) {
    fs.writeFileSync(outputPath, imageBytes);
  }

  return imageBytes;
}
