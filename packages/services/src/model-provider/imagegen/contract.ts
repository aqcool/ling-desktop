import { z } from "zod";

export const maxImagegenInputBytes = 15 * 1024 * 1024;
export const imagegenRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(32_000),
  transparentBackground: z.boolean().optional(),
  image: z
    .string()
    .max(Math.ceil(maxImagegenInputBytes / 3) * 4 + 32)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
    .optional(),
  turnId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
});

export interface ImagegenBridge {
  environment(): Promise<string>;
  dispose(): void;
}
