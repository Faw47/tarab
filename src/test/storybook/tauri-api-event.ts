type EventCallback<T = unknown> = (event: { payload: T }) => void;

const listeners = new Map<string, Set<EventCallback>>();

export const listen = async <T = unknown>(event: string, callback: EventCallback<T>) => {
  const bucket = listeners.get(event) ?? new Set<EventCallback>();
  bucket.add(callback as EventCallback);
  listeners.set(event, bucket);
  return () => bucket.delete(callback as EventCallback);
};

export const emit = async <T = unknown>(event: string, payload?: T) => {
  listeners.get(event)?.forEach((callback) => callback({ payload }));
};

export const emitTo = async <T = unknown>(_target: string, event: string, payload?: T) => {
  await emit(event, payload);
};
