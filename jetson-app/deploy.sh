#!/bin/bash
# Deploy AgroTech app to Jetson
# Usage: ./deploy.sh [jetson_ip]
set -e

JETSON=${1:-192.168.15.173}
USER=ada
PASS=ada123
DEST=/home/ada/Ros_AgroTech_App

echo "=== Building React app ==="
npm run build

echo "=== Deploying to $USER@$JETSON:$DEST ==="
sshpass -p "$PASS" ssh -o StrictHostKeyChecking=no $USER@$JETSON "mkdir -p $DEST"
sshpass -p "$PASS" scp -o StrictHostKeyChecking=no -r build/ $USER@$JETSON:$DEST/
sshpass -p "$PASS" scp -o StrictHostKeyChecking=no server.js package.json $USER@$JETSON:$DEST/

echo "=== Installing dependencies on Jetson ==="
sshpass -p "$PASS" ssh -o StrictHostKeyChecking=no $USER@$JETSON "cd $DEST && npm install --production 2>&1 | tail -3"

echo "=== Done! ==="
echo "On the Jetson, run:"
echo "  cd $DEST && node server.js"
echo "Then open http://$JETSON:4500 from any browser on the network"
