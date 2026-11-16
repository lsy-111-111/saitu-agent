#!/usr/bin/env bash
set -Eeuo pipefail
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = aarch64 ] || exit 2
mkdir -p "$HOME/saitu-validation/downloads" "$HOME/saitu-validation/logs"
cd "$HOME/saitu-validation/downloads"
curl --fail --location --retry 3 --max-time 600 https://nodejs.org/dist/v24.20.0/SHASUMS256.txt -o node-SHASUMS256.txt
curl --fail --location --retry 3 --max-time 600 https://nodejs.org/dist/v24.20.0/node-v24.20.0-linux-arm64.tar.xz -o node-v24.20.0-linux-arm64.tar.xz
grep ' node-v24.20.0-linux-arm64.tar.xz$' node-SHASUMS256.txt | sha256sum --check -
sudo mkdir -p /opt/nodejs
sudo tar -xJf node-v24.20.0-linux-arm64.tar.xz -C /opt/nodejs
sudo ln -sfn /opt/nodejs/node-v24.20.0-linux-arm64 /opt/nodejs/current
export PATH=/opt/nodejs/current/bin:$PATH
curl --fail --location --retry 3 --max-time 600 https://registry.npmjs.org/pnpm/-/pnpm-11.19.0.tgz -o pnpm-11.19.0.tgz
node -e 'const fs=require("fs"),c=require("crypto");if(c.createHash("sha512").update(fs.readFileSync("pnpm-11.19.0.tgz")).digest("base64")!=="eIHz7VkNRyxKlV4riLISF5ERYGbcyIy8o4SeybYPG7qm0syyIfqR2k4cZb7yvL43k2Wup6xTnHv4be3DobItzg==")throw Error("pnpm integrity mismatch")'
sudo mkdir -p /opt/nodejs/current/lib/runtime-tools/node_modules/pnpm
sudo tar -xzf pnpm-11.19.0.tgz --strip-components=1 -C /opt/nodejs/current/lib/runtime-tools/node_modules/pnpm
sudo ln -sfn /opt/nodejs/current/lib/runtime-tools/node_modules/pnpm/bin/pnpm.cjs /opt/nodejs/current/bin/pnpm
node --version
node /opt/nodejs/current/lib/runtime-tools/node_modules/pnpm/bin/pnpm.mjs --version
