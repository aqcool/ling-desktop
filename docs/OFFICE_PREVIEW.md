# Local Office preview

Modern workspace files (`.docx`, `.xlsx`, `.pptx`) open in the existing file pane
using Univer 1.0.3 open-source renderers. LING translates OOXML into Univer's
document models with its own adapters; no Univer Pro exchange package or license
is used. Previewing a file does not create a chat or write to the original file.

Supported in this first preview implementation:

- Word: paragraphs, common text formatting, page size/margins, ordinary tables
  and embedded inline PNG/JPEG/GIF/WebP images.
- Excel: multiple sheets, cell values and styles, stored formula results,
  dates, merged cells, row/column sizes and frozen panes. Formulas are not run.
- PowerPoint: slide navigation, authored text, basic shapes, embedded raster
  images and basic placeholder positions/text styles inherited from layouts.

This is a basic preview, not a lossless Office import/export engine. Word's
floating drawings, numbering and headers/footers, Excel charts/pivots and
PowerPoint master graphics/animations can be incomplete. The pane identifies
detected limitations. Editing, annotations, export and save-back are not exposed.

Files are read locally within the selected workspace, with a 16 MiB source
limit and a 64 MiB expanded-package limit. External document relationships are
not fetched. The new Office byte endpoint supports local tasks and selected
workspaces before the first message. SSH's separate file editor is unchanged.
Legacy `.doc`, `.xls`, `.ppt` task previews retain the existing LibreOffice/PDF
path.

Builds copy third-party license notices to `dist/licenses/office/`, which is
included with the packaged renderer. `corepack pnpm check` verifies both
workspaces; Office-specific tests cover adapter behavior, file-read boundaries,
preview cancellation and retry.
