import { useState, useEffect, useRef } from 'react';
import ROSLIB from 'roslib';

export const useRos = (url) => {
  const [ros, setRos] = useState(null);
  const [connected, setConnected] = useState(false);
  const reconnectRef = useRef(null);

  useEffect(() => {
    let instance = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      instance = new ROSLIB.Ros({ url });

      instance.on('connection', () => {
        setConnected(true);
        setRos(instance);
      });

      instance.on('error', () => {});

      instance.on('close', () => {
        setConnected(false);
        if (!closed) {
          reconnectRef.current = setTimeout(connect, 2000);
        }
      });
    };

    connect();

    return () => {
      closed = true;
      clearTimeout(reconnectRef.current);
      if (instance) instance.close();
      setConnected(false);
      setRos(null);
    };
  }, [url]);

  return { ros, connected };
};
