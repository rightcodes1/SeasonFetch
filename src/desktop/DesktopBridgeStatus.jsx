import { useEffect, useState } from 'react';
import { getDesktopStatus, isDesktopShell, listenForDesktopStatus } from './bridge.js';

export default function DesktopBridgeStatus() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isDesktopShell()) return undefined;

    let active = true;
    let unlisten;

    listenForDesktopStatus(payload => {
      if (active) setStatus(payload);
    })
      .then(stopListening => {
        if (active) unlisten = stopListening;
        else stopListening();
      })
      .then(() => getDesktopStatus())
      .then(payload => {
        if (active) setStatus(payload);
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  if (!isDesktopShell()) return null;

  return (
    <span className="desktop-bridge-status" role="status" aria-live="polite">
      {error ? `Desktop bridge error: ${error}` : status ? `Native bridge connected · ${status.platform}` : 'Connecting native bridge…'}
    </span>
  );
}
