import { logger } from "./logger.js";
import { initializeCrashCapture, type CrashCapturePaths } from "./desktopCrashCapture.js";

export const crashCapturePaths: CrashCapturePaths = initializeCrashCapture(logger);
