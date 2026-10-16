import { useEffect, useState } from 'react';
import type { DebugStatus } from '@shared/ipc';
import { usePreferences } from '../../preferences/usePreferences';
import type { DockSide } from '../../preferences/store';
import { clampSnapTolerance, MAX_SNAP_TOLERANCE, MIN_SNAP_TOLERANCE, SNAP_KEYS, type SnapKey } from '../../world3d/scene/edit/snap-key';
import type { SettingsSectionProps } from './sections';

const DOCK_CHOICES: readonly { side: DockSide; label: string }[] = [
  { side: 'bottom', label: 'Under the world' },
  { side: 'right', label: 'Beside the world' },
];

const SNAP_LABELS: Record<SnapKey, string> = { alt: 'Alt', ctrl: 'Ctrl', shift: 'Shift' };

/** Local preferences: each change applies at once, so there is no Save. */
export function PreferencesSection(_props: SettingsSectionProps): React.JSX.Element {
  const [preferences, update] = usePreferences();
  const [debug, setDebug] = useState<DebugStatus | null>(null);
  const [debugError, setDebugError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void window.api?.debugStatus().then((r) => {
      if (live && r.ok) setDebug(r.value);
    });
    return () => {
      live = false;
    };
  }, []);

  const switchDebug = async (on: boolean): Promise<void> => {
    setDebugError(null);
    const r = await window.api.debugSetEnabled(on);
    if (r.ok) setDebug(r.value);
    else setDebugError(r.error.message);
  };

  return (
    <div className="settings-prefs">
      <h2 className="settings-prefs__heading">Layout</h2>
      <fieldset className="settings-prefs__group">
        <legend>Quest dock</legend>
        {DOCK_CHOICES.map(({ side, label }) => (
          <label key={side} className="settings-prefs__choice">
            <input type="radio" name="dock-side" checked={preferences.dockSide === side} onChange={() => update({ dockSide: side })} />
            {label}
          </label>
        ))}
      </fieldset>

      <h2 className="settings-prefs__heading">3D view</h2>
      <fieldset className="settings-prefs__group">
        <legend>Snap to surface while dragging</legend>
        {SNAP_KEYS.map((key) => (
          <label key={key} className="settings-prefs__choice">
            <input type="radio" name="snap-key" checked={preferences.snapKey === key} onChange={() => update({ snapKey: key })} />
            Hold {SNAP_LABELS[key]}
          </label>
        ))}
        <p className="settings-prefs__note">
          Hold this key while you drag the handles to put NPCs, objects and path points on the terrain or building floor under them.
        </p>
        <label className="settings-prefs__choice">
          Floor tolerance (yards)
          <input
            type="number"
            min={MIN_SNAP_TOLERANCE}
            max={MAX_SNAP_TOLERANCE}
            step={0.1}
            value={preferences.snapTolerance}
            onChange={(e) => update({ snapTolerance: clampSnapTolerance(e.target.valueAsNumber) })}
          />
        </label>
        <p className="settings-prefs__note">
          After a snap, the server's floor replaces the surface you snapped to only when it is this close. A floor farther away is another level, so the snapped height stays. Pasted objects within this distance of the floor also go down on it.
        </p>
      </fieldset>

      <h2 className="settings-prefs__heading">Diagnostics</h2>
      <div className="settings-prefs__group">
        <label className="settings-prefs__choice">
          <input type="checkbox" checked={debug?.enabled ?? false} disabled={debug === null} onChange={(e) => void switchDebug(e.target.checked)} />
          Debug mode
        </label>
        <p className="settings-prefs__note">
          Records key codes and focus changes, window and dialog events, and errors, so a problem like text fields that stop typing can be traced; never the characters you type or what is in a field.
        </p>
        {debug?.logFile && <p className="settings-prefs__note">Log file: {debug.logFile}</p>}
        {debugError && (
          <p className="settings-prefs__error" role="alert">
            {debugError}
          </p>
        )}
      </div>
    </div>
  );
}
