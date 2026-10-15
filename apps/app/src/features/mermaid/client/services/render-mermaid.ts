import mermaid from 'mermaid';
import { v7 as uuidV7 } from 'uuid';

type MermaidRenderRequest = {
  source: string;
  isDarkMode: boolean;
  container: HTMLDivElement;
  onRendered: () => void;
  onError: (error: unknown) => void;
};

let pending: Array<() => Promise<void>> = [];
let running = false;

const runNext = (): void => {
  const [task, ...rest] = pending;
  pending = rest;
  if (task == null) {
    running = false;
    return;
  }
  // A consumer callback throwing must not prevent later diagrams from rendering.
  void task().then(runNext, runNext);
};

export const scheduleMermaidRender = ({
  source,
  isDarkMode,
  container,
  onRendered,
  onError,
}: MermaidRenderRequest): (() => void) => {
  let cancelled = false;
  const isCurrent = (): boolean => !cancelled && container.isConnected;

  const task = async (): Promise<void> => {
    if (!isCurrent()) return;
    try {
      // Mermaid queues render(), but neither initialize() nor our SVG publication.
      // Keep all three exclusive, even while a cancelled active render settles.
      mermaid.initialize({ theme: isDarkMode ? 'dark' : undefined });
      const id = `mermaid-${uuidV7()}`;
      const { svg } = await mermaid.render(id, source, container);
      if (!isCurrent()) return;
      container.innerHTML = svg;
      onRendered();
    } catch (error) {
      if (isCurrent()) onError(error);
    }
  };

  pending = [...pending, task];
  if (!running) {
    running = true;
    runNext();
  }

  return () => {
    cancelled = true;
    pending = pending.filter((entry) => entry !== task);
  };
};
