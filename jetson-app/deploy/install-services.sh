#!/bin/bash
# Install agrotech-{rosbridge,camera,imu}.service on the Jetson.
# Usage: ./install-services.sh [jetson_ip]
set -e

JETSON=${1:-192.168.68.108}
USER=ada
PASS=ada123
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UNIT_DIR="$SCRIPT_DIR/systemd"

UNITS=(agrotech-rosbridge.service agrotech-camera.service agrotech-imu.service)

echo "=== Copying unit files to Jetson (/tmp) ==="
for u in "${UNITS[@]}"; do
  sshpass -p "$PASS" scp -o StrictHostKeyChecking=no "$UNIT_DIR/$u" "$USER@$JETSON:/tmp/$u"
done

echo "=== Installing units (sudo on Jetson) ==="
INSTALL_CMDS=$(cat <<'EOS'
set -e
for u in agrotech-rosbridge.service agrotech-camera.service agrotech-imu.service; do
  sudo -S mv /tmp/$u /etc/systemd/system/$u
  sudo -S chmod 644 /etc/systemd/system/$u
done
sudo -S systemctl daemon-reload
sudo -S systemctl enable agrotech-rosbridge.service agrotech-camera.service agrotech-imu.service
echo "--- enabled ---"
sudo -S systemctl is-enabled agrotech-rosbridge.service agrotech-camera.service agrotech-imu.service
EOS
)
sshpass -p "$PASS" ssh -o StrictHostKeyChecking=no "$USER@$JETSON" "echo '$PASS' | $INSTALL_CMDS"

echo ""
echo "=== Done. Start now with: ==="
echo "  ssh $USER@$JETSON 'echo $PASS | sudo -S systemctl start agrotech-rosbridge agrotech-camera agrotech-imu'"
echo "Or reboot to verify cold-start."
