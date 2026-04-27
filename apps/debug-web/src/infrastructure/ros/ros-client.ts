/**
 * Thin wrapper around roslib. Used only by the raw ROS2 debug views (live
 * topic dump, calibration preview). All recording/control flows go through
 * the FastAPI; this is for inspecting ROS state directly.
 */
import ROSLIB from "roslib";

export interface RosClient {
  url: string;
  ros: ROSLIB.Ros;
  isConnected: () => boolean;
  close: () => void;
}

export function createRosClient(url: string): RosClient {
  const ros = new ROSLIB.Ros({ url });
  let connected = false;
  ros.on("connection", () => {
    connected = true;
  });
  ros.on("close", () => {
    connected = false;
  });
  ros.on("error", () => {
    connected = false;
  });

  return {
    url,
    ros,
    isConnected: () => connected,
    close: () => ros.close(),
  };
}
