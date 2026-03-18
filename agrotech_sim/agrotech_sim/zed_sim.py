import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image, CameraInfo, PointCloud2, PointField
from std_msgs.msg import Header
import struct
import math
import random


class ZedSimNode(Node):
    """Publishes simulated ZED camera data: RGB, depth and point cloud."""

    WIDTH, HEIGHT = 1280, 720
    FPS = 15

    def __init__(self):
        super().__init__('zed_sim')
        self.pub_rgb = self.create_publisher(
            Image, '/zed/zed_node/rgb/image_rect_color', 10)
        self.pub_depth = self.create_publisher(
            Image, '/zed/zed_node/depth/depth_registered', 10)
        self.pub_info = self.create_publisher(
            CameraInfo, '/zed/zed_node/rgb/camera_info', 10)
        self.pub_pc = self.create_publisher(
            PointCloud2, '/zed/zed_node/point_cloud/cloud_registered', 10)
        self.timer = self.create_timer(1.0 / self.FPS, self.publish)
        self.get_logger().info(
            f'ZED camera simulator started — {self.FPS}Hz, {self.WIDTH}x{self.HEIGHT}')

    def publish(self):
        stamp = self.get_clock().now().to_msg()
        hdr = Header(stamp=stamp, frame_id='zed_left_camera_optical_frame')

        # RGB image (tiny placeholder)
        rgb = Image()
        rgb.header = hdr
        rgb.width = self.WIDTH
        rgb.height = self.HEIGHT
        rgb.encoding = 'bgr8'
        rgb.step = self.WIDTH * 3
        rgb.data = bytes([random.randint(20, 60)] * 128)  # stub
        self.pub_rgb.publish(rgb)

        # Depth image (32FC1)
        depth = Image()
        depth.header = hdr
        depth.width = self.WIDTH
        depth.height = self.HEIGHT
        depth.encoding = '32FC1'
        depth.step = self.WIDTH * 4
        depth.data = struct.pack('f', random.uniform(0.5, 5.0)) * 32
        self.pub_depth.publish(depth)

        # Camera info
        ci = CameraInfo()
        ci.header = hdr
        ci.width = self.WIDTH
        ci.height = self.HEIGHT
        ci.distortion_model = 'plumb_bob'
        ci.d = [0.0] * 5
        fx = fy = 700.0
        cx, cy = self.WIDTH / 2.0, self.HEIGHT / 2.0
        ci.k = [fx, 0.0, cx, 0.0, fy, cy, 0.0, 0.0, 1.0]
        ci.r = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
        ci.p = [fx, 0.0, cx, 0.0, 0.0, fy, cy, 0.0, 0.0, 0.0, 1.0, 0.0]
        self.pub_info.publish(ci)

        # Minimal PointCloud2
        pc = PointCloud2()
        pc.header = hdr
        pc.height = 1
        pc.width = 4
        pc.fields = [
            PointField(name='x', offset=0, datatype=PointField.FLOAT32, count=1),
            PointField(name='y', offset=4, datatype=PointField.FLOAT32, count=1),
            PointField(name='z', offset=8, datatype=PointField.FLOAT32, count=1),
        ]
        pc.point_step = 12
        pc.row_step = 48
        pc.is_dense = True
        pc.data = b''.join(
            struct.pack('fff',
                        random.uniform(-1, 1),
                        random.uniform(-1, 1),
                        random.uniform(0.5, 5))
            for _ in range(4))
        self.pub_pc.publish(pc)


def main(args=None):
    rclpy.init(args=args)
    node = ZedSimNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
