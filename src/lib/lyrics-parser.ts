import type { LyricLine, LyricWord, ParsedLyrics } from '../types';

/**
 * Parse LRC timestamp [mm:ss.xx] or [mm:ss] to milliseconds
 */
const parseLrcTime = (timeStr: string): number => {
  // Handle formats: [mm:ss.xx], [mm:ss.xxx], [mm:ss]
  const match = timeStr.match(/(\d+):(\d+)(?:\.(\d+))?/);
  if (!match) return 0;

  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  const fraction = match[3] || '0';

  // Normalize fraction to milliseconds
  let ms = 0;
  if (fraction.length === 2) {
    ms = parseInt(fraction, 10) * 10; // centiseconds
  } else if (fraction.length === 3) {
    ms = parseInt(fraction, 10); // milliseconds
  } else if (fraction.length === 1) {
    ms = parseInt(fraction, 10) * 100; // deciseconds
  }

  return (minutes * 60 + seconds) * 1000 + ms;
};

/**
 * Parse LRC lyrics content (standard or enhanced)
 *
 * Standard LRC: [mm:ss.xx]Line text
 * Enhanced LRC: [mm:ss.xx]<mm:ss.xx>Word1 <mm:ss.xx>Word2 <mm:ss.xx>Word3
 */
export const parseLyrics = (content: string): ParsedLyrics => {
  const lines: LyricLine[] = [];
  const rawLines = content.split(/\r?\n/);

  let isEnhanced = false;
  let offsetMs = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Skip metadata lines like [ar:Artist], [ti:Title], etc.
    if (/^\[[a-zA-Z]+:/.test(trimmed)) {
      const offsetMatch = trimmed.match(/^\[offset:([+-]?\d+)\]/i);
      if (offsetMatch) {
        const parsed = Number.parseInt(offsetMatch[1], 10);
        offsetMs = Number.isFinite(parsed) ? parsed : 0;
      }
      continue;
    }

    const lineTimeMatches = Array.from(rawLine.matchAll(/\[(\d+:\d+(?:\.\d+)?)\]/g));
    const wordTimeMatches = Array.from(rawLine.matchAll(/<(\d+:\d+(?:\.\d+)?)>/g));

    if (lineTimeMatches.length === 0 && wordTimeMatches.length === 0) continue;

    const contentWithoutLineTags =
      lineTimeMatches.length > 0 ? rawLine.replace(/\[(\d+:\d+(?:\.\d+)?)\]/g, '') : rawLine;

    if (wordTimeMatches.length > 0) {
      const { words: rawWords, text } = parseEnhancedLine(contentWithoutLineTags);
      if (rawWords.length === 0) continue;
      isEnhanced = true;

      const lineTimesRaw =
        lineTimeMatches.length > 0
          ? lineTimeMatches.map((m) => parseLrcTime(m[1]))
          : [Math.min(...rawWords.map((w) => w.time))];
      const maxWordRaw = Math.max(...rawWords.map((w) => w.time));

      lineTimesRaw.forEach((lineStartRaw) => {
        const isRelative = lineTimeMatches.length > 0 && maxWordRaw < lineStartRaw - 50;
        const applyOffset = (time: number) => Math.max(0, time + offsetMs);
        const words = rawWords.map((word) => ({
          text: word.text,
          startTime: applyOffset(isRelative ? lineStartRaw + word.time : word.time),
          endTime: 0,
        }));
        for (let w = 0; w < words.length - 1; w++) {
          words[w].endTime = words[w + 1].startTime;
        }
        const startTime = applyOffset(lineStartRaw);
        const fallbackEnd =
          words.length > 0
            ? Math.max(words[words.length - 1].startTime + 500, startTime + 500)
            : startTime + 5000;
        if (words.length > 0) {
          words[words.length - 1].endTime = fallbackEnd;
        }
        lines.push({
          startTime,
          endTime: fallbackEnd,
          text,
          words,
        });
      });
    } else {
      const text = contentWithoutLineTags.trim();
      if (!text) continue;
      lineTimeMatches.forEach((match) => {
        const startTime = Math.max(0, parseLrcTime(match[1]) + offsetMs);
        const endTime = startTime + 5000;
        lines.push({
          startTime,
          endTime,
          text,
          words: [
            {
              text,
              startTime,
              endTime,
            },
          ],
        });
      });
    }
  }

  // Sort by start time
  lines.sort((a, b) => a.startTime - b.startTime);

  // Update end times based on next line start
  for (let i = 0; i < lines.length - 1; i++) {
    const nextStart = lines[i + 1].startTime;
    if (nextStart > lines[i].startTime) {
      lines[i].endTime = nextStart;
      if (lines[i].words.length > 0) {
        lines[i].words[lines[i].words.length - 1].endTime = nextStart;
      }
    }
  }

  return { lines, isEnhanced };
};

// Helper to build runs once during parsing
const buildWordRuns = (lineText: string, words: LyricWord[]) => {
  const runs: { word: LyricWord; prefix: string; suffix?: string }[] = [];
  let cursor = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const idx = lineText.indexOf(word.text, cursor);
    if (idx === -1) {
      const prefix = i === 0 ? '' : ' ';
      runs.push({ word, prefix });
      continue;
    }
    const prefix = lineText.slice(cursor, idx);
    runs.push({ word, prefix });
    cursor = idx + word.text.length;
  }

  const trailing = lineText.slice(cursor);
  if (runs.length > 0 && trailing) {
    runs[runs.length - 1].suffix = trailing;
  }

  return runs;
};

export const normalizeLyricsTiming = (lyrics: ParsedLyrics, durationMs?: number): ParsedLyrics => {
  if (!lyrics || lyrics.lines.length === 0) return lyrics;

  const lines = lyrics.lines.map((line) => ({
    ...line,
    words: line.words.map((word) => ({ ...word })),
  }));

  const fallbackDuration =
    typeof durationMs === 'number' && Number.isFinite(durationMs) ? durationMs : undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLineStart = lines[i + 1]?.startTime;

    // Default strategy: End at next line start (minus buffer) or use a reasonable duration
    let lineEnd = nextLineStart;

    if (typeof lineEnd === 'number' && lineEnd > line.startTime) {
      // If next line exists, end just before it (50ms gap) to allow breathing room
      lineEnd = Math.max(line.startTime + 100, lineEnd - 50);
    } else {
      // Last line or invalid next start
      if (fallbackDuration && fallbackDuration > line.startTime) {
        lineEnd = fallbackDuration;
      } else {
        // Fallback: Estimate based on text length or last word
        const lastWordEnd =
          line.words.length > 0
            ? line.words[line.words.length - 1].startTime + 500
            : line.startTime + 5000;
        lineEnd = lastWordEnd;
      }
    }

    // Ensure strictly positive duration
    lineEnd = Math.max(lineEnd, line.startTime + 500);
    line.endTime = lineEnd;

    // Normalize words within the line
    if (line.words.length > 0) {
      for (let w = 0; w < line.words.length; w++) {
        const word = line.words[w];
        const nextWord = line.words[w + 1];

        let wordEnd = nextWord ? nextWord.startTime : lineEnd;

        // Safety: ensure word doesn't end after line
        wordEnd = Math.min(wordEnd, lineEnd);

        // Safety: ensure positive duration
        if (wordEnd <= word.startTime) {
          wordEnd = word.startTime + 200; // Minimal word duration
        }

        word.endTime = wordEnd;
      }

      // Ensure last word aligns with line end if it was cut short
      const lastWord = line.words[line.words.length - 1];
      if (lastWord.endTime < lineEnd) {
        lastWord.endTime = lineEnd;
      }
    }

    // Re-calculate runs after normalization since timing might have shifted (though text didn't)
    // Actually runs depend on text, so we can do it here.
    line.runs = buildWordRuns(line.text, line.words);
  }

  return { ...lyrics, lines };
};

interface RawLyricWord {
  text: string;
  time: number;
}

/**
 * Parse enhanced LRC line with word-level timestamps
 * Format: <mm:ss.xx>Word1 <mm:ss.xx>Word2 <mm:ss.xx>Word3
 */
const parseEnhancedLine = (content: string): { words: RawLyricWord[]; text: string } => {
  const words: RawLyricWord[] = [];
  const matches = Array.from(content.matchAll(/<(\d+:\d+(?:\.\d+)?)>/g));
  const text = content
    .replace(/<(\d+:\d+(?:\.\d+)?)>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (matches.length === 0) {
    return { words, text };
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const next = matches[i + 1];
    const time = parseLrcTime(match[1]);
    const startIndex = (match.index ?? 0) + match[0].length;
    const endIndex = next?.index ?? content.length;
    const rawText = content.slice(startIndex, endIndex);
    const cleaned = rawText.trim();
    if (!cleaned) continue;
    words.push({ text: cleaned, time });
  }

  const prefix = matches[0]?.index ? content.slice(0, matches[0].index).trim() : '';
  if (prefix && words.length > 0) {
    words[0].text = `${prefix} ${words[0].text}`.trim();
  }

  return { words, text };
};

/**
 * Find the current line index based on playback time
 */
export const getCurrentLineIndex = (lyrics: ParsedLyrics, currentTimeMs: number): number => {
  const { lines } = lyrics;

  if (lines.length === 0) return -1;

  // Find the line that's currently playing (last line whose start time has passed)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (currentTimeMs >= lines[i].startTime) {
      return i;
    }
  }

  // Before first line - return -1 so we can show "header" space
  return -1;
};

/**
 * Get lines to display (2 before, current, 2 after)
 * Returns (null | LyricLine)[] to maintain fixed window size for centering
 */
export const getDisplayLines = (
  lyrics: ParsedLyrics,
  currentIndex: number,
  count: number = 5,
): { line: LyricLine | null; index: number; isCurrent: boolean }[] => {
  const { lines } = lyrics;
  const result: { line: LyricLine | null; index: number; isCurrent: boolean }[] = [];

  const half = Math.floor(count / 2);

  // Simply iterate from -half to +half relative to current
  // This allows indices < 0 and >= length to be handled as nulls
  for (let offset = -half; offset <= half; offset++) {
    const targetIndex = currentIndex + offset;

    if (targetIndex >= 0 && targetIndex < lines.length) {
      result.push({
        line: lines[targetIndex],
        index: targetIndex,
        isCurrent: offset === 0,
      });
    } else {
      result.push({
        line: null, // Placeholder for out of bounds
        index: targetIndex,
        isCurrent: false,
      });
    }
  }

  return result;
};

/**
 * Get the current word index within a line based on playback time
 */
export const getCurrentWordIndex = (line: LyricLine, currentTimeMs: number): number => {
  const { words } = line;

  if (words.length === 0) return -1;

  // Find the word that's currently being sung
  for (let i = words.length - 1; i >= 0; i--) {
    if (currentTimeMs >= words[i].startTime) {
      return i;
    }
  }

  return -1;
};
