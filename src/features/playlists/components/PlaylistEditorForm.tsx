import { clsx } from 'clsx';
import { FolderSync, Music, Sparkles } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '../../../components/ui/button';
import { reportError } from '../../../lib/report-error';
import { selectLibraryFolder } from '../../../lib/tauri-commands';
import { zodResolver } from '../../../lib/validation/resolver';
import { useSettingsStore } from '../../../store/settings-store';
import type { BackendSmartPlaylistRule, PlaylistType } from '../../../types';
import { getPlaylistEditorDefaults, toBackendRule } from '../forms/playlistEditor.defaults';
import {
  PlaylistEditorFormSchema,
  type PlaylistEditorFormValues,
} from '../forms/playlistEditor.schema';

interface PlaylistEditorFormProps {
  mode: 'create' | 'edit';
  isSaving?: boolean;
  initial?: {
    name?: string;
    playlistType?: PlaylistType;
    smartRules?: BackendSmartPlaylistRule[];
    folderPath?: string;
  };
  onCancel: () => void;
  onSave: (payload: {
    name: string;
    playlistType: PlaylistType;
    smartRules?: BackendSmartPlaylistRule[];
    folderPath?: string;
  }) => Promise<void> | void;
}

export const PlaylistEditorForm = memo(
  ({ mode, isSaving = false, initial, onCancel, onSave }: PlaylistEditorFormProps) => {
    const { theme } = useSettingsStore(useShallow((s) => ({ theme: s.theme })));
    const isNeobrutalism = theme === 'neobrutalism';
    const {
      register,
      handleSubmit,
      watch,
      setValue,
      reset,
      formState: { errors, isValid },
    } = useForm<PlaylistEditorFormValues>({
      resolver: zodResolver(PlaylistEditorFormSchema),
      defaultValues: getPlaylistEditorDefaults(initial),
      mode: 'onChange',
    });

    useEffect(() => {
      reset(getPlaylistEditorDefaults(initial));
    }, [initial, reset]);

    const playlistType = watch('playlistType');
    const ruleKind = watch('ruleKind');

    const handleBrowseFolder = async () => {
      try {
        const selected = await selectLibraryFolder();
        if (selected) {
          setValue('folderPath', selected.path, { shouldValidate: true, shouldDirty: true });
        }
      } catch (error) {
        reportError('Failed to select folder for playlist', {
          source: 'playlist-editor-form',
          error,
        });
      }
    };

    const onSubmit = async (data: PlaylistEditorFormValues) => {
      try {
        await onSave({
          name: data.name.trim(),
          playlistType: data.playlistType,
          folderPath: data.playlistType === 'FolderSync' ? data.folderPath?.trim() : undefined,
          smartRules:
            data.playlistType === 'Smart'
              ? toBackendRule(data.ruleKind, data.ruleValues)
              : undefined,
        });
      } catch (error) {
        reportError('Failed to save playlist', { source: 'playlist-editor-form', error });
      }
    };

    return (
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label
            className={clsx(
              'block text-sm mb-1',
              isNeobrutalism ? 'font-black uppercase text-black' : 'text-text-secondary',
            )}
          >
            Name
          </label>
          <input
            {...register('name')}
            type="text"
            className={clsx(
              'w-full px-3 py-2 outline-none transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-standard)]',
              isNeobrutalism
                ? 'bg-white border-2 border-black rounded-none shadow-[3px_3px_0_0_#000] focus:shadow-[5px_5px_0_0_#000] focus:-translate-x-0.5 focus:-translate-y-0.5 text-black font-bold placeholder:text-black/40'
                : 'bg-surface-light text-text-primary rounded-lg border border-zinc-700 focus:ring-2 focus:ring-primary',
            )}
            placeholder="My playlist"
          />
          {errors.name && (
            <p className="text-xs text-red-500 font-bold mt-1">{errors.name.message}</p>
          )}
        </div>

        <div>
          <label
            className={clsx(
              'block text-sm mb-2',
              isNeobrutalism ? 'font-black uppercase text-black' : 'text-text-secondary',
            )}
          >
            Type
          </label>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Playlist type">
            {[
              { type: 'Manual' as const, label: 'Manual', icon: Music },
              { type: 'Smart' as const, label: 'Smart', icon: Sparkles },
              { type: 'FolderSync' as const, label: 'Folder', icon: FolderSync },
            ].map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={playlistType === type}
                aria-pressed={playlistType === type}
                onClick={() =>
                  setValue('playlistType', type, { shouldValidate: true, shouldDirty: true })
                }
                className={clsx(
                  'flex items-center justify-center gap-2 px-3 py-2 text-sm transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom]',
                  isNeobrutalism
                    ? [
                        'rounded-none border-2 border-black font-black uppercase tracking-tight',
                        playlistType === type
                          ? 'bg-[#ffdb70] shadow-[3px_3px_0_0_#000] -translate-x-0.5 -translate-y-0.5 text-black'
                          : 'bg-white text-black/60 hover:text-black hover:bg-[#fffef0]',
                      ]
                    : [
                        'rounded-lg border',
                        playlistType === type
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-zinc-700 text-text-secondary hover:bg-surface-light',
                      ],
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {playlistType === 'Smart' && (
          <div
            className={clsx(
              'space-y-3 p-4',
              isNeobrutalism
                ? 'border-2 border-black bg-white rounded-none shadow-[4px_4px_0_0_#000]'
                : 'rounded-xl border border-zinc-800 bg-black/10',
            )}
          >
            <label
              className={clsx(
                'block text-sm',
                isNeobrutalism ? 'font-black uppercase text-black' : 'text-text-secondary',
              )}
            >
              Smart rule
            </label>
            <select
              {...register('ruleKind')}
              className={clsx(
                'w-full px-3 py-2 outline-none transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-standard)]',
                isNeobrutalism
                  ? 'bg-white border-2 border-black rounded-none text-black font-bold appearance-none cursor-pointer hover:bg-[#fffef0]'
                  : 'bg-surface-light text-text-primary rounded-lg border border-zinc-700 focus:ring-2 focus:ring-primary',
              )}
            >
              <option value="RecentlyAdded">Recently Added</option>
              <option value="MostPlayed">Most Played</option>
              <option value="TopRated">Top Rated</option>
              <option value="ByArtist">By Artist</option>
              <option value="ByAlbum">By Album</option>
              <option value="ByYear">By Year</option>
              <option value="LongerThan">Longer Than</option>
              <option value="ShorterThan">Shorter Than</option>
            </select>

            {ruleKind === 'RecentlyAdded' && (
              <div>
                <label
                  className={clsx(
                    'block text-xs mb-1',
                    isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                  )}
                >
                  Days
                </label>
                <input
                  {...register('ruleValues.days')}
                  type="number"
                  min={1}
                  className={clsx(
                    'w-full px-3 py-2',
                    isNeobrutalism
                      ? 'bg-white border-2 border-black rounded-none text-black font-bold'
                      : 'bg-surface-light text-text-primary rounded-lg border border-zinc-700',
                  )}
                />
              </div>
            )}

            {ruleKind === 'MostPlayed' && (
              <div>
                <label
                  className={clsx(
                    'block text-xs mb-1',
                    isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                  )}
                >
                  Min plays
                </label>
                <input
                  {...register('ruleValues.minPlays')}
                  type="number"
                  min={1}
                  className={clsx(
                    'w-full px-3 py-2',
                    isNeobrutalism
                      ? 'bg-white border-2 border-black rounded-none text-black font-bold'
                      : 'bg-surface-light text-text-primary rounded-lg border border-zinc-700',
                  )}
                />
              </div>
            )}

            {ruleKind === 'TopRated' && (
              <div>
                <label
                  className={clsx(
                    'block text-xs mb-1',
                    isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                  )}
                >
                  Min rating (0-5)
                </label>
                <input
                  {...register('ruleValues.minRating')}
                  type="number"
                  min={0}
                  max={5}
                  className={clsx(
                    'w-full px-3 py-2',
                    isNeobrutalism
                      ? 'bg-white border-2 border-black rounded-none text-black font-bold'
                      : 'bg-surface-light text-text-primary rounded-lg border border-zinc-700',
                  )}
                />
              </div>
            )}

            {ruleKind === 'ByArtist' && (
              <div>
                <label
                  className={clsx(
                    'block text-xs mb-1',
                    isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                  )}
                >
                  Artist contains
                </label>
                <input
                  {...register('ruleValues.artist')}
                  className={clsx(
                    'w-full px-3 py-2',
                    isNeobrutalism
                      ? 'bg-white border-2 border-black rounded-none text-black font-bold'
                      : 'bg-surface-light text-text-primary rounded-lg border border-zinc-700',
                  )}
                />
              </div>
            )}

            {ruleKind === 'ByAlbum' && (
              <div>
                <label
                  className={clsx(
                    'block text-xs mb-1',
                    isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                  )}
                >
                  Album contains
                </label>
                <input
                  {...register('ruleValues.album')}
                  className={clsx(
                    'w-full px-3 py-2',
                    isNeobrutalism
                      ? 'bg-white border-2 border-black rounded-none text-black font-bold'
                      : 'bg-surface-light text-text-primary rounded-lg border border-zinc-700',
                  )}
                />
              </div>
            )}

            {ruleKind === 'ByYear' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    className={clsx(
                      'block text-xs mb-1',
                      isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                    )}
                  >
                    Start year
                  </label>
                  <input
                    {...register('ruleValues.startYear')}
                    type="number"
                    className={clsx(
                      'w-full px-3 py-2',
                      isNeobrutalism
                        ? 'bg-white border-2 border-black rounded-none text-black font-bold'
                        : 'bg-surface-light text-text-primary rounded-lg border border-zinc-700',
                    )}
                  />
                </div>
                <div>
                  <label
                    className={clsx(
                      'block text-xs mb-1',
                      isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                    )}
                  >
                    End year
                  </label>
                  <input
                    {...register('ruleValues.endYear')}
                    type="number"
                    className={clsx(
                      'w-full px-3 py-2',
                      isNeobrutalism
                        ? 'bg-white border-2 border-black rounded-none text-black font-bold'
                        : 'bg-surface-light text-text-primary rounded-lg border border-zinc-700',
                    )}
                  />
                </div>
              </div>
            )}

            {(ruleKind === 'LongerThan' || ruleKind === 'ShorterThan') && (
              <div>
                <label
                  className={clsx(
                    'block text-xs mb-1',
                    isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                  )}
                >
                  Seconds
                </label>
                <input
                  {...register('ruleValues.seconds')}
                  type="number"
                  min={0}
                  className={clsx(
                    'w-full px-3 py-2',
                    isNeobrutalism
                      ? 'bg-white border-2 border-black rounded-none text-black font-bold'
                      : 'bg-surface-light text-text-primary rounded-lg border border-zinc-700',
                  )}
                />
              </div>
            )}
            {errors.ruleValues?.root?.message && (
              <p className="text-xs text-red-500 font-bold mt-1">
                {errors.ruleValues.root.message}
              </p>
            )}
          </div>
        )}

        {playlistType === 'FolderSync' && (
          <div
            className={clsx(
              'space-y-2 p-4',
              isNeobrutalism
                ? 'border-2 border-black bg-white rounded-none shadow-[4px_4px_0_0_#000]'
                : 'rounded-xl border border-zinc-800 bg-black/10',
            )}
          >
            <label
              className={clsx(
                'block text-sm',
                isNeobrutalism ? 'font-black uppercase text-black' : 'text-text-secondary',
              )}
            >
              Folder path
            </label>
            <div className="flex gap-2">
              <input
                {...register('folderPath')}
                className={clsx(
                  'flex-1 px-3 py-2 outline-none transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-standard)]',
                  isNeobrutalism
                    ? 'bg-white border-2 border-black rounded-none text-black font-bold placeholder:text-black/40'
                    : 'bg-surface-light text-text-primary rounded-lg border border-zinc-700',
                )}
                placeholder="/Music/Arabic"
              />
              <Button
                type="button"
                variant={isNeobrutalism ? 'default' : 'secondary'}
                onClick={handleBrowseFolder}
              >
                Browse
              </Button>
            </div>
            {errors.folderPath && (
              <p className="text-xs text-red-500 font-bold mt-1">{errors.folderPath.message}</p>
            )}
          </div>
        )}

        {errors.root && <p className="text-sm text-red-500 font-bold">{errors.root.message}</p>}

        <footer className="mt-6 flex items-center justify-end gap-3">
          <Button
            type="button"
            variant={isNeobrutalism ? 'default' : 'ghost'}
            onClick={onCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving || !isValid} variant="default">
            {isSaving ? 'Saving...' : mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </footer>
      </form>
    );
  },
);

PlaylistEditorForm.displayName = 'PlaylistEditorForm';
