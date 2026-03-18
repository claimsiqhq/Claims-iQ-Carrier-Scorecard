import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "./middlewares/authMiddleware";
import { auditLog } from "./middlewares/auditLog";
import { requestMetrics } from "./middlewares/requestMetrics";
import logger from "./lib/logger";
import router from "./routes";

const app: Express = express();

app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  credentials: true,
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
}));

app.use(cookieParser());

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

app.use(generalLimiter);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use(authMiddleware);
app.use(requestMetrics);
app.use(auditLog);

app.use((req: Request, res: Response, next: NextFunction) => {
  if (["POST", "PUT", "DELETE"].includes(req.method) && !req.path.includes("/auth/login") && !req.path.includes("/auth/logout")) {
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    if (origin || referer) {
      const host = req.headers.host;
      const requestOrigin = origin || (referer ? new URL(referer).origin : "");
      if (host && requestOrigin && !requestOrigin.includes(host.split(":")[0])) {
        logger.warn({ origin: requestOrigin, host }, "CSRF: Origin mismatch — blocked");
        res.status(403).json({ error: "Forbidden: origin mismatch" });
        return;
      }
    }
  }
  next();
});

app.use("/api", router);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err: err.message }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
