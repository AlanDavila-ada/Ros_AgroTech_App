import { TopicCard } from './TopicCard';

export const Dashboard = ({ ros, activeTopics, onRemove }) => {
  if (activeTopics.length === 0) {
    return (
      <main style={styles.main}>
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>◇</div>
          <div style={styles.emptyTitle}>No topics selected</div>
          <div style={styles.emptyDesc}>
            Select topics from the sidebar to start monitoring
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.main}>
      <div style={styles.topBar}>
        <span style={styles.topBarTitle}>Live Monitor</span>
        <span style={styles.topBarCount}>{activeTopics.length} topics</span>
      </div>
      <div style={styles.grid}>
        {activeTopics.map(({ name, type }) => (
          <TopicCard
            key={name}
            ros={ros}
            topicName={name}
            messageType={type}
            onRemove={() => onRemove(name)}
          />
        ))}
      </div>
    </main>
  );
};

const styles = {
  main: {
    flex: 1,
    overflow: 'auto',
    padding: 24,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    opacity: 0.4,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16, color: '#6c5ce7' },
  emptyTitle: { fontSize: 18, fontWeight: 600, marginBottom: 8 },
  emptyDesc: { fontSize: 13, color: '#888' },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  topBarTitle: { fontSize: 20, fontWeight: 700 },
  topBarCount: { fontSize: 12, color: '#6c5ce7', background: '#6c5ce715', padding: '4px 12px', borderRadius: 20 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
    gap: 16,
  },
};
