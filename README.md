# Unseen Maze

A touch-only Three.js game with 99 echolocation puzzle levels. Tap to echo,
swipe and hold to move, make a short swipe for stealth, and release to stop.
Designed for Android phones and tablets in either orientation.

## Run locally

Use Node.js 22 and pnpm 10:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/acoustic-maze run dev
```

The game defaults to port 5173 outside Replit. Replit's managed preview still
uses its configured port and base path.

## Build for GitHub Pages

```sh
pnpm run build:pages
pnpm run check:pages
```

The canonical source entry is **`index.html` in the repository root**.
Vite compiles it into **`artifacts/acoustic-maze/dist/public/index.html`**,
alongside bundled JavaScript, CSS and the favicon. Upload the entire
`dist/public` directory, not the raw TypeScript source or the repository root.
No server, API keys, database, or Replit services are needed to run the game.

All built asset URLs are relative, so the same output works at a domain root,
on a custom domain, or under a project path such as `/Unseen-Maze/`.
Hash-based routing avoids server-side rewrites. Three.js and React are bundled;
optional Google Fonts load over HTTPS with local font fallbacks. Audio is
synthesized with Web Audio and starts only after a user gesture.

### Enable automatic Pages publishing

1. Push this project, including `.github/workflows/pages.yml`, to `main`.
2. In the GitHub repository, open **Settings → Pages**.
3. Set **Build and deployment → Source** to **GitHub Actions**.
4. Run **Deploy Unseen Maze to GitHub Pages** in the Actions tab, or push to
   `main`. Use the site URL shown by the successful deployment.

Do **not** select “Deploy from a branch” for this source repository: browsers
cannot run `.tsx` source directly. The workflow installs locked dependencies,
builds the game, checks asset paths and MIME types, and uploads only static
production files.

Progress and settings are saved in the current browser and origin. Saves from
the Replit preview do not automatically move to a different GitHub Pages origin.
WebGL2 is preferred; unsupported devices get a clearly labeled 2D compatibility
mode. Real-device performance depends on device capabilities and graphics quality.