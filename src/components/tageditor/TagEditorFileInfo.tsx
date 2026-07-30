import type { TagInfo } from '../../types';

interface TagEditorFileInfoProps {
  tagInfo: TagInfo;
}

export function TagEditorFileInfo({ tagInfo }: TagEditorFileInfoProps) {
  return (
    <section aria-labelledby="tag-editor-file-info-title">
      <p
        id="tag-editor-file-info-title"
        className="text-xs uppercase tracking-widest text-text-subtle mb-3"
      >
        File Info
      </p>
      <dl className="panel rounded-2xl p-4 space-y-2 text-xs text-text-muted text-mono">
        <div className="flex justify-between">
          <dt>Format</dt>
          <dd className="text-text-primary">{tagInfo.fileFormat}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Duration</dt>
          <dd className="text-text-primary">
            {Math.floor(tagInfo.durationSecs / 60)}:
            {Math.floor(tagInfo.durationSecs % 60)
              .toString()
              .padStart(2, '0')}
          </dd>
        </div>
        {tagInfo.bitrate && (
          <div className="flex justify-between">
            <dt>Bitrate</dt>
            <dd className="text-text-primary">{tagInfo.bitrate} kbps</dd>
          </div>
        )}
        {tagInfo.sampleRate && (
          <div className="flex justify-between">
            <dt>Sample Rate</dt>
            <dd className="text-text-primary">{tagInfo.sampleRate} Hz</dd>
          </div>
        )}
        {tagInfo.channels && (
          <div className="flex justify-between">
            <dt>Channels</dt>
            <dd className="text-text-primary">{tagInfo.channels}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
