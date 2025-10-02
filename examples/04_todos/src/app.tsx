import * as Y from "yjs";
import { useSnapshot } from "valtio";
import { createYjsProxy } from "valtio-yjs";
import { useState, useCallback, useEffect, useRef, memo } from "react";
import {
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  GripVertical,
  CheckSquare,
  Square,
  Wifi,
  WifiOff,
  Loader2,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Todo item type with nested children
type TodoItem = {
  id: string;
  text: string;
  completed: boolean;
  children?: TodoItem[];
};

type AppState = {
  todos: TodoItem[];
};

// --- SETUP TWO Y.DOCS FOR COLLABORATION ---
const doc1 = new Y.Doc();
const doc2 = new Y.Doc();

// --- SIMULATE NETWORK RELAY WITH STATUS ---
const RELAY_ORIGIN = Symbol("relay-origin");
let syncStatus1: "connected" | "syncing" | "offline" = "connected";
let syncStatus2: "connected" | "syncing" | "offline" = "connected";
const syncListeners: Set<() => void> = new Set();

const notifySyncListeners = () => {
  syncListeners.forEach((listener) => listener());
};

doc1.on("update", (update: Uint8Array, origin: unknown) => {
  if (origin === RELAY_ORIGIN) return;
  syncStatus1 = "syncing";
  notifySyncListeners();
  setTimeout(() => {
    doc2.transact(() => {
      Y.applyUpdate(doc2, update);
    }, RELAY_ORIGIN);
    syncStatus1 = "connected";
    notifySyncListeners();
  }, 100); // Simulate network delay
});

doc2.on("update", (update: Uint8Array, origin: unknown) => {
  if (origin === RELAY_ORIGIN) return;
  syncStatus2 = "syncing";
  notifySyncListeners();
  setTimeout(() => {
    doc1.transact(() => {
      Y.applyUpdate(doc1, update);
    }, RELAY_ORIGIN);
    syncStatus2 = "connected";
    notifySyncListeners();
  }, 100); // Simulate network delay
});

// --- CREATE TWO PROXIES ---
const { proxy: proxy1, bootstrap: bootstrap1 } = createYjsProxy<AppState>(doc1, {
  getRoot: (doc: Y.Doc) => doc.getMap("sharedState"),
});

const { proxy: proxy2 } = createYjsProxy<AppState>(doc2, {
  getRoot: (doc: Y.Doc) => doc.getMap("sharedState"),
});


proxy1.todos = [
  {
    id: "1",
    text: "Plan project architecture",
    completed: true,
    children: [
      { id: "1-1", text: "Research technologies", completed: true },
      { id: "1-2", text: "Design data model", completed: true },
    ],
  },
];
// --- HELPER FUNCTIONS ---

// Helper function to get item by path
function getItemByPath(todos: TodoItem[], path: number[]): TodoItem | null {
  if (path.length === 0 || path[0] === undefined) return null;
  let current: TodoItem | undefined = todos[path[0]];
  for (let i = 1; i < path.length; i++) {
    if (!current || !Array.isArray(current.children)) return null;
    const index = path[i];
    if (index === undefined) return null;
    current = current.children[index];
  }
  return current ?? null;
}

// Helper function to get the array containing the item at the given path
function getContainingArray(todos: TodoItem[], path: number[]): TodoItem[] | null {
  if (path.length === 0) return null;
  if (path.length === 1) return todos;
  const parentPath = path.slice(0, -1);
  const parent = getItemByPath(todos, parentPath);
  return parent?.children ?? null;
}

// Helper functions to count todos
function countTodos(todos: TodoItem[] | unknown): number {
  if (!Array.isArray(todos)) return 0;
  let count = 0;
  for (const todo of todos) {
    count++;
    if (todo.children && todo.children.length > 0) {
      count += countTodos(todo.children);
    }
  }
  return count;
}

function countCompletedTodos(todos: TodoItem[] | unknown): number {
  if (!Array.isArray(todos)) return 0;
  let count = 0;
  for (const todo of todos) {
    if (todo.completed) count++;
    if (todo.children && todo.children.length > 0) {
      count += countCompletedTodos(todo.children);
    }
  }
  return count;
}

// --- SYNC STATUS COMPONENT ---
interface SyncStatusProps {
  clientId: 1 | 2;
}

const SyncStatus = memo(({ clientId }: SyncStatusProps) => {
  const [status, setStatus] = useState<"connected" | "syncing" | "offline">("connected");

  useEffect(() => {
    const updateStatus = () => {
      setStatus(clientId === 1 ? syncStatus1 : syncStatus2);
    };
    syncListeners.add(updateStatus);
    return () => {
      syncListeners.delete(updateStatus);
    };
  }, [clientId]);

  if (status === "syncing") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-blue-600">
        <Loader2 size={12} className="animate-spin" />
        <span>Syncing...</span>
      </div>
    );
  }

  if (status === "offline") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-red-600">
        <WifiOff size={12} />
        <span>Offline</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-green-600">
      <Wifi size={12} />
      <span>Connected</span>
    </div>
  );
});

SyncStatus.displayName = "SyncStatus";

// --- SORTABLE TODO ITEM ---
interface TodoItemComponentProps {
  item: TodoItem;
  stateProxy: typeof proxy1;
  path: number[];
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  selectionMode: boolean;
  nestLevel: number;
  colorScheme: "blue" | "purple";
  onDragEnd?: (event: DragEndEvent) => void;
}

const TodoItemComponent = memo(
  ({
    item,
    stateProxy,
    path,
    isSelected,
    onToggleSelect,
    selectionMode,
    nestLevel,
    colorScheme,
    onDragEnd,
  }: TodoItemComponentProps) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState(item.text);
    const inputRef = useRef<HTMLInputElement>(null);

    const hasChildren = item.children && item.children.length > 0;

    // Sensors for drag and drop (for children)
    const childSensors = useSensors(
      useSensor(PointerSensor),
      useSensor(KeyboardSensor, {
        coordinateGetter: sortableKeyboardCoordinates,
      })
    );

    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: item.id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    };

    const toggleComplete = useCallback(() => {
      const target = getItemByPath(stateProxy.todos as TodoItem[], path);
      if (target) {
        target.completed = !target.completed;
      }
    }, [stateProxy, path]);

    const handleEditStart = useCallback(() => {
      if (!selectionMode) {
        setIsEditing(true);
        setEditText(item.text);
      }
    }, [item.text, selectionMode]);

    const handleEditSave = useCallback(() => {
      const target = getItemByPath(stateProxy.todos as TodoItem[], path);
      if (target && editText.trim()) {
        target.text = editText;
      }
      setIsEditing(false);
    }, [stateProxy, path, editText]);

    const handleEditCancel = useCallback(() => {
      setEditText(item.text);
      setIsEditing(false);
    }, [item.text]);

    const addSubtask = useCallback(() => {
      const target = getItemByPath(stateProxy.todos as TodoItem[], path);
      if (target) {
        if (!Array.isArray(target.children)) {
          target.children = [];
        }
        const newId = `${item.id}-${Date.now()}`;
        (target.children as TodoItem[]).push({
          id: newId,
          text: "New subtask",
          completed: false,
          children: [],
        });
        setIsExpanded(true);
      }
    }, [stateProxy, path, item.id]);

    const deleteTodo = useCallback(() => {
      const arr = getContainingArray(stateProxy.todos as TodoItem[], path);
      const index = path[path.length - 1];
      if (arr && index !== undefined) {
        arr.splice(index, 1);
      }
    }, [stateProxy, path]);

    // Handle drag end for children items
    const handleChildDragEnd = useCallback(
      (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
          // Get the mutable parent item from the proxy
          const target = getItemByPath(stateProxy.todos as TodoItem[], path);
          if (target && target.children) {
            const children = target.children;
            const oldIndex = children.findIndex((c) => c.id === active.id);
            const newIndex = children.findIndex((c) => c.id === over.id);

            if (oldIndex !== -1 && newIndex !== -1) {
              const newOrder = arrayMove(children, oldIndex, newIndex);
              // Clear and repopulate the children array
              children.splice(0, children.length, ...newOrder);
            }
          }
        }
      },
      [stateProxy, path]
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (isEditing) {
          if (e.key === "Enter") {
            e.preventDefault();
            handleEditSave();
          } else if (e.key === "Escape") {
            e.preventDefault();
            handleEditCancel();
          }
        }
      },
      [isEditing, handleEditSave, handleEditCancel]
    );

    useEffect(() => {
      if (isEditing && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, [isEditing]);

    // Background color based on nesting level
    const bgColors = ["bg-white", "bg-slate-50/50", "bg-slate-100/50", "bg-slate-150/50"];
    const bgColor = bgColors[Math.min(nestLevel, bgColors.length - 1)];

    // Color scheme accents
    const accentColors = {
      blue: "text-blue-600",
      purple: "text-purple-600",
    };
    const accentColor = accentColors[colorScheme];

    return (
      <div ref={setNodeRef} style={style}>
        <div
          className={`group ${bgColor} ${
            isSelected ? "ring-2 ring-blue-500 ring-inset" : ""
          }`}
        >
          <div className="flex items-start gap-2 py-2.5 px-3 rounded-md hover:bg-slate-50/50 transition-all duration-150">
            {/* Drag handle */}
            {!selectionMode && (
              <button
                {...attributes}
                {...listeners}
                className="mt-0.5 flex-shrink-0 text-slate-300 hover:text-slate-600 cursor-grab active:cursor-grabbing transition-colors"
                aria-label="Drag to reorder"
              >
                <GripVertical size={16} />
              </button>
            )}

            {/* Selection checkbox (in selection mode) */}
            {selectionMode && (
              <button
                onClick={() => onToggleSelect(item.id)}
                className="mt-0.5 flex-shrink-0 text-slate-400 hover:text-slate-700 transition-colors"
                aria-label={isSelected ? "Deselect task" : "Select task"}
              >
                {isSelected ? (
                  <CheckSquare size={20} className={accentColor} />
                ) : (
                  <Square size={20} />
                )}
              </button>
            )}

            {/* Expand/Collapse button */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={`mt-0.5 flex-shrink-0 text-slate-400 hover:text-slate-700 transition-colors ${
                hasChildren ? "visible" : "invisible"
              }`}
              aria-label={isExpanded ? "Collapse subtasks" : "Expand subtasks"}
              aria-expanded={isExpanded}
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>

            {/* Complete checkbox */}
            <button
              onClick={toggleComplete}
              className="mt-0.5 flex-shrink-0 text-slate-400 hover:text-slate-700 transition-colors"
              aria-label={item.completed ? "Mark as incomplete" : "Mark as complete"}
            >
              {item.completed ? (
                <CheckCircle2 size={20} className={accentColor} />
              ) : (
                <Circle size={20} />
              )}
            </button>

            {/* Todo text */}
            {isEditing ? (
              <div className="flex-1 flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={handleEditSave}
                  className="flex-1 px-3 py-1.5 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent text-sm"
                  aria-label="Edit task text"
                />
              </div>
            ) : (
              <div
                onDoubleClick={handleEditStart}
                className={`flex-1 cursor-pointer leading-relaxed ${
                  item.completed
                    ? "text-slate-400 line-through"
                    : "text-slate-700"
                }`}
                role="button"
                tabIndex={0}
                aria-label={`Task: ${item.text}. Double-click to edit`}
              >
                {item.text}
              </div>
            )}

            {/* Action buttons */}
            {!selectionMode && (
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={addSubtask}
                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                  aria-label="Add subtask"
                  title="Add subtask"
                >
                  <Plus size={15} />
                </button>
                <button
                  onClick={deleteTodo}
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                  aria-label="Delete task"
                  title="Delete"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </div>

          {/* Children */}
          {hasChildren && isExpanded && (
            <div className="ml-8 border-l-2 border-slate-200 pl-3">
              <DndContext
                sensors={childSensors}
                collisionDetection={closestCenter}
                onDragEnd={handleChildDragEnd}
              >
                <SortableContext
                  items={item.children!.map((c) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {item.children!.map((child, index) => (
                    <TodoItemComponent
                      key={child.id}
                      item={child}
                      stateProxy={stateProxy}
                      path={[...path, index]}
                      isSelected={isSelected}
                      onToggleSelect={onToggleSelect}
                      selectionMode={selectionMode}
                      nestLevel={nestLevel + 1}
                      colorScheme={colorScheme}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          )}
        </div>
      </div>
    );
  }
);

TodoItemComponent.displayName = "TodoItemComponent";

// --- CLIENT VIEW ---
interface ClientViewProps {
  name: string;
  stateProxy: typeof proxy1;
  colorScheme: "blue" | "purple";
  clientId: 1 | 2;
}

const ClientView = memo(({ name, stateProxy, colorScheme, clientId }: ClientViewProps) => {
  const snap = useSnapshot(stateProxy);
  const [newTodoText, setNewTodoText] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const colors = {
    blue: {
      border: "border-blue-200",
      bg: "bg-blue-50",
      bgLight: "bg-blue-50/50",
      text: "text-blue-900",
      button: "bg-blue-600 hover:bg-blue-700",
      accent: "text-blue-600",
      ring: "focus:ring-blue-300",
      header: "bg-gradient-to-r from-blue-50 to-blue-100",
    },
    purple: {
      border: "border-purple-200",
      bg: "bg-purple-50",
      bgLight: "bg-purple-50/50",
      text: "text-purple-900",
      button: "bg-purple-600 hover:bg-purple-700",
      accent: "text-purple-600",
      ring: "focus:ring-purple-300",
      header: "bg-gradient-to-r from-purple-50 to-purple-100",
    },
  };

  const color = colors[colorScheme];

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const addTodo = useCallback(() => {
    if (!newTodoText.trim()) return;
    const newTodo: TodoItem = {
      id: `${Date.now()}-${Math.random()}`,
      text: newTodoText,
      completed: false,
      children: [],
    };
    (stateProxy.todos as TodoItem[]).push(newTodo);
    setNewTodoText("");
  }, [newTodoText, stateProxy]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        addTodo();
      }
    },
    [addTodo]
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (over && active.id !== over.id) {
      const todos = stateProxy.todos as TodoItem[];
      const oldIndex = todos.findIndex((t) => t.id === active.id);
      const newIndex = todos.findIndex((t) => t.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(todos, oldIndex, newIndex);
        // Clear and repopulate the array
        todos.splice(0, todos.length, ...newOrder);
      }
    }
  };

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => !prev);
    if (selectionMode) {
      setSelectedIds(new Set());
    }
  }, [selectionMode]);

  const selectAll = useCallback(() => {
    const allIds = new Set<string>();
    const collectIds = (todos: TodoItem[] | unknown) => {
      if (!Array.isArray(todos)) return;
      todos.forEach((todo) => {
        allIds.add(todo.id);
        if (todo.children) {
          collectIds(todo.children);
        }
      });
    };
    collectIds(snap.todos);
    setSelectedIds(allIds);
  }, [snap.todos]);

  const deleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const todos = stateProxy.todos as TodoItem[];
    const filterTodos = (items: TodoItem[]): TodoItem[] => {
      return items.filter((item) => {
        if (selectedIds.has(item.id)) return false;
        if (item.children) {
          item.children = filterTodos(item.children);
        }
        return true;
      });
    };
    const filtered = filterTodos([...todos]);
    todos.splice(0, todos.length, ...filtered);
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, [selectedIds, stateProxy]);

  const completeSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const todos = stateProxy.todos as TodoItem[];
    const updateTodos = (items: TodoItem[]) => {
      items.forEach((item) => {
        if (selectedIds.has(item.id)) {
          item.completed = true;
        }
        if (item.children) {
          updateTodos(item.children);
        }
      });
    };
    updateTodos(todos);
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, [selectedIds, stateProxy]);

  const totalTodos = countTodos(snap.todos as TodoItem[]);
  const completedTodos = countCompletedTodos(snap.todos as TodoItem[]);

  const activeTodo = activeId
    ? (snap.todos as TodoItem[]).find((t) => t.id === activeId)
    : null;

  return (
    <div
      className={`flex-1 min-w-[400px] border-2 ${color.border} rounded-lg overflow-hidden shadow-lg bg-white`}
    >
      {/* Header */}
      <div className={`${color.header} px-6 py-5 border-b-2 ${color.border}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-lg font-semibold ${color.text} tracking-tight`}>
              {name}
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              {completedTodos} of {totalTodos} tasks completed
            </p>
          </div>
          <SyncStatus clientId={clientId} />
        </div>
      </div>

      {/* Add new todo */}
      <div className={`p-5 border-b border-slate-100 ${color.bgLight}`}>
        <div className="flex gap-2">
          <input
            type="text"
            value={newTodoText}
            onChange={(e) => setNewTodoText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a new task..."
            className={`flex-1 px-4 py-2.5 border-2 ${color.border} rounded-md focus:outline-none focus:ring-2 ${color.ring} focus:border-transparent text-sm placeholder:text-slate-400`}
            aria-label="New task input"
          />
          <button
            onClick={addTodo}
            className={`px-5 py-2.5 ${color.button} text-white rounded-md transition-colors flex items-center gap-2 font-medium text-sm`}
            aria-label="Add task"
          >
            <Plus size={16} />
            Add
          </button>
        </div>
      </div>

      {/* Bulk actions toolbar */}
      {selectionMode && (
        <div className={`p-4 ${color.bg} border-b ${color.border} flex items-center gap-3`}>
          <span className="text-sm font-medium text-slate-700">
            {selectedIds.size} selected
          </span>
          <button
            onClick={selectAll}
            className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
          >
            Select All
          </button>
          <button
            onClick={completeSelected}
            disabled={selectedIds.size === 0}
            className={`px-3 py-1.5 text-xs ${color.button} text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            Complete
          </button>
          <button
            onClick={deleteSelected}
            disabled={selectedIds.size === 0}
            className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Delete
          </button>
          <button
            onClick={toggleSelectionMode}
            className="ml-auto px-3 py-1.5 text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-md transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Selection mode toggle */}
      {!selectionMode && totalTodos > 0 && (
        <div className="px-5 pt-3 pb-0">
          <button
            onClick={toggleSelectionMode}
            className="text-xs text-slate-500 hover:text-slate-700 transition-colors"
          >
            Enable selection mode
          </button>
        </div>
      )}

      {/* Todo list */}
      <div className="p-5 bg-white max-h-[600px] overflow-y-auto">
        {Array.isArray(snap.todos) && snap.todos.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={(snap.todos as TodoItem[]).map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-0.5">
                {(snap.todos as TodoItem[]).map((todo, index) => (
                  <TodoItemComponent
                    key={todo.id}
                    item={todo}
                    stateProxy={stateProxy}
                    path={[index]}
                    isSelected={selectedIds.has(todo.id)}
                    onToggleSelect={toggleSelect}
                    selectionMode={selectionMode}
                    nestLevel={0}
                    colorScheme={colorScheme}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeTodo ? (
                <div className="bg-white border-2 border-slate-300 rounded-lg p-3 shadow-xl">
                  <div className="flex items-center gap-3">
                    <GripVertical size={16} className="text-slate-400" />
                    <Circle size={20} className="text-slate-400" />
                    <span className="text-slate-700">{activeTodo.text}</span>
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">📝</div>
            <p className="text-base font-medium text-slate-600 mb-2">No tasks yet</p>
            <p className="text-sm text-slate-400 mb-4">
              Add your first task to get started
            </p>
            <div className="text-xs text-slate-400 space-y-1">
              <p>💡 Double-click to edit</p>
              <p>🔄 Drag to reorder</p>
              <p>➕ Click + to add subtasks</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

ClientView.displayName = "ClientView";

// --- MAIN APP ---
const App = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-slate-900 mb-3 tracking-tight">
            Collaborative Todo List
          </h1>
          <p className="text-slate-600 text-base">
            Powered by Valtio + Yjs · Real-time synchronization between clients
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-4 text-xs text-slate-500">
            <span>💡 Double-click to edit</span>
            <span>🔄 Drag to reorder</span>
            <span>➕ Click + to add subtasks</span>
            <span>✅ Enable selection for bulk actions</span>
            <span>⚡ Changes sync instantly</span>
          </div>
        </div>

        {/* Two clients side by side */}
        <div className="flex flex-col lg:flex-row gap-6 max-w-7xl mx-auto">
          <ClientView
            name="Client 1"
            stateProxy={proxy1}
            colorScheme="blue"
            clientId={1}
          />
          <ClientView
            name="Client 2"
            stateProxy={proxy2}
            colorScheme="purple"
            clientId={2}
          />
        </div>
      </div>
    </div>
  );
};

export default App;
