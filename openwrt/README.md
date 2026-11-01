# Packaging UnTangled for OpenWRT

UnTangled ships as a prebuilt static SPA served by `uhttpd`, talking to `ubus`/`rpcd`.
Two packages are built from one source:

| Package | What it adds | Typical new bytes on disk* |
|---|---|---|
| **`untangled`** | Core: serve the UI + `/ubus`, session auth, file ops. **HTTP only.** | ~65 KB app + ~75 KB deps (if not already present) |
| **`untangled-full`** | Core **+** Wi-Fi scan, firmware/backup, **HTTPS (TLS)** | + up to ~300 KB (often ~0 — mbedtls is usually already on Wi-Fi images) |

\* Installed (uncompressed) sizes. Real flash use is lower: the overlay
(JFFS2/UBIFS) and SquashFS compress files, so the plain ~200 KB of app assets
occupy ~65 KB on flash. Don't pre-gzip into the package — stock uhttpd won't
serve precompressed files and the filesystem already compresses them.

## 1. Build the SPA

```sh
npm install
npm run build                 # -> dist/   (ship these plain files)
# optional, only for an nginx front-end with gzip_static:
npm run build:gz              # also writes dist/**/*.gz
```

## 2. Stage files for the package

```sh
mkdir -p openwrt/files/www/untangled
cp -r dist/* openwrt/files/www/untangled/     # plain assets; skip *.gz for apk/ipk
```

`openwrt/files/` also contains:
- `usr/share/rpcd/acl.d/untangled.json` — ACL groups `untangled` (full) and `untangled-readonly`.
- `etc/uci-defaults/90-untangled` — sets uhttpd's `/ubus` prefix on first boot.

## 3. Build the packages (OpenWRT SDK or buildroot)

Copy the `openwrt/` folder as `package/untangled` in an OpenWRT tree (or SDK), then:

```sh
make package/untangled/compile V=s      # builds both untangled and untangled-full
```

Produces `untangled_*.{ipk|apk}` (core) and `untangled-full_*.{ipk|apk}` (meta).
- **23.05 and earlier** use `.ipk` (opkg).
- **24.10+** use `.apk`.
Same files, different archive format — installed size is identical.

## 4. Install

```sh
# minimal, HTTP-only:
opkg install untangled           # or: apk add untangled
# full feature set (HTTPS, Wi-Fi scan, firmware/backup):
opkg install untangled-full      # or: apk add untangled-full
```

HTTP-only is the default. For HTTPS, install `untangled-full` (or just
`libustream-mbedtls` + `px5g-mbedtls`) and point a uhttpd listener at the cert.

## 5. Grant a login the ACL group

In `/etc/config/rpcd`, give the admin login the `untangled` groups:

```
config login
    option username 'root'
    option password '$p$root'    # reads the hash from /etc/shadow
    list read  'untangled'
    list write 'untangled'
```

Then `/etc/init.d/rpcd restart`.

## Coexisting with LuCI

Both read the same UCI config, so UnTangled installs safely alongside LuCI. Serve
UnTangled at `/untangled/` (or make it the default document root) and keep LuCI at
`/cgi-bin/luci` as a fallback while UnTangled matures.

## Dev against a real router

```sh
ROUTER=192.168.1.1 npm run dev
```

Vite proxies `/ubus` to `https://$ROUTER` (self-signed cert accepted), so the dev
server drives the live router.
