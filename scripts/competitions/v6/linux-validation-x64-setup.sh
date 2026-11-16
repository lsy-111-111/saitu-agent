#!/usr/bin/env bash
# Run inside the approved local ARM Linux validation VM. No host mounts or cloud service.
set -Eeuo pipefail
[[ $(uname -s) == Linux && $(uname -m) == aarch64 ]] || exit 2
validation_dir=${1:?Pass the existing validation-only download directory}
[[ $validation_dir == /* && -d $validation_dir ]] || exit 2
cd "$validation_dir"
python3 - <<'PY'
import hashlib,pathlib
image=pathlib.Path('jammy-server-cloudimg-amd64.img')
expected=[line.split()[0] for line in pathlib.Path('SHA256SUMS').read_text().splitlines() if line.split()[-1].lstrip('*')==image.name]
assert len(expected)==1 and hashlib.sha256(image.read_bytes()).hexdigest()==expected[0]
PY
[[ ! -e x64-runtime.qcow2 && ! -e id_ed25519 && ! -e qemu.pid ]] || { echo 'Refusing to overwrite an existing VM or key'; exit 3; }
ssh-keygen -q -t ed25519 -N '' -C saitu-local-validation -f id_ed25519
python3 - <<'PY'
import pathlib
key=pathlib.Path('id_ed25519.pub').read_text().strip()
pathlib.Path('user-data').write_text('''#cloud-config
hostname: saitu-validation-x64
manage_etc_hosts: true
users:
  - name: saitu
    groups: [sudo]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: true
    ssh_authorized_keys:
      - '''+key+'''
ssh_pwauth: false
disable_root: true
package_update: false
package_upgrade: false
''')
pathlib.Path('meta-data').write_text('instance-id: saitu-local-jammy-amd64\nlocal-hostname: saitu-validation-x64\n')
PY
chmod 600 user-data meta-data
cloud-localds seed.img user-data meta-data
qemu-img create -f qcow2 -F qcow2 -b "$validation_dir/jammy-server-cloudimg-amd64.img" x64-runtime.qcow2
qemu-img resize x64-runtime.qcow2 30G
qemu-system-x86_64 -name saitu-validation-x64 -machine q35 -accel tcg,thread=multi -cpu max -smp 2 -m 3584 \
  -drive file="$validation_dir/x64-runtime.qcow2",format=qcow2,if=virtio \
  -drive file="$validation_dir/seed.img",format=raw,if=virtio \
  -netdev user,id=net0,hostfwd=tcp:127.0.0.1:55522-:22,hostfwd=tcp:127.0.0.1:55531-:3000 \
  -device virtio-net-pci,netdev=net0 -display none -serial file:"$validation_dir/serial.log" \
  -monitor unix:"$validation_dir/monitor.sock",server=on,wait=off -pidfile "$validation_dir/qemu.pid" -daemonize
echo 'Started local Ubuntu 22.04 amd64 emulation; boot and exact platform verification are still pending.'
