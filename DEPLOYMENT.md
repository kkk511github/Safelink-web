# Vochat Web

The production bundle is served at `https://www.vochat.im/web/`. The apex domain
`vochat.im` can use the same site. The default MTProto endpoint is the same
origin's `/apiws`; discovery stays at `/.well-known/safelink-client.json`.
The existing pinned RSA key and primary account storage namespace are retained.

## Build

Use the Node version and pnpm version declared in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm build
```

Deploy the contents of `dist/` under `/web/`, rather than the historical compiled
files in `public/`. Redirect the exact `/web` path to `/web/`. Keep `/apiws`
WebSocket forwarding and discovery at the origin root. Serve `.wasm` as
`application/wasm`, `.webmanifest` as `application/manifest+json` and JavaScript
as JavaScript; missing assets must return 404 rather than the site's HTML page.

`VITE_WEB_BASE_PATH` can override the build prefix (include leading and trailing
slashes). The production default is `/web/`; development defaults to `/`.
`VITE_MTPROTO_WS_URL` can override the endpoint for another deployment. Custom
server profiles, display names and server-provided public link prefixes remain
supported. Changing a domain does not copy browser storage across origins.

Run the production smoke check after building:

```sh
node scripts/test-vochat-deployment.cjs
```

The check uses a local static server, mocks discovery with the pinned public
key, closes WebSocket connections, and does not send codes or create accounts.

The product image is the approved frameless master in
`public/assets/img/vochat.png`. It is used unchanged by the login page, QR codes,
favicons and installation manifests. Third-party licensing remains in `LICENSE`
and the dependency acknowledgements in `README.md`.
