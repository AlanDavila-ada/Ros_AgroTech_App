import { useState, useEffect } from 'react';

export const NodeList = ({ ros }) => {
  const [nodes, setNodes] = useState([]);

  useEffect(() => {
    if (!ros) return;
    ros.getNodes((result) => setNodes(result), (error) => console.error(error));
  }, [ros]);

  return (
    <div>
      <h2>Nodes</h2>
      <ul>
        {nodes.map((node) => (
          <li key={node}>{node}</li>
        ))}
      </ul>
    </div>
  );
};
