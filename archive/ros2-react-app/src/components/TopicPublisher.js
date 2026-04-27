import { useState } from 'react';
import ROSLIB from 'roslib';

export const TopicPublisher = ({ ros }) => {
  const [topicName, setTopicName] = useState('');
  const [messageType, setMessageType] = useState('');
  const [messageData, setMessageData] = useState('{}');

  const publish = () => {
    const topic = new ROSLIB.Topic({ ros, name: topicName, messageType });
    const message = new ROSLIB.Message(JSON.parse(messageData));
    topic.publish(message);
  };

  return (
    <div>
      <h2>Publish Message</h2>
      <input placeholder="Topic name" value={topicName} onChange={(e) => setTopicName(e.target.value)} />
      <input placeholder="Message type" value={messageType} onChange={(e) => setMessageType(e.target.value)} />
      <textarea placeholder='{"data": "value"}' value={messageData} onChange={(e) => setMessageData(e.target.value)} />
      <button onClick={publish}>Publish</button>
    </div>
  );
};
