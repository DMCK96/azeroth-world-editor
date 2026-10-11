import { useEffect, useRef, useState } from 'react';
import type { Api, UpdateOffer } from '@shared/ipc';
import { parseNotes, type NoteBlock, type NoteSpan } from '@core/updates/notes';
import { trapTab } from '../components/trap-tab';
import './ProjectDialog.css';
import './UpdateDialog.css';

type UpdateApi = Pick<Api, 'updateCheck' | 'updateSkip' | 'updateOpen'>;

const Spans = ({ spans }: { spans: NoteSpan[] }): React.JSX.Element => (
  <>
    {spans.map((s, i) => (s.bold ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>))}
  </>
);

/** One release's notes. Every piece is printed as text, so nothing in a note can become markup or a link. */
function Notes({ body }: { body: string }): React.JSX.Element {
  const blocks = parseNotes(body);
  if (blocks.length === 0) return <p className="update-dialog__none">No release notes.</p>;
  const out: React.JSX.Element[] = [];
  let bullets: Extract<NoteBlock, { kind: 'bullet' }>[] = [];
  const flush = (): void => {
    if (bullets.length === 0) return;
    const items = bullets;
    out.push(
      <ul key={`ul${out.length}`}>
        {items.map((b, i) => (
          <li key={i}>
            <Spans spans={b.spans} />
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  for (const block of blocks) {
    if (block.kind === 'bullet') {
      bullets.push(block);
      continue;
    }
    flush();
    out.push(
      block.kind === 'heading' ? (
        <h4 key={out.length}>
          <Spans spans={block.spans} />
        </h4>
      ) : (
        <p key={out.length}>
          <Spans spans={block.spans} />
        </p>
      ),
    );
  }
  flush();
  return <>{out}</>;
}

/**
 * Tells the user a newer release is out, once per launch: the installed and the latest version and the
 * notes of every release in between. Remind me later only closes it (it comes back next launch), Skip
 * this update keeps it quiet until a newer version, and Update opens the release page. It waits while
 * `blocked` (the recovery dialog is up) and never asks twice.
 */
export function UpdateDialog({ api, blocked }: { api: UpdateApi | undefined; blocked: boolean }): React.JSX.Element | null {
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(false);
  const dialog = useRef<HTMLDivElement | null>(null);
  const primary = useRef<HTMLButtonElement | null>(null);
  const visible = offer !== null && !dismissed && !blocked;

  useEffect(() => {
    if (!api || asked.current) return;
    asked.current = true;
    void api.updateCheck().then((result) => {
      if (result.ok) setOffer(result.value);
    });
  }, [api]);

  // Focus moves in on opening and back to what had it on closing.
  useEffect(() => {
    if (!visible) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    primary.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [visible]);

  if (!visible || !api) return null;

  const close = (): void => setDismissed(true);
  const act = async (work: () => ReturnType<UpdateApi['updateSkip']>): Promise<void> => {
    const result = await work();
    if (result.ok) close();
    else setError(result.error.message);
  };

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="modal update-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-title"
        ref={dialog}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          else trapTab(e, dialog.current);
        }}
      >
        <header className="modal__header">
          <h2 id="update-title">Update available</h2>
        </header>
        <p className="update-dialog__versions">
          Installed <span className="update-dialog__current">{offer.current}</span> · Latest{' '}
          <span className="update-dialog__latest">{offer.latest}</span>
        </p>
        <div className="update-dialog__notes">
          {offer.notes.map((note) => (
            <section key={note.version}>
              <h3>{note.title}</h3>
              <Notes body={note.body} />
            </section>
          ))}
        </div>
        {error && (
          <p role="alert" className="update-dialog__error">
            {error}
          </p>
        )}
        <div className="update-dialog__actions">
          <button type="button" className="btn" onClick={close}>
            Remind me later
          </button>
          <button type="button" className="btn" onClick={() => void act(() => api.updateSkip(offer.latest))}>
            Skip this update
          </button>
          <button type="button" className="btn btn--primary" ref={primary} onClick={() => void act(() => api.updateOpen(offer.releaseUrl))}>
            Update
          </button>
        </div>
      </div>
    </div>
  );
}
