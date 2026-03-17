import { Router, type IRouter } from "express";
import healthRouter from "./health";
import claimsRouter from "./claims";
import auditRouter from "./audit";
import settingsRouter from "./settings";
import emailRouter from "./email";

const router: IRouter = Router();

router.use(healthRouter);
router.use(claimsRouter);
router.use(auditRouter);
router.use(settingsRouter);
router.use(emailRouter);

export default router;
