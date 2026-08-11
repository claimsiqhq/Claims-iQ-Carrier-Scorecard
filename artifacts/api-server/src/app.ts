import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "./middlewares/authMiddleware";
import { databaseContextMiddleware } from "./middlewares/databaseContext";
import { organizationContextMiddleware } from "./middlewares/organizationContext";
import { auditLog } from "./middlewares/auditLog";
import { requestMetrics } from "./middlewares/requestMetrics";
import logger from "./lib/logger";
import router from "./routes";
import emailInboundRouter from "./routes/emailInbound";
import { env } from "./env";

const app: Express = express();

app.set("trust proxy", 1);

const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isAllowedOrigin(req: Request, rawOrigin: string): boolean {
  try {
    const origin = new URL(rawOrigin).origin.replace(/\/$/, "");
    const requestOrigin = `${req.protocol}://${req.get("host")}`.replace(/\/$/, "");
    return origin === requestOrigin || env.ALLOWED_ORIGINS.includes(origin);
  } catch {
    return false;
  }
}

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const refererOrigin = (() => {
    try {
      return req.headers.referer ? new URL(req.headers.referer).origin : undefined;
    } catch {
      return undefined;
    }
  })();
  const presentedOrigin = origin || refererOrigin;

  if (
    mutatingMethods.has(req.method)
    && presentedOrigin
    && !isAllowedOrigin(req, presentedOrigin)
  ) {
    const requestOrigin = `${req.protocol}://${req.get("host")}`.replace(/\/$/, "");
    logger.warn(
      {
        method: req.method,
        path: req.path,
        presentedOrigin,
        requestOrigin,
        allowedOrigins: env.ALLOWED_ORIGINS,
      },
      "Blocked cross-origin state change",
    );
    res.status(403).json({ error: "Forbidden: origin mismatch" });
    return;
  }
  next();
});

app.use((req, res, next) => {
  cors({
    credentials: true,
    origin: (origin, callback) => {
      callback(null, !origin || isAllowedOrigin(req, origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })(req, res, next);
});

app.use(cookieParser());

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

app.use(generalLimiter);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "256kb" }));

app.use(databaseContextMiddleware);
app.use(authMiddleware);
app.use(organizationContextMiddleware);
app.use(requestMetrics);
app.use(auditLog);
app.use(emailInboundRouter);

app.use("/api", router);

app.use((
  err: Error & { code?: string; status?: number },
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  logger.error(
    { errorName: err.name, errorCode: err.code },
    "Unhandled error",
  );
  if (err.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "Uploaded file exceeds the size limit" });
    return;
  }
  if (err.status === 413) {
    res.status(413).json({ error: "Request body exceeds the size limit" });
    return;
  }
  res.status(500).json({ error: "Internal server error" });
});

export default app;
