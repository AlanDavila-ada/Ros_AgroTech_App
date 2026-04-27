export const rosEnv = (domainId = 42) =>
  `source /opt/ros/humble/setup.bash && export ROS_DOMAIN_ID=${domainId} && export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp && export CYCLONEDDS_URI=file:///home/ada/cyclonedds.xml`;
