#!/usr/bin/env bash
set -Eeuo pipefail
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = aarch64 ] || exit 2
base="$HOME/saitu-validation"
cd "$base/downloads"
sha256sum --check postgresql-14.24.tar.bz2.sha256
gpg --homedir "$base/nginx-gnupg" --verify nginx-1.30.4.tar.gz.asc nginx-1.30.4.tar.gz
# Package installation is a separate logged job; never compile against half-installed headers.
while pgrep -x apt-get >/dev/null || ! command -v gcc >/dev/null || ! command -v make >/dev/null; do sleep 5; done
mkdir -p "$base/build"
tar -xjf postgresql-14.24.tar.bz2 -C "$base/build"
tar -xzf nginx-1.30.4.tar.gz -C "$base/build"
cd "$base/build/nginx-1.30.4"
./configure --prefix=/opt/nginx/1.30.4 --sbin-path=/usr/sbin/nginx --with-http_ssl_module --with-http_v2_module --with-http_realip_module --with-threads > "$base/logs/nginx-configure.log" 2>&1
make -j4 > "$base/logs/nginx-build.log" 2>&1
sudo make install > "$base/logs/nginx-install.log" 2>&1
/usr/sbin/nginx -v
cd "$base/build/postgresql-14.24"
./configure --prefix=/opt/postgresql/14.24 --with-openssl --with-icu > "$base/logs/postgres-configure.log" 2>&1
make -j4 > "$base/logs/postgres-build.log" 2>&1
sudo make install > "$base/logs/postgres-install.log" 2>&1
/opt/postgresql/14.24/bin/postgres --version
sudo useradd --system --home-dir /var/lib/postgresql --shell /bin/bash postgres
sudo install -d -o postgres -g postgres -m 700 /var/lib/postgresql/14.24
sudo -u postgres /opt/postgresql/14.24/bin/initdb -D /var/lib/postgresql/14.24 --encoding=UTF8 --locale=C --auth-local=peer --auth-host=scram-sha-256 --data-checksums > "$base/logs/postgres-init.log" 2>&1
sudo -u postgres /opt/postgresql/14.24/bin/pg_ctl -D /var/lib/postgresql/14.24 -l /var/lib/postgresql/14.24/server.log -o '-h 127.0.0.1 -p 5432' -w start
