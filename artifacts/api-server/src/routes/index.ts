import { Router, type IRouter } from "express";
import healthRouter from "./health";
import claimsRouter from "./claims";
import auditRouter from "./audit";

const router: IRouter = Router();

router.use(healthRouter);
router.use(claimsRouter);
router.use(auditRouter);

export default router;
