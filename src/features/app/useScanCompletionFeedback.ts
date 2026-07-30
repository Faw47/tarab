import { useEffect, useRef, useState } from 'react';

export function useScanCompletionFeedback() {
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shellScanBurstKey, setShellScanBurstKey] = useState(0);
  const [showScanComplete, setShowScanComplete] = useState(false);

  useEffect(() => {
    const handleManualScanComplete = () => {
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
      }
      setShowScanComplete(true);
      completionTimerRef.current = setTimeout(() => {
        setShowScanComplete(false);
        completionTimerRef.current = null;
      }, 1800);
      setShellScanBurstKey((key) => key + 1);
    };
    window.addEventListener('tarab:manual-scan-complete', handleManualScanComplete);
    return () => {
      window.removeEventListener('tarab:manual-scan-complete', handleManualScanComplete);
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
    };
  }, []);

  return { shellScanBurstKey, showScanComplete };
}
