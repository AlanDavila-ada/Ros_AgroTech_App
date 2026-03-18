# 🌿 AgroTech — Setup Guide

## Prerequisites

### Local Workstation (Ubuntu 22.04)

| Requirement | Version | Install |
|---|---|---|
| **Node.js** | 18+ | `curl -fsSL https://deb.nodesource.com/setup_18.x \| sudo -E bash - && sudo apt install -y nodejs` |
| **ROS2 Humble** | Humble Hawksbill | [docs.ros.org/en/humble/Installation](https://docs.ros.org/en/humble/Installation/Ubuntu-Install-Debians.html) |
| **rosbridge_suite** | — | `sudo apt install ros-humble-rosbridge-suite` |
| **Python 3.10+** | 3.10 | Comes with Ubuntu 22.04 |
| **sshpass** | — | `sudo apt install sshpass` (optional, for CLI SSH) |

### Jetson Nano (remote)

| Requirement | Notes |
|---|---|
| **JetPack** | With CUDA Toolkit |
| **ROS2 Humble** | Installed at `/opt/ros/humble/` |
| **rosbridge_suite** | `sudo apt install ros-humble-rosbridge-suite` |
| **Python packages** | `opencv-python`, `numpy`, `pyyaml`, `mcap`, `mcap-ros2-support` |
| **CSI Cameras** | 2x IMX477 connected before boot (no hot-plug) |

Install Python deps on Jetson:
```bash
pip3 install mcap mcap-ros2-support pyyaml
```

### Jetson Scripts

These scripts must exist on the Jetson at `~/`:

| File | Purpose |
|---|---|
| `camera_undistort_node.py` | Dual CSI capture → raw + undistorted CompressedImage |
| `calibrate_headless.py` | Headless ChArUco intrinsic calibration with profile management |
| `mcap_recorder.py` | Generic MCAP recorder (any ROS2 message type) |
| `mcap_player.py` | MCAP playback with speed control |

---

## Quick Start

### 1. Clone & install

```bash
git clone <repo-url> AgroTach
cd AgroTach

# React app
cd ros2-react-app
npm install
cd ..
```

### 2. Configure Jetson connection

Edit `ros2-react-app/src/App.js` line 8:
```js
const [jetsonHost, setJetsonHost] = useState('YOUR_JETSON_IP');
```

Or change it in the Sidebar at runtime.

### 3. Run simulators (optional, for local testing without Jetson)

```bash
# Terminal 1
cd AgroTach
colcon build --packages-select agrotech_sim
source install/setup.bash
ros2 launch agrotech_sim sim_launch.py
```

### 4. Run the app

```bash
# Terminal 2
cd AgroTach/ros2-react-app
npm start
```

This starts:
- **React app** on `http://localhost:3000`
- **SSH bridge** on `http://localhost:4500`

### 5. Jetson Setup (in the app)

1. Go to **📡 Jetson** → **⚙ Setup**
2. Step 1: Start rosbridge on Jetson
3. Step 2: Wait for WebSocket connection
4. Step 3: Select or create a calibration profile
5. Step 4: Start camera node

---

## Network Requirements

| Connection | Port | Protocol |
|---|---|---|
| Local rosbridge | 9090 | WebSocket |
| Jetson rosbridge | 9090 | WebSocket |
| SSH bridge → Jetson | 22 | SSH/SFTP |
| React app | 3000 | HTTP |
| SSH bridge API | 4500 | HTTP |

The workstation and Jetson must be on the same network.

---

## S3 Upload (optional)

Go to **📡 Jetson** → **☁️ Upload** and enter:
- AWS S3 Bucket name
- Region (e.g. `us-east-1`)
- Access Key ID & Secret Access Key
- Optional prefix (e.g. `recordings/`)

Upload reads files from the Jetson via SFTP and pushes to S3 from the workstation.

---

## Project Structure

```
AgroTach/
├── ros2-react-app/          # React frontend + SSH bridge
│   ├── src/
│   │   ├── App.js           # Main app — Local/Jetson routing
│   │   ├── hooks/useRos.js  # roslib WebSocket hook
│   │   └── components/      # All UI components
│   ├── ssh-bridge.js        # Express-less HTTP server for SSH (:4500)
│   └── package.json
├── agrotech_sim/            # ROS2 sensor simulator package
│   ├── agrotech_sim/        # Python nodes (IMU, cameras, odom)
│   └── launch/sim_launch.py
├── COMMANDS.md              # Quick reference
└── SETUP.md                 # This file
```
