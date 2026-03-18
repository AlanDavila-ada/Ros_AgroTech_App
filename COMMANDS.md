# AgroTech — Quick Commands

## React App

```bash
cd ~/Desktop/Adalabs/AgroTach/ros2-react-app
npm install
npm start
```

App opens at `http://localhost:3000`.

---

## ROS2 Simulator

### Build

```bash
cd ~/Desktop/Adalabs/AgroTach
colcon build --packages-select agrotech_sim
source install/setup.bash
```

### Run Individual Nodes

```bash
# IMU Simulator (20Hz → /imu/data)
ros2 run agrotech_sim imu_sim

# Fisheye Stereo Simulator (15Hz → /camera/fisheye_left/*, /camera/fisheye_right/*)
ros2 run agrotech_sim fisheye_sim

# ZED Camera Simulator (15Hz → /zed/zed_node/*)
ros2 run agrotech_sim zed_sim

# Wheel Odometry Simulator (20Hz → /wheel/odometry + TF odom→base_link)
ros2 run agrotech_sim wheel_odom_sim

# Rosbridge WebSocket Server
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

### Run Everything (All Simulators + Rosbridge)

```bash
ros2 launch agrotech_sim sim_launch.py
```

---

## Startup Order

1. Launch all simulators + rosbridge: `ros2 launch agrotech_sim sim_launch.py`
2. Start React app: `npm start`

---

## Useful Debug Commands

```bash
# List active topics
ros2 topic list

# Monitor specific topics
ros2 topic echo /imu/data
ros2 topic echo /wheel/odometry
ros2 topic echo /zed/zed_node/rgb/camera_info
ros2 topic echo /camera/fisheye_left/camera_info

# Check publish rate
ros2 topic hz /imu/data
ros2 topic hz /wheel/odometry
ros2 topic hz /camera/fisheye_left/image_raw/compressed
ros2 topic hz /zed/zed_node/rgb/image_rect_color

# List running nodes
ros2 node list

# Check TF tree
ros2 run tf2_tools view_frames
```
