#!/bin/bash
# Runs INSIDE the OpenWRT SDK container (started by build-ipk.sh): build the
# untangled packages from the feed mounted at /feed into /out.
set -e
cd /builder
echo "src-link untangled /feed" >> feeds.conf.default
./scripts/feeds update untangled >/dev/null 2>&1
./scripts/feeds install -p untangled -a >/dev/null 2>&1
make defconfig >/dev/null 2>&1
make package/untangled/compile -j4 >/dev/null 2>&1 || make package/untangled/compile V=s
cp bin/packages/*/untangled/*.ipk /out/
