import { Router, type IRouter, type Request, type Response } from "express";
import {
  uploadFile,
  downloadFile,
  getSignedUrl,
  ensureBucket,
} from "../lib/supabaseStorage";
import multer from "multer";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

ensureBucket().catch((err) => {
  console.error("Failed to ensure Supabase Storage bucket:", err);
});

router.post("/storage/upload", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const storagePath = await uploadFile(
      file.buffer,
      file.originalname,
      file.mimetype
    );

    res.json({
      storagePath,
      fileName: file.originalname,
      contentType: file.mimetype,
      size: file.size,
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message || "Failed to upload file" });
  }
});

router.get("/storage/download/:path(*)", async (req: Request, res: Response) => {
  try {
    const storagePath = req.params.path;
    if (!storagePath) {
      res.status(400).json({ error: "Path is required" });
      return;
    }

    const buffer = await downloadFile(storagePath);
    const ext = storagePath.split(".").pop()?.toLowerCase();
    const contentType = ext === "pdf" ? "application/pdf" : "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (error: any) {
    console.error("Download error:", error);
    res.status(404).json({ error: error.message || "File not found" });
  }
});

router.get("/storage/signed-url/:path(*)", async (req: Request, res: Response) => {
  try {
    const storagePath = req.params.path;
    if (!storagePath) {
      res.status(400).json({ error: "Path is required" });
      return;
    }

    const url = await getSignedUrl(storagePath);
    res.json({ url });
  } catch (error: any) {
    console.error("Signed URL error:", error);
    res.status(500).json({ error: error.message || "Failed to generate signed URL" });
  }
});

export default router;
