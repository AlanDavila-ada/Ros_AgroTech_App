# 🌿 AgroTech — ROS2 Monitoring & Recording Platform

Multi-device monitoring, recording, and data management platform for agricultural robotics. Built with React + ROS2, designed to operate across a local workstation and a remote Jetson Nano over SSH/WebSocket.

> **Adalabs × Orza Tech**

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  React App (localhost:3000)                              │
│  ┌──────────┐  ┌──────────────────────────────────────┐ │
│  │ Sidebar   │  │ Content Area                         │ │
│  │           │  │                                      │ │
│  │ 💻 Local  │  │  Local: Monitor / Sensors / Publish  │ │
│  │ 📡 Jetson │  │  Jetson: Setup │ Record │ Recordings │ │
│  │           │  │          Monitor │ Upload             │ │
│  └──────────┘  └──────────────────────────────────────┘ │
└────────┬──────────────────────────┬─────────────────────┘
         │ ws://localhost:9090      │ SSH bridge (:4500)
         ▼                          ▼
   ┌──────────┐              ┌──────────────┐
   │ Local    │              │ Jetson Nano  │
   │ rosbridge│              │ 192.168.x.x  │
   │ + sims   │              │ rosbridge    │
   └──────────┘              │ cameras      │
                             │ mcap_recorder│
                             └──────────────┘
```

---

## Views

### 💻 Local View

The local workstation interface for monitoring and interacting with ROS2 topics.

| Tab | Description |
|-----|-------------|
| **Sensors** | Real-time status of IMU, cameras, ZED, odometry. Auto-detects activity with 3s timeout |
| **Processing** | SLAM, mapping, localization, path planning pipeline status |
| **Publish** | Manual topic publisher with quick-select from available topics |

- Recording control with `patrol_id` / `recording_id` metadata
- Publishes start/stop commands to `/recording/command`
- Overwrite detection for existing recordings
- All topic lists are editable and persist in localStorage

### 📡 Jetson View

Remote Jetson Nano interface with 5 sub-tabs:

| Tab | Description |
|-----|-------------|
| **⚙ Setup** | 4-step guided setup: rosbridge → connect → calibration profile → camera node |
| **🔴 Recording** | MCAP recording with selectable topics (checkbox per topic, add custom topics) |
| **🎬 Recordings** | Browse, inspect, and playback recordings stored on the Jetson |
| **📊 Monitor** | Live topic list with Hz rate monitoring |
| **☁️ Upload** | Cloud upload (placeholder — coming soon) |

- Collapsible camera preview strip (raw + undistorted) available on any tab
- Intrinsic calibration panel integrated in Setup

---

## Jetson Camera Pipeline

Dual IMX477 CSI cameras captured via GStreamer with hardware acceleration:

```
nvarguscamerasrc → NVMM (NV12) → nvvidconv → BGRx (960×540) → appsink
                                                    │
                                        ┌───────────┴───────────┐
                                        ▼                       ▼
                                   cv2.imencode            cv2.remap
                                   (raw JPEG)          + cv2.imencode
                                        │              (undistorted JPEG)
                                        ▼                       ▼
                              /jetson/camX/image_raw   /jetson/camX/image_undistorted
                                    /compressed              /compressed
```

- Each camera runs in its own thread (parallel processing)
- Scaling done in hardware via `nvvidconv` (1920×1080 → 960×540)
- ~22 FPS per camera (vs ~5 FPS in the original CPU-only pipeline)

---

## Recording Format

All recordings use **MCAP** (`.mcap` files), the standard format for ROS2 data logging.

- Supports any ROS2 message type (CompressedImage, IMU, Odometry, PointCloud2, etc.)
- Preserves timestamps for synchronized playback
- Compatible with [Foxglove Studio](https://foxglove.dev/) for visualization
- One file per topic per camera, organized by patrol/recording ID

```
/AgroTech_recordings/
  └── {patrol_id}/
      └── {recording_id}/
          ├── metadata.json
          ├── raw/
          │   ├── cam0.mcap
          │   └── cam1.mcap
          └── processed/
              ├── cam0.mcap
              └── cam1.mcap
```

---

## Project Structure

```
AgroTach/
├── ros2-react-app/                 # React frontend
│   ├── src/
│   │   ├── App.js                  # Main app — Local/Jetson routing
│   │   ├── hooks/
│   │   │   └── useRos.js           # roslib WebSocket hook
│   │   └── components/
│   │       ├── Sidebar.js           # Navigation + connection status
│   │       ├── LocalView.js         # Local: sensors, processing, publish
│   │       ├── JetsonView.js        # Jetson: sub-tab router + camera preview
│   │       ├── JetsonSetup.js       # 4-step setup wizard
│   │       ├── JetsonRecording.js   # Topic selector + MCAP recording controls
│   │       ├── JetsonMonitor.js     # Live topic Hz monitor
│   │       ├── JetsonUpload.js      # Cloud upload placeholder
│   │       ├── RecordingsView.js    # Browse & playback recordings
│   │       ├── CalibrationPanel.js  # Camera intrinsic calibration
│   │       ├── Dashboard.js         # Generic topic dashboard
│   │       └── TopicCard.js         # Real-time message card
│   ├── ssh-bridge.js               # Express server for SSH commands (:4500)
│   └── package.json
│
├── agrotech_sim/                   # ROS2 sensor simulator package
│   ├── agrotech_sim/
│   │   ├── imu_sim.py              # IMU @ 20Hz
│   │   ├── fisheye_sim.py          # Stereo fisheye @ 15Hz
│   │   ├── zed_sim.py              # ZED RGB + depth + pointcloud @ 15Hz
│   │   ├── wheel_odom_sim.py       # Wheel odometry + TF @ 20Hz
│   │   ├── recorder.py             # Local CSV recorder node
│   │   └── jetson_recorder.py      # Jetson CSV recorder node
│   └── launch/
│       └── sim_launch.py           # Launch all sims + rosbridge
│
└── COMMANDS.md                     # Quick reference commands
```

### Jetson-side scripts (on the Nano at `~/`)

| File | Purpose |
|------|---------|
| `camera_undistort_node.py` | Dual CSI capture → raw + undistorted CompressedImage (HW accelerated) |
| `mcap_recorder.py` | MCAP recording triggered from the React app |
| `mcap_player.py` | MCAP playback with speed control |
| `jetson_node_controller.py` | Start/stop camera node via ROS2 commands |
| `calibrate_headless.py` | Headless intrinsic calibration |
| `v4l2_Multicamera/` | Custom multi-camera ROS2 package (C++ node + launch files) |

---

## Quick Start

### 1. Local development (simulator mode)

```bash
# Terminal 1 — ROS2 simulators + rosbridge
cd ~/Desktop/Adalabs/AgroTach
colcon build --packages-select agrotech_sim
source install/setup.bash
ros2 launch agrotech_sim sim_launch.py

# Terminal 2 — React app + SSH bridge
cd ~/Desktop/Adalabs/AgroTach/ros2-react-app
npm install
npm start
```

App opens at `http://localhost:3000`.

### 2. Jetson connection

1. Open the app → click **📡 Jetson** in the sidebar
2. Enter the Jetson IP in the connection panel
3. Follow the 4-step Setup: rosbridge → connect → calibration → camera node
4. Switch to **🔴 Recording** tab to start capturing data

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, roslib.js |
| ROS bridge | rosbridge_suite (WebSocket) |
| SSH bridge | Node.js + ssh2 (Express on :4500) |
| Camera pipeline | GStreamer + nvarguscamerasrc + nvvidconv |
| Recording | MCAP (mcap_ros2) |
| Jetson | NVIDIA Jetson Nano, JetPack, CUDA Toolkit 12.6 |
| ROS2 | Humble Hawksbill |

---

## Simulated Topics (Local)

| Topic | Type | Rate |
|-------|------|------|
| `/imu/data` | `sensor_msgs/Imu` | 20 Hz |
| `/camera/fisheye_left/image_raw/compressed` | `sensor_msgs/CompressedImage` | 15 Hz |
| `/camera/fisheye_right/image_raw/compressed` | `sensor_msgs/CompressedImage` | 15 Hz |
| `/zed/zed_node/rgb/image_rect_color` | `sensor_msgs/Image` | 15 Hz |
| `/zed/zed_node/depth/depth_registered` | `sensor_msgs/Image` | 15 Hz |
| `/zed/zed_node/point_cloud/cloud_registered` | `sensor_msgs/PointCloud2` | 15 Hz |
| `/wheel/odometry` | `nav_msgs/Odometry` | 20 Hz |

## Jetson Topics (Live)

| Topic | Type | Rate |
|-------|------|------|
| `/jetson/cam0/image_raw/compressed` | `sensor_msgs/CompressedImage` | ~22 Hz |
| `/jetson/cam0/image_undistorted/compressed` | `sensor_msgs/CompressedImage` | ~22 Hz |
| `/jetson/cam1/image_raw/compressed` | `sensor_msgs/CompressedImage` | ~22 Hz |
| `/jetson/cam1/image_undistorted/compressed` | `sensor_msgs/CompressedImage` | ~22 Hz |
