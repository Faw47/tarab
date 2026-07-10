import { useEffect, useRef, useState } from 'react';

const LAST_SCAN_KEY = 'tarab-last-scan-v1';

interface UseScanCompletionFeedbackOptions {
  isScanning: boolean;
  scanProgress: number;
  totalTracks: number;
}

export function useScanCompletionFeedback({
  isScanning,
  scanProgress,
  totalTracks,
}: UseScanCompletionFeedbackOptions) {
  const wasScanning = useRef(false);
  const confettiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shellScanBurstKey, setShellScanBurstKey] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(
    () => () => {
      if (confettiTimerRef.current) {
        clearTimeout(confettiTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (isScanning && confettiTimerRef.current) {
      clearTimeout(confettiTimerRef.current);
      confettiTimerRef.current = null;
      setShowConfetti(false);
    }

    if (wasScanning.current && !isScanning) {
      if (totalTracks > 0) {
        setShowConfetti(true);
        confettiTimerRef.current = setTimeout(() => {
          setShowConfetti(false);
          confettiTimerRef.current = null;
        }, 3500);
      }
      setShellScanBurstKey((key) => key + 1);
      if (scanProgress >= 100) {
        try {
          localStorage.setItem(LAST_SCAN_KEY, Date.now().toString());
        } catch {
          // ignore storage errors
        }
      }
    }
    wasScanning.current = isScanning;
  }, [isScanning, scanProgress, totalTracks]);

  return { shellScanBurstKey, showConfetti };
}
