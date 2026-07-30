import React from 'react';
import { APP_ERROR_EVENT, type AppErrorPayload } from '../../lib/report-error';

interface AppErrorBoundaryState {
  error: Error | null;
  stack: string | null;
}

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = {
      error: null,
      stack: null,
    };
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      error,
      stack: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const detail: AppErrorPayload = {
      message: 'Unexpected application error',
      detail: error.message,
      source: 'error-boundary',
    };

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<AppErrorPayload>(APP_ERROR_EVENT, { detail }));
    }

    this.setState({ stack: errorInfo.componentStack || null });
    console.error('[error-boundary] uncaught error', error, errorInfo);
  }

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  private handleReset = () => {
    this.setState({ error: null, stack: null });
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="min-h-[100dvh] w-full bg-background text-text-primary flex items-center justify-center px-6">
        <div className="w-full max-w-xl rounded-2xl border border-red-400/40 bg-red-950/35 p-6 shadow-xl backdrop-blur-sm">
          <h1 className="text-xl font-semibold text-red-100">Something went wrong</h1>
          <p className="mt-2 text-sm text-red-200/90">
            Tarab hit an unexpected error and cannot continue in this state.
          </p>
          <p className="mt-3 rounded-lg bg-black/30 p-3 text-xs text-red-100/90 font-mono break-all">
            {this.state.error.message}
          </p>
          {this.state.stack && (
            <p className="mt-2 text-[12px] text-red-200/70 font-mono whitespace-pre-wrap max-h-28 overflow-auto custom-scrollbar">
              {this.state.stack}
            </p>
          )}
          <div className="mt-5 flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded-lg bg-white text-black text-sm font-semibold hover:bg-white/90"
              onClick={this.handleReload}
            >
              Reload App
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-lg border border-white/20 bg-white/10 text-sm text-white hover:bg-white/15"
              onClick={this.handleReset}
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
