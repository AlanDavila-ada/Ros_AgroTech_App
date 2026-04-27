import { useState, useEffect } from 'react';
import ROSLIB from 'roslib';

export const TopicSubscriber = ({ ros, topicName, messageType }) => {
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!ros || !topicName || !messageType) return;
    
    const listener = new ROSLIB.Topic({ ros, name: topicName, messageType });
    listener.subscribe((msg) => setMessage(msg));
    
    return () => listener.unsubscribe();
  }, [ros, topicName, messageType]);

  return (
    <div>
      <h3>Subscribing to: {topicName}</h3>
      <pre>{JSON.stringify(message, null, 2)}</pre>
    </div>
  );
};
