#!/usr/bin/env bash
# Disposable local validation guest only. This does not replace the production bootstrap.
set -Eeuo pipefail
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || exit 2
. /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 22.04 ]] || exit 2
validation_input=${1:?Pass the copied validation input directory}
[[ $validation_input == /* && -d $validation_input/ops/config ]] || exit 2
validation_downloads="$validation_input/downloads"
mkdir -p "$validation_downloads"
cd "$validation_downloads"
curl --fail --location --retry 3 --max-time 600 https://nodejs.org/dist/v24.20.0/SHASUMS256.txt -o node-SHASUMS256.txt
curl --fail --location --retry 3 --max-time 600 https://nodejs.org/dist/v24.20.0/node-v24.20.0-linux-x64.tar.xz -o node-v24.20.0-linux-x64.tar.xz
python3 - "$validation_input" <<'PY'
import hashlib,pathlib,sys
policy=dict(line.split('=',1) for line in (pathlib.Path(sys.argv[1])/'ops/config/approved-node-runtime.conf').read_text().splitlines() if line and not line.startswith('#'))
archive=pathlib.Path('node-v24.20.0-linux-x64.tar.xz')
official=[line.split()[0] for line in pathlib.Path('node-SHASUMS256.txt').read_text().splitlines() if line.split()[-1]==archive.name]
assert len(official)==1 and official[0]==policy['NODE_SHA256']==hashlib.sha256(archive.read_bytes()).hexdigest()
PY
[[ ! -e /opt/nodejs/node-v24.20.0-linux-x64 ]] || { echo 'Refusing to overwrite an existing toolchain'; exit 3; }
sudo mkdir -p /opt/nodejs
sudo tar -xJf node-v24.20.0-linux-x64.tar.xz -C /opt/nodejs
sudo ln -s /opt/nodejs/node-v24.20.0-linux-x64 /opt/nodejs/current
export PATH=/opt/nodejs/node-v24.20.0-linux-x64/bin:/usr/bin:/bin:/usr/sbin:/sbin
sudo mkdir -p /opt/nodejs/node-v24.20.0-linux-x64/lib/runtime-tools
sudo cp "$validation_input/ops/node-runtime/package.json" "$validation_input/ops/node-runtime/package-lock.json" /opt/nodejs/node-v24.20.0-linux-x64/lib/runtime-tools/
sudo env PATH="$PATH" npm ci --prefix /opt/nodejs/node-v24.20.0-linux-x64/lib/runtime-tools --ignore-scripts --no-audit --no-fund
sudo ln -s /opt/nodejs/node-v24.20.0-linux-x64/lib/runtime-tools/node_modules/pnpm/bin/pnpm.cjs /opt/nodejs/node-v24.20.0-linux-x64/bin/pnpm
sudo ln -s /opt/nodejs/node-v24.20.0-linux-x64/lib/runtime-tools/node_modules/pm2/bin/pm2 /opt/nodejs/node-v24.20.0-linux-x64/bin/pm2
sudo apt-get install -y postgresql-14=14.24-0ubuntu0.22.04.1 postgresql-client-14=14.24-0ubuntu0.22.04.1 libpq5=14.24-0ubuntu0.22.04.1 git build-essential python3-pytest jq
curl --fail --location --retry 3 --max-time 600 'https://nginx.org/packages/ubuntu/pool/nginx/n/nginx/nginx_1.30.4-1~jammy_amd64.deb' -o nginx_1.30.4-1~jammy_amd64.deb
python3 - "$validation_input" <<'PY'
import hashlib,pathlib,sys
policy=dict(line.split('=',1) for line in (pathlib.Path(sys.argv[1])/'ops/config/approved-nginx-versions.conf').read_text().splitlines() if line and not line.startswith('#'))
archive=pathlib.Path('nginx_1.30.4-1~jammy_amd64.deb')
assert hashlib.sha256(archive.read_bytes()).hexdigest()==policy['APPROVED_NGINX_PACKAGE_SHA256']
PY
sudo apt-get install -y ./nginx_1.30.4-1~jammy_amd64.deb
node --version
node /opt/nodejs/node-v24.20.0-linux-x64/lib/runtime-tools/node_modules/pnpm/bin/pnpm.mjs --version
sudo -u postgres psql -X -Atc 'SHOW server_version_num;'
dpkg-query -W -f='${Package} ${Version} ${Architecture}\n' postgresql-14 postgresql-client-14 libpq5 nginx
nginx -v
echo 'Disposable guest toolchain installed. Production bootstrap, APT-policy and release acceptance remain separate checks.'
