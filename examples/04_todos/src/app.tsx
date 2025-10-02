import * as Y from "yjs";
import { useSnapshot } from "valtio";
import { createYjsProxy } from "valtio-yjs";
import { useState } from "react";
import {
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

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

// --- SIMULATE NETWORK RELAY ---
const RELAY_ORIGIN = Symbol("relay-origin");

doc1.on("update", (update: Uint8Array, origin: unknown) => {
  if (origin === RELAY_ORIGIN) return;
  doc2.transact(() => {
    Y.applyUpdate(doc2, update);
  }, RELAY_ORIGIN);
});

doc2.on("update", (update: Uint8Array, origin: unknown) => {
  if (origin === RELAY_ORIGIN) return;
  doc1.transact(() => {
    Y.applyUpdate(doc1, update);
  }, RELAY_ORIGIN);
});

// --- CREATE TWO PROXIES ---
const { proxy: proxy1, bootstrap: bootstrap1 } = createYjsProxy<AppState>(doc1, {
  getRoot: (doc: Y.Doc) => doc.getMap("sharedState"),
});

const { proxy: proxy2 } = createYjsProxy<AppState>(doc2, {
  getRoot: (doc: Y.Doc) => doc.getMap("sharedState"),
});

// Bootstrap with initial data
bootstrap1({
  todos: [
    {
      id: "1",
      text: "Plan project architecture",
      completed: true,
      children: [
        { id: "1-1", text: "Research technologies", completed: true },
        { id: "1-2", text: "Design data model", completed: true },
      ],
    },
    {
      id: "2",
      text: "Build collaborative features",
      completed: false,
      children: [
        { id: "2-1", text: "Set up Yjs sync", completed: true },
        { id: "2-2", text: "Implement real-time updates", completed: false },
      ],
    },
    {
      id: "3",
      text: "Polish UI with Tailwind",
      completed: false,
    },
  ],
});

// --- COMPONENTS ---

interface TodoItemComponentProps {
  item: TodoItem;
  stateProxy: typeof proxy1;
  path: number[];
}

const TodoItemComponent = ({
  item,
  stateProxy,
  path,
}: TodoItemComponentProps) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);

  const hasChildren = item.children && item.children.length > 0;

  const toggleComplete = () => {
    const target = getItemByPath(stateProxy.todos as any, path);
    if (target) {
      target.completed = !target.completed;
    }
  };

  const handleEditStart = () => {
    setIsEditing(true);
    setEditText(item.text);
  };

  const handleEditSave = () => {
    const target = getItemByPath(stateProxy.todos as any, path);
    if (target) {
      target.text = editText;
    }
    setIsEditing(false);
  };

  const handleEditCancel = () => {
    setEditText(item.text);
    setIsEditing(false);
  };

  const addSubtask = () => {
    const target = getItemByPath(stateProxy.todos as any, path);
    if (target) {
      if (!Array.isArray(target.children)) {
        target.children = [];
      }
      const newId = `${item.id}-${Date.now()}`;
      (target.children as any).push({
        id: newId,
        text: "New subtask",
        completed: false,
        children: [],
      });
      setIsExpanded(true);
    }
  };

  const deleteTodo = () => {
    const arr = getContainingArray(stateProxy.todos as any, path);
    const index = path[path.length - 1];
    if (arr && index !== undefined) {
      arr.splice(index, 1);
    }
  };

  const moveUp = () => {
    const currentIndex = path[path.length - 1];
    if (currentIndex === undefined || currentIndex === 0) return;

    const arr = getContainingArray(stateProxy.todos as any, path);
    if (arr) {
      const item = arr[currentIndex];
      arr.splice(currentIndex, 1);
      arr.splice(currentIndex - 1, 0, item);
    }
  };

  const moveDown = () => {
    const currentIndex = path[path.length - 1];
    if (currentIndex === undefined) return;

    const arr = getContainingArray(stateProxy.todos as any, path);
    if (arr && currentIndex < arr.length - 1) {
      const item = arr[currentIndex];
      arr.splice(currentIndex, 1);
      arr.splice(currentIndex + 1, 0, item);
    }
  };

  // Determine if item can move up or down
  const currentIndex = path[path.length - 1];
  const canMoveUp = currentIndex !== undefined && currentIndex > 0;
  const arr = getContainingArray(stateProxy.todos as any, path);
  const canMoveDown = arr && currentIndex !== undefined && currentIndex < arr.length - 1;

  return (
    <div className="group">
      <div className="flex items-start gap-2 py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors">
        {/* Expand/Collapse button */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`mt-0.5 flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors ${
            hasChildren ? "visible" : "invisible"
          }`}
        >
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        {/* Complete checkbox */}
        <button
          onClick={toggleComplete}
          className="mt-0.5 flex-shrink-0 text-gray-400 hover:text-blue-500 transition-colors"
        >
          {item.completed ? (
            <CheckCircle2 size={20} className="text-blue-500" />
          ) : (
            <Circle size={20} />
          )}
        </button>

        {/* Todo text */}
        {isEditing ? (
          <div className="flex-1 flex gap-2">
            <input
              type="text"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleEditSave();
                if (e.key === "Escape") handleEditCancel();
              }}
              className="flex-1 px-2 py-1 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <button
              onClick={handleEditSave}
              className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors"
            >
              Save
            </button>
            <button
              onClick={handleEditCancel}
              className="px-3 py-1 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div
            onDoubleClick={handleEditStart}
            className={`flex-1 cursor-pointer ${
              item.completed
                ? "text-gray-400 line-through"
                : "text-gray-800"
            }`}
          >
            {item.text}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={moveUp}
            disabled={!canMoveUp}
            className={`p-1.5 rounded transition-colors ${
              canMoveUp
                ? "text-gray-400 hover:text-green-500 hover:bg-green-50"
                : "text-gray-200 cursor-not-allowed"
            }`}
            title="Move up"
          >
            <ArrowUp size={16} />
          </button>
          <button
            onClick={moveDown}
            disabled={!canMoveDown}
            className={`p-1.5 rounded transition-colors ${
              canMoveDown
                ? "text-gray-400 hover:text-green-500 hover:bg-green-50"
                : "text-gray-200 cursor-not-allowed"
            }`}
            title="Move down"
          >
            <ArrowDown size={16} />
          </button>
          <button
            onClick={addSubtask}
            className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors"
            title="Add subtask"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={deleteTodo}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
            title="Delete"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="ml-6 border-l-2 border-gray-200 pl-2">
          {item.children!.map((child, index) => (
            <TodoItemComponent
              key={child.id}
              item={child}
              stateProxy={stateProxy}
              path={[...path, index]}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Helper function to get item by path
function getItemByPath(todos: any[], path: number[]): any {
  if (path.length === 0 || path[0] === undefined) return null;
  let current = todos[path[0]];
  for (let i = 1; i < path.length; i++) {
    if (!current || !Array.isArray(current.children)) return null;
    const index = path[i];
    if (index === undefined) return null;
    current = current.children[index];
  }
  return current;
}

// Helper function to get the array containing the item at the given path
function getContainingArray(todos: any[], path: number[]): any[] | null {
  if (path.length === 0) return null;
  if (path.length === 1) return todos;
  const parentPath = path.slice(0, -1);
  const parent = getItemByPath(todos, parentPath);
  return parent?.children ?? null;
}

interface ClientViewProps {
  name: string;
  stateProxy: typeof proxy1;
  colorScheme: "blue" | "purple";
}

const ClientView = ({ name, stateProxy, colorScheme }: ClientViewProps) => {
  const snap = useSnapshot(stateProxy);
  const [newTodoText, setNewTodoText] = useState("");

  const colors = {
    blue: {
      border: "border-blue-200",
      bg: "bg-blue-50",
      text: "text-blue-900",
      button: "bg-blue-500 hover:bg-blue-600",
      accent: "text-blue-600",
    },
    purple: {
      border: "border-purple-200",
      bg: "bg-purple-50",
      text: "text-purple-900",
      button: "bg-purple-500 hover:bg-purple-600",
      accent: "text-purple-600",
    },
  };

  const color = colors[colorScheme];

  const addTodo = () => {
    if (!newTodoText.trim()) return;
    const newTodo: TodoItem = {
      id: `${Date.now()}`,
      text: newTodoText,
      completed: false,
      children: [],
    };
    (stateProxy.todos as any).push(newTodo);
    setNewTodoText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      addTodo();
    }
  };

  const totalTodos = countTodos(snap.todos as any);
  const completedTodos = countCompletedTodos(snap.todos as any);

  return (
    <div
      className={`flex-1 min-w-[400px] border-2 ${color.border} rounded-xl overflow-hidden shadow-lg`}
    >
      {/* Header */}
      <div className={`${color.bg} px-6 py-4 border-b-2 ${color.border}`}>
        <h2 className={`text-xl font-bold ${color.text}`}>{name}</h2>
        <p className="text-sm text-gray-600 mt-1">
          {completedTodos} of {totalTodos} tasks completed
        </p>
      </div>

      {/* Add new todo */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex gap-2">
          <input
            type="text"
            value={newTodoText}
            onChange={(e) => setNewTodoText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a new task..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={addTodo}
            className={`px-6 py-2 ${color.button} text-white rounded-lg transition-colors flex items-center gap-2 font-medium`}
          >
            <Plus size={16} />
            Add
          </button>
        </div>
      </div>

      {/* Todo list */}
      <div className="p-4 bg-white max-h-[600px] overflow-y-auto">
        {Array.isArray(snap.todos) && snap.todos.length > 0 ? (
          <div className="space-y-1">
            {(snap.todos as any).map((todo: TodoItem, index: number) => (
              <TodoItemComponent
                key={todo.id}
                item={todo}
                stateProxy={stateProxy}
                path={[index]}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg mb-2">No tasks yet</p>
            <p className="text-sm">Add a task above to get started!</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Helper functions to count todos
function countTodos(todos: any[]): number {
  let count = 0;
  for (const todo of todos) {
    count++;
    if (todo.children && todo.children.length > 0) {
      count += countTodos(todo.children);
    }
  }
  return count;
}

function countCompletedTodos(todos: any[]): number {
  let count = 0;
  for (const todo of todos) {
    if (todo.completed) count++;
    if (todo.children && todo.children.length > 0) {
      count += countCompletedTodos(todo.children);
    }
  }
  return count;
}

// --- MAIN APP ---
const App = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Collaborative Todo List
          </h1>
          <p className="text-gray-600">
            Powered by Valtio + Yjs • Real-time synchronization between clients
          </p>
          <p className="text-sm text-gray-500 mt-2">
            💡 Double-click to edit • Use ↑↓ to reorder • Click + to add subtasks • Changes sync instantly!
          </p>
        </div>

        {/* Two clients side by side */}
        <div className="flex flex-col lg:flex-row gap-6">
          <ClientView
            name="Client 1"
            stateProxy={proxy1}
            colorScheme="blue"
          />
          <ClientView
            name="Client 2"
            stateProxy={proxy2}
            colorScheme="purple"
          />
        </div>
      </div>
    </div>
  );
};

export default App;
