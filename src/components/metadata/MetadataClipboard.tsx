import { Clipboard, ClipboardCheck, Clock, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useMetadataClipboardStore } from '../../store/metadata-clipboard-store';
import { Button } from '../ui/button';

interface MetadataClipboardProps {
  onPaste?: () => void;
}

export const MetadataClipboard = memo(({ onPaste }: MetadataClipboardProps) => {
  const { data, copiedAt, copiedFromPath, clearClipboard } = useMetadataClipboardStore();

  if (!data) return null;

  const timestamp = copiedAt ? new Date(copiedAt).toLocaleTimeString() : '';

  return (
    <div className="p-3 rounded-xl border border-white/10 bg-white/5 flex items-center gap-3 text-sm">
      <div className="flex items-center gap-2 text-text-primary">
        <Clipboard className="w-4 h-4" />
        <span>Metadata copied</span>
      </div>
      <div className="ml-auto flex items-center gap-3 text-xs text-text-muted">
        {copiedFromPath && (
          <span className="truncate max-w-[180px]" title={copiedFromPath}>
            {copiedFromPath.split(/[\\/]/).pop()}
          </span>
        )}
        {timestamp && (
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {timestamp}
          </span>
        )}
      </div>
      {onPaste && (
        <Button size="sm" variant="secondary" onClick={onPaste} className="flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4" />
          Paste
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={clearClipboard}
        className="text-text-muted hover:text-text-primary flex items-center gap-2"
      >
        <Trash2 className="w-4 h-4" />
        Clear
      </Button>
    </div>
  );
});

MetadataClipboard.displayName = 'MetadataClipboard';
