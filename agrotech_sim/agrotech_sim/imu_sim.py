import math
import random
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Imu
from builtin_interfaces.msg import Time


class ImuSimNode(Node):
    """Publishes simulated IMU data mimicking a real sensor on a moving robot."""

    def __init__(self):
        super().__init__('imu_sim')
        self.pub = self.create_publisher(Imu, '/imu/data', 10)
        self.timer = self.create_timer(0.05, self.publish_imu)  # 20 Hz
        self.t = 0.0
        self.get_logger().info('IMU simulator started — publishing to /imu/data at 20Hz')

    def publish_imu(self):
        msg = Imu()
        now = self.get_clock().now().to_msg()
        msg.header.stamp = now
        msg.header.frame_id = 'imu_link'

        # Simulate gentle oscillation + noise (robot driving on terrain)
        msg.orientation.x = 0.0
        msg.orientation.y = math.sin(self.t * 0.3) * 0.02
        msg.orientation.z = 0.0
        msg.orientation.w = 1.0

        msg.angular_velocity.x = random.gauss(0.0, 0.01)
        msg.angular_velocity.y = random.gauss(0.0, 0.01)
        msg.angular_velocity.z = math.sin(self.t * 0.5) * 0.05 + random.gauss(0.0, 0.005)

        msg.linear_acceleration.x = random.gauss(0.0, 0.1)
        msg.linear_acceleration.y = random.gauss(0.0, 0.1)
        msg.linear_acceleration.z = 9.81 + random.gauss(0.0, 0.05)

        # Covariance: -1 means unknown
        msg.orientation_covariance[0] = -1.0
        msg.angular_velocity_covariance[0] = -1.0
        msg.linear_acceleration_covariance[0] = -1.0

        self.pub.publish(msg)
        self.t += 0.05


def main(args=None):
    rclpy.init(args=args)
    node = ImuSimNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
