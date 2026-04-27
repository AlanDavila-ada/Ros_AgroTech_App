import { useState, useEffect } from 'react';
import ROSLIB from 'roslib';

export const TopicList = ({ ros }) => {
  const [topics, setTopics] = useState([]);

  useEffect(() => {
    if (!ros) return;
    ros.getTopics((result) => {
      setTopics(result.topics.map((name, i) => ({ name, type: result.types[i] })));
    });
  }, [ros]);

  return (
    <div>
      <h2>Topics</h2>
      <ul>
        {topics.map(({ name, type }) => (
          <li key={name}>{name} ({type})</li>
        ))}
      </ul>
    </div>
  );
};
