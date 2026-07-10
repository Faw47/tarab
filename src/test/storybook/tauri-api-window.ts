const windowStub = {
  show: async () => {},
  hide: async () => {},
  close: async () => {},
  minimize: async () => {},
  unminimize: async () => {},
  isVisible: async () => true,
  setFocus: async () => {},
  startDragging: async () => {},
};

export const getCurrentWindow = () => windowStub;
export const appWindow = windowStub;
