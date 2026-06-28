import type { ComponentType, LazyExoticComponent } from 'react';
import { lazy } from 'react';

type ImportFactory<T extends ComponentType<any>> = () => Promise<{ default: T }>;

const RETRY_STORAGE_KEY = 'tarab-lazy-retry';

const canUseBrowserStorage = () => {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
};

const getRetried = () => {
  if (!canUseBrowserStorage()) return false;
  return window.sessionStorage.getItem(RETRY_STORAGE_KEY) === '1';
};

const markRetried = () => {
  if (!canUseBrowserStorage()) return;
  window.sessionStorage.setItem(RETRY_STORAGE_KEY, '1');
};

const clearRetried = () => {
  if (!canUseBrowserStorage()) return;
  window.sessionStorage.removeItem(RETRY_STORAGE_KEY);
};

export const lazyWithRetry = <T extends ComponentType<any>>(
  importFactory: ImportFactory<T>,
): LazyExoticComponent<T> =>
  lazy(async () => {
    try {
      const module = await importFactory();
      clearRetried();
      return module;
    } catch (error) {
      if (!getRetried()) {
        markRetried();
        window.location.reload();
      }
      throw error;
    }
  });
