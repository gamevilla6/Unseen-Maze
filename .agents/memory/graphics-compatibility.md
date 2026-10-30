---
name: Graphics compatibility
description: Reason for retaining both the preferred Three.js renderer and a labeled compatibility renderer.
---

Keep Three.js 3D as the preferred experience and preserve a genuinely playable, clearly labeled compatibility mode on browsers without WebGL2.

**Why:** The preview capture browser failed to create any WebGL context, and the initial renderer exception replaced the whole application with a generic error screen. The fallback exists for real capability failures, not to disguise incomplete 3D work.

**How to apply:** Do not remove compatibility handling during scene changes. A successful fallback screenshot does not verify the 3D rendering; disclose that distinction when relevant.
