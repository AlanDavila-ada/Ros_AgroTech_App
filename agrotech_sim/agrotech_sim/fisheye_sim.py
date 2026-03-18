import rclpy
from rclpy.node import Node
from sensor_msgs.msg import CompressedImage, CameraInfo
import struct
import math
import random


class FisheyeSimNode(Node):
    """Publishes simulated fisheye stereo camera data (left + right)."""

    CAMERAS = [
        ('fisheye_left', '/camera/fisheye_left'),
        ('fisheye_right', '/camera/fisheye_right'),
    ]
    WIDTH, HEIGHT = 848, 800
    FPS = 15

    def __init__(self):
        super().__init__('fisheye_sim')
        self.pubs = {}
        self.info_pubs = {}
        for name, ns in self.CAMERAS:
            self.pubs[name] = self.create_publisher(
                CompressedImage, f'{ns}/image_raw/compressed', 10)
            self.info_pubs[name] = self.create_publisher(
                CameraInfo, f'{ns}/camera_info', 10)
        self.timer = self.create_timer(1.0 / self.FPS, self.publish)
        self.seq = 0
        self.get_logger().info(
            f'Fisheye stereo simulator started — {self.FPS}Hz, {self.WIDTH}x{self.HEIGHT}')

    def _make_camera_info(self, frame_id, stamp):
        ci = CameraInfo()
        ci.header.stamp = stamp
        ci.header.frame_id = frame_id
        ci.width = self.WIDTH
        ci.height = self.HEIGHT
        ci.distortion_model = 'equidistant'
        ci.d = [0.12, -0.03, 0.005, -0.001]
        fx = fy = 285.0
        cx, cy = self.WIDTH / 2.0, self.HEIGHT / 2.0
        ci.k = [fx, 0.0, cx, 0.0, fy, cy, 0.0, 0.0, 1.0]
        ci.r = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
        ci.p = [fx, 0.0, cx, 0.0, 0.0, fy, cy, 0.0, 0.0, 0.0, 1.0, 0.0]
        return ci

    def _make_fake_jpeg(self):
        # Minimal valid JPEG (SOI + APP0 + random payload + EOI)
        payload = struct.pack('B', random.randint(0, 255)) * 64
        return b'\xff\xd8\xff\xe0' + payload + b'\xff\xd9'

    def publish(self):
        stamp = self.get_clock().now().to_msg()
        for name, ns in self.CAMERAS:
            img = CompressedImage()
            img.header.stamp = stamp
            img.header.frame_id = f'{name}_optical_frame'
            img.format = 'jpeg'
            img.data = self._make_fake_jpeg()
            self.pubs[name].publish(img)
            self.info_pubs[name].publish(
                self._make_camera_info(f'{name}_optical_frame', stamp))
        self.seq += 1


def main(args=None):
    rclpy.init(args=args)
    node = FisheyeSimNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
