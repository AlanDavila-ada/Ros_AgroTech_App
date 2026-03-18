# agrotech_sim — ROS2 Sensor Simulator

Simulated sensor nodes for the AgroTech platform.

## Nodes

### imu_sim
Publishes simulated IMU data to `/imu/data` at 20Hz (`sensor_msgs/Imu`).

Simulates:
- Orientation with gentle oscillation (terrain driving)
- Angular velocity with sinusoidal yaw + noise
- Linear acceleration with gravity (9.81) + vibration noise

### fisheye_sim
Publishes simulated stereo fisheye camera data at 15Hz (848×800, modelo de distorsión `equidistant`).

Simulates:
- Left/right compressed images (`sensor_msgs/CompressedImage`)
- Camera info for each lens (`sensor_msgs/CameraInfo`)

### zed_sim
Publishes simulated ZED camera data at 15Hz (1280×720).

Simulates:
- RGB image (`sensor_msgs/Image`, `bgr8`)
- Depth image (`sensor_msgs/Image`, `32FC1`)
- Camera info (`sensor_msgs/CameraInfo`)
- Point cloud (`sensor_msgs/PointCloud2`)

### wheel_odom_sim
Publishes simulated wheel odometry at 20Hz (`nav_msgs/Odometry`).

Simulates:
- Robot moving in a curved path with gaussian noise
- TF broadcast `odom → base_link`

## Build & Run

```bash
cd ~/Desktop/Adalabs/AgroTach
colcon build --packages-select agrotech_sim
source install/setup.bash

# Run individual nodes
ros2 run agrotech_sim imu_sim
ros2 run agrotech_sim fisheye_sim
ros2 run agrotech_sim zed_sim
ros2 run agrotech_sim wheel_odom_sim

# Or launch everything (all simulators + rosbridge)
ros2 launch agrotech_sim sim_launch.py
```

## Topics Published

| Topic | Type | Rate |
|-------|------|------|
| `/imu/data` | `sensor_msgs/Imu` | 20 Hz |
| `/camera/fisheye_left/image_raw/compressed` | `sensor_msgs/CompressedImage` | 15 Hz |
| `/camera/fisheye_left/camera_info` | `sensor_msgs/CameraInfo` | 15 Hz |
| `/camera/fisheye_right/image_raw/compressed` | `sensor_msgs/CompressedImage` | 15 Hz |
| `/camera/fisheye_right/camera_info` | `sensor_msgs/CameraInfo` | 15 Hz |
| `/zed/zed_node/rgb/image_rect_color` | `sensor_msgs/Image` | 15 Hz |
| `/zed/zed_node/depth/depth_registered` | `sensor_msgs/Image` | 15 Hz |
| `/zed/zed_node/rgb/camera_info` | `sensor_msgs/CameraInfo` | 15 Hz |
| `/zed/zed_node/point_cloud/cloud_registered` | `sensor_msgs/PointCloud2` | 15 Hz |
| `/wheel/odometry` | `nav_msgs/Odometry` | 20 Hz |
