import math
import random
import rclpy
from rclpy.node import Node
from nav_msgs.msg import Odometry
from geometry_msgs.msg import TransformStamped
from tf2_ros import TransformBroadcaster


class WheelOdomSimNode(Node):
    """Simulates wheel odometry from robot wheel encoders."""

    def __init__(self):
        super().__init__('wheel_odom_sim')
        self.pub = self.create_publisher(Odometry, '/wheel/odometry', 10)
        self.tf_broadcaster = TransformBroadcaster(self)
        self.timer = self.create_timer(0.05, self.publish)  # 20 Hz
        self.x = 0.0
        self.y = 0.0
        self.theta = 0.0
        self.v = 0.3  # m/s linear
        self.omega = 0.05  # rad/s angular
        self.dt = 0.05
        self.get_logger().info(
            'Wheel odometry simulator started — publishing to /wheel/odometry at 20Hz')

    def publish(self):
        # Simulate gentle curved path + noise
        v = self.v + random.gauss(0, 0.01)
        w = self.omega * math.sin(self.get_clock().now().nanoseconds * 1e-9 * 0.1) \
            + random.gauss(0, 0.005)

        self.theta += w * self.dt
        self.x += v * math.cos(self.theta) * self.dt
        self.y += v * math.sin(self.theta) * self.dt

        stamp = self.get_clock().now().to_msg()

        # Odometry message
        odom = Odometry()
        odom.header.stamp = stamp
        odom.header.frame_id = 'odom'
        odom.child_frame_id = 'base_link'
        odom.pose.pose.position.x = self.x
        odom.pose.pose.position.y = self.y
        odom.pose.pose.orientation.z = math.sin(self.theta / 2.0)
        odom.pose.pose.orientation.w = math.cos(self.theta / 2.0)
        odom.twist.twist.linear.x = v
        odom.twist.twist.angular.z = w
        self.pub.publish(odom)

        # TF odom -> base_link
        t = TransformStamped()
        t.header.stamp = stamp
        t.header.frame_id = 'odom'
        t.child_frame_id = 'base_link'
        t.transform.translation.x = self.x
        t.transform.translation.y = self.y
        t.transform.rotation.z = math.sin(self.theta / 2.0)
        t.transform.rotation.w = math.cos(self.theta / 2.0)
        self.tf_broadcaster.sendTransform(t)


def main(args=None):
    rclpy.init(args=args)
    node = WheelOdomSimNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
