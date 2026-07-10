let enabled = false;

export const isEnabled = async () => enabled;
export const enable = async () => {
  enabled = true;
};
export const disable = async () => {
  enabled = false;
};
