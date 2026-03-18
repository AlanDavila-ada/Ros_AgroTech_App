from setuptools import setup, find_packages

setup(
    name='agrotech_sim',
    version='0.1.0',
    packages=find_packages(),
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/agrotech_sim']),
        ('share/agrotech_sim', ['package.xml']),
        ('share/agrotech_sim/launch', ['launch/sim_launch.py']),
    ],
    entry_points={
        'console_scripts': [
            'imu_sim = agrotech_sim.imu_sim:main',
            'fisheye_sim = agrotech_sim.fisheye_sim:main',
            'zed_sim = agrotech_sim.zed_sim:main',
            'wheel_odom_sim = agrotech_sim.wheel_odom_sim:main',
            'recorder = agrotech_sim.recorder:main',
            'jetson_recorder = agrotech_sim.jetson_recorder:main',
        ],
    },
)
