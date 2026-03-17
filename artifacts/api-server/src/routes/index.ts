import { Router, type IRouter } from "express";
import healthRouter from "./health";
import claimsRouter from "./claims";
import auditRouter from "./audit";
import settingsRouter from "./settings";
import emailRouter from "./email";
import storageRouter from "./storage";
import documentsRouter from "./documents";
import ingestRouter from "./ingest";

const router: IRouter = Router();

router.use(healthRouter);
router.use(claimsRouter);
router.use(auditRouter);
router.use(settingsRouter);
router.use(emailRouter);
router.use(storageRouter);
router.use(documentsRouter);
router.use(ingestRouter);

export default router;
