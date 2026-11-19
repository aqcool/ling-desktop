import { imagegenRequestSchema } from "./contract.js";

export const imagegenExample = imagegenRequestSchema.parse({
  prompt: "A small blue ceramic vase, isolated on a transparent background.",
  transparentBackground: true,
});
