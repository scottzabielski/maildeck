import { LayoutGroup, AnimatePresence, Reorder, useDragControls } from 'framer-motion';
import { Icons } from './ui/Icons.tsx';
import { Column } from './Column.tsx';
import { SweepColumn } from './SweepColumn.tsx';
import { EmailViewer } from './EmailViewer.tsx';
import { useStore } from '../store/index.ts';
import type { Column as ColumnType } from '../types/index.ts';

function DraggableColumn({ column, columnOrder }: { column: ColumnType; columnOrder: number }) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={column}
      as="div"
      className="column-reorder-item"
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, boxShadow: '0 8px 30px rgba(0,0,0,0.3)', zIndex: 10 }}
    >
      <Column column={column} dragControls={controls} columnOrder={columnOrder} />
    </Reorder.Item>
  );
}

export function StreamsLayout() {
  const { columns: allColumns, reorderColumns, selectedEmail } = useStore();
  const openNewColumnEditor = useStore(s => s.openNewColumnEditor);
  const columns = allColumns.filter(c => c.enabled !== false);
  const isViewing = selectedEmail && selectedEmail.viewMode === 'streams';

  const handleReorder = (reordered: typeof columns) => {
    // Merge reordered enabled columns with disabled ones (appended at end)
    const disabledCols = allColumns.filter(c => c.enabled === false);
    reorderColumns([...reordered, ...disabledCols]);
  };

  const handleAddColumn = () => {
    openNewColumnEditor();
  };

  if (isViewing) {
    const sourceCol = columns.find(c => c.id === selectedEmail.sourceColumnId);
    if (sourceCol) {
      return (
        <LayoutGroup>
          <div className="deck-layout deck-layout--viewing">
            <Column key={sourceCol.id} column={sourceCol} columnOrder={0} />
            <AnimatePresence mode="wait">
              <EmailViewer key={'viewer-' + selectedEmail.emailId} />
            </AnimatePresence>
          </div>
        </LayoutGroup>
      );
    }
  }

  return (
    <div className="deck-layout">
      <LayoutGroup>
        <Reorder.Group
          as="div"
          axis="x"
          values={columns}
          onReorder={handleReorder}
          className="deck-columns-reorder"
        >
          {columns.map((col, idx) => (
            <DraggableColumn key={col.id} column={col} columnOrder={idx} />
          ))}
          <div className="add-column-area">
            <button className="add-column-btn" onClick={handleAddColumn} title="Add column">
              <Icons.Plus />
            </button>
          </div>
        </Reorder.Group>
      </LayoutGroup>
      <SweepColumn key="sweep" columnCount={columns.length} />
    </div>
  );
}
