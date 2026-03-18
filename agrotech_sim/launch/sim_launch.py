from launch import LaunchDescription
from launch.actions import IncludeLaunchDescription
from launch.launch_description_sources import AnyLaunchDescriptionSource
from launch_ros.actions import Node
from ament_index_python.packages import get_package_share_directory
import os


def generate_launch_description():
    rosbridge_launch = os.path.join(
        get_package_share_directory('rosbridge_server'),
        'launch', 'rosbridge_websocket_launch.xml')

    return LaunchDescription([
        Node(
            package='agrotech_sim',
            executable='imu_sim',
            name='imu_sim',
            output='screen',
        ),
        Node(
            package='agrotech_sim',
            executable='fisheye_sim',
            name='fisheye_sim',
            output='screen',
        ),
        Node(
            package='agrotech_sim',
            executable='zed_sim',
            name='zed_sim',
            output='screen',
        ),
        Node(
            package='agrotech_sim',
            executable='wheel_odom_sim',
            name='wheel_odom_sim',
            output='screen',
        ),
        Node(
            package='agrotech_sim',
            executable='recorder',
            name='recorder',
            output='screen',
        ),
        IncludeLaunchDescription(
            AnyLaunchDescriptionSource(rosbridge_launch),
        ),
    ])
