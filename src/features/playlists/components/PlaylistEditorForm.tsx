import { clsx } from 'clsx';
import { FolderSync, Music, Sparkles } from 'lucide-react';
import { memo, useEffect, useId } from 'react';
import { useForm } from 'react-hook-form';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/Input';
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
  }) => Promise<boolean | undefined> | boolean | undefined;
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
    const formId = useId();
    const fieldId = (name: string) => `${formId}-${name}`;
    const initialKey = JSON.stringify(initial ?? null);

    useEffect(() => {
      reset(getPlaylistEditorDefaults(initial));
    }, [initialKey, reset]);

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
        return false;
      }
    };

    return (
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label
            htmlFor={fieldId('name')}
            className={clsx(
              'block text-sm mb-1',
              isNeobrutalism ? 'font-black uppercase text-black' : 'text-text-secondary',
            )}
          >
            Name
          </label>
          <Input
            id={fieldId('name')}
            {...register('name')}
            type="text"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? fieldId('name-error') : undefined}
            theme={isNeobrutalism ? 'neobrutalism' : 'liquid-glass'}
            className="w-full px-3 py-2"
            placeholder="My playlist"
          />
          {errors.name && (
            <p
              id={fieldId('name-error')}
              className="mt-1 text-xs font-bold text-[var(--state-error-ink)]"
              role="alert"
            >
              {errors.name.message}
            </p>
          )}
        </div>

        <div>
          <label
            id={fieldId('type-label')}
            className={clsx(
              'block text-sm mb-2',
              isNeobrutalism ? 'font-black uppercase text-black' : 'text-text-secondary',
            )}
          >
            Type
          </label>
          <div
            className="grid grid-cols-3 gap-2"
            role="radiogroup"
            aria-labelledby={fieldId('type-label')}
          >
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
                        'rounded-none border-2 border-black font-black uppercase tracking-normal',
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
              htmlFor={fieldId('rule-kind')}
              className={clsx(
                'block text-sm',
                isNeobrutalism ? 'font-black uppercase text-black' : 'text-text-secondary',
              )}
            >
              Smart rule
            </label>
            <select
              id={fieldId('rule-kind')}
              {...register('ruleKind')}
              aria-describedby={errors.ruleValues?.root ? fieldId('rule-values-error') : undefined}
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
              <option value="ByGenre">By Genre</option>
              <option value="ByYear">By Year</option>
              <option value="LongerThan">Longer Than</option>
              <option value="ShorterThan">Shorter Than</option>
            </select>

            {ruleKind === 'RecentlyAdded' && (
              <div>
                <label
                  htmlFor={fieldId('rule-days')}
                  className={clsx(
                    'block text-xs mb-1',
                    isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                  )}
                >
                  Days
                </label>
                <Input
                  id={fieldId('rule-days')}
                  {...register('ruleValues.days')}
                  type="number"
                  min={1}
                  theme={isNeobrutalism ? 'neobrutalism' : 'liquid-glass'}
                  className="w-full px-3 py-2"
                />
              </div>
            )}

            {ruleKind === 'MostPlayed' && (
              <div>
                <label
                  htmlFor={fieldId('rule-min-plays')}
                  className={clsx(
                    'block text-xs mb-1',
                    isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                  )}
                >
                  Min plays
                </label>
                <Input
                  id={fieldId('rule-min-plays')}
                  {...register('ruleValues.minPlays')}
                  type="number"
                  min={1}
                  theme={isNeobrutalism ? 'neobrutalism' : 'liquid-glass'}
                  className="w-full px-3 py-2"
                />
              </div>
            )}

            {ruleKind === 'TopRated' && (
              <div>
                <label
                  htmlFor={fieldId('rule-min-rating')}
                  className={clsx(
                    'block text-xs mb-1',
                    isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                  )}
                >
                  Min rating (0-5)
                </label>
                <Input
                  id={fieldId('rule-min-rating')}
                  {...register('ruleValues.minRating')}
                  type="number"
                  min={0}
                  max={5}
                  theme={isNeobrutalism ? 'neobrutalism' : 'liquid-glass'}
                  className="w-full px-3 py-2"
                />
              </div>
            )}

            {ruleKind === 'ByArtist' && (
              <div>
                <label
                  htmlFor={fieldId('rule-artist')}
                  className={clsx(
                    'block text-xs mb-1',
                    isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                  )}
                >
                  Artist contains
                </label>
                <Input
                  id={fieldId('rule-artist')}
                  {...register('ruleValues.artist')}
                  theme={isNeobrutalism ? 'neobrutalism' : 'liquid-glass'}
                  className="w-full px-3 py-2"
                />
              </div>
            )}

            {ruleKind === 'ByAlbum' && (
              <div>
                <label
                  htmlFor={fieldId('rule-album')}
                  className={clsx(
                    'block text-xs mb-1',
                    isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                  )}
                >
                  Album contains
                </label>
                <Input
                  id={fieldId('rule-album')}
                  {...register('ruleValues.album')}
                  theme={isNeobrutalism ? 'neobrutalism' : 'liquid-glass'}
                  className="w-full px-3 py-2"
                />
              </div>
            )}

            {ruleKind === 'ByGenre' && (
              <div>
                <label
                  htmlFor={fieldId('rule-genre')}
                  className={clsx(
                    'block text-xs mb-1',
                    isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                  )}
                >
                  Genre contains
                </label>
                <Input
                  id={fieldId('rule-genre')}
                  {...register('ruleValues.genre')}
                  theme={isNeobrutalism ? 'neobrutalism' : 'liquid-glass'}
                  className="w-full px-3 py-2"
                />
              </div>
            )}

            {ruleKind === 'ByYear' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor={fieldId('rule-start-year')}
                    className={clsx(
                      'block text-xs mb-1',
                      isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                    )}
                  >
                    Start year
                  </label>
                  <Input
                    id={fieldId('rule-start-year')}
                    {...register('ruleValues.startYear')}
                    type="number"
                    theme={isNeobrutalism ? 'neobrutalism' : 'liquid-glass'}
                    className="w-full px-3 py-2"
                  />
                </div>
                <div>
                  <label
                    htmlFor={fieldId('rule-end-year')}
                    className={clsx(
                      'block text-xs mb-1',
                      isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                    )}
                  >
                    End year
                  </label>
                  <Input
                    id={fieldId('rule-end-year')}
                    {...register('ruleValues.endYear')}
                    type="number"
                    theme={isNeobrutalism ? 'neobrutalism' : 'liquid-glass'}
                    className="w-full px-3 py-2"
                  />
                </div>
              </div>
            )}

            {(ruleKind === 'LongerThan' || ruleKind === 'ShorterThan') && (
              <div>
                <label
                  htmlFor={fieldId('rule-seconds')}
                  className={clsx(
                    'block text-xs mb-1',
                    isNeobrutalism ? 'font-bold text-black' : 'text-text-muted',
                  )}
                >
                  Seconds
                </label>
                <Input
                  id={fieldId('rule-seconds')}
                  {...register('ruleValues.seconds')}
                  type="number"
                  min={0}
                  theme={isNeobrutalism ? 'neobrutalism' : 'liquid-glass'}
                  className="w-full px-3 py-2"
                />
              </div>
            )}
            {errors.ruleValues?.root?.message && (
              <p
                id={fieldId('rule-values-error')}
                className="mt-1 text-xs font-bold text-[var(--state-error-ink)]"
                role="alert"
              >
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
              htmlFor={fieldId('folder-path')}
              className={clsx(
                'block text-sm',
                isNeobrutalism ? 'font-black uppercase text-black' : 'text-text-secondary',
              )}
            >
              Folder path
            </label>
            <div className="flex gap-2">
              <Input
                id={fieldId('folder-path')}
                {...register('folderPath')}
                aria-invalid={Boolean(errors.folderPath)}
                aria-describedby={errors.folderPath ? fieldId('folder-path-error') : undefined}
                theme={isNeobrutalism ? 'neobrutalism' : 'liquid-glass'}
                className="flex-1 px-3 py-2"
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
              <p
                id={fieldId('folder-path-error')}
                className="mt-1 text-xs font-bold text-[var(--state-error-ink)]"
                role="alert"
              >
                {errors.folderPath.message}
              </p>
            )}
          </div>
        )}

        {errors.root && (
          <p className="text-sm font-bold text-[var(--state-error-ink)]" role="alert">
            {errors.root.message}
          </p>
        )}

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
