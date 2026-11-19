---
name: imagegen
description: Generate or edit bitmap images for this workspace using the ChatGPT subscription. Use for photos, illustrations, design concepts, textures, and transparent-background assets.
---

# Image generation

Use the Image Gen MCP tools when the user asks to generate or edit a bitmap.

- Use `mcp__plugin_imagegen_imagegen__generate` for a new image. For several distinct images, make one call per image.
- Use `mcp__plugin_imagegen_imagegen__edit` with the path of a PNG, JPEG, or WebP file in the workspace. Specify which parts should change and which details to preserve. For a second pass, use the previous result's path.
- Pass `transparentBackground: true` when the user asks for a transparent background.
- Keep the prompt specific about purpose, subject, composition, lighting, and text that must appear verbatim. See [prompting.md](references/prompting.md) and [sample-prompts.md](references/sample-prompts.md).
- The tool saves a new PNG in the workspace. Include the returned Markdown preview and the saved path in your reply. When the user asks for a destination or a project asset, copy the chosen PNG there. Preserve existing assets unless replacement is requested.
- If the tool reports a sign-in or quota error, relay the error to the user. An image generation request uses the signed-in ChatGPT subscription.
