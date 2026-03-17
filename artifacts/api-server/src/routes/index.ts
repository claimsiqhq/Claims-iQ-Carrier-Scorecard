import { Router, type IRouter } from "express";
import healthRouter from "./health";
import claimsRouter from "./claims";

const router: IRouter = Router();

router.use(healthRouter);
router.use(claimsRouter);

export default router;
