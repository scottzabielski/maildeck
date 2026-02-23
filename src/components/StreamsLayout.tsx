import { LayoutGroup, AnimatePresence, Reorder } from 'framer-motion';
import { Column } from './Column.tsx';
import { SweepColumn } from './SweepColumn.tsx';
import { EmailViewer } from './EmailViewer.tsx';
import { useStore } from '../store/index.ts';

export function StreamsLayout() {
  const { columns, reorderColumns, selectedEmail } = useStore();
  const isViewing = selectedEmail && selectedEmail.viewMode === 'streams';

  if (isViewing) {
    const sourceCol = columns.find(c => c.id === selectedEmail.sourceColumnId);
    if (sourceCol) {
      return (
        <LayoutGroup>
          <div className="deck-layout deck-layout--viewing">
            <Column key={sourceCol.id} column={sourceCol} />
            <AnimatePresence mode="wait">
              <EmailViewer key={'viewer-' + selectedEmail.emailId} />
            </AnimatePresence>
          </div>
        </LayoutGroup>
      );
    }
  }

  return (
    <LayoutGroup>
      <div className="deck-layout">
        <Reorder.Group
          as="div"
          axis="x"
          values={columns}
          onReorder={reorderColumns}
          className="deck-columns-reorder"
        >
          {columns.map(col => (
            <Reorder.Item
              key={col.id}
              value={col}
              as="div"
              className="column-reorder-item"
              whileDrag={{ scale: 1.02, boxShadow: '0 8px 30px rgba(0,0,0,0.3)', zIndex: 10 }}
            >
              <Column column={col} />
            </Reorder.Item>
          ))}
        </Reorder.Group>
        <SweepColumn key="sweep" />
      </div>
    </LayoutGroup>
  );
}
