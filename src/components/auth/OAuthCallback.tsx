import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.ts';

export function OAuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setError('Supabase not configured');
      return;
    }

    // Supabase handles the hash fragment automatically via onAuthStateChange.
    // This page just shows a loading state while that happens.
    // If the URL has an error parameter, display it.
    const params = new URLSearchParams(window.location.search);
    const errParam = params.get('error_description') || params.get('error');
    if (errParam) {
      setError(errParam);
    }
  }, []);

  if (error) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        color: 'var(--red)',
        fontSize: '14px',
      }}>
        Authentication error: {error}
      </div>
    );
  }

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-base)',
      color: 'var(--text-secondary)',
      fontSize: '14px',
    }}>
      Signing you in...
    </div>
  );
}
