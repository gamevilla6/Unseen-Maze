---
name: Static hosting portability
description: Why the game must stay independently deployable to GitHub Pages without Replit runtime services.
---

Verify deployment output through a strict static server under a repository
prefix, not just through the development preview.

**Why:** A development server can compile TypeScript and rewrite missing paths
to HTML, hiding the module-loading and MIME failures that occur on GitHub Pages.

**How to apply:** Test the compiled game, response MIME types and asset requests
at a non-root path. A successful dev preview alone cannot prove Pages
compatibility. Keep source HTML distinct from deployable compiled HTML.
