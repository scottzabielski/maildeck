import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.ts';

export function OAuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setError('Supabase not configured');
      return;
    }

    // Check for error in URL params
    const params = new URLSearchParams(window.location.search);
    const errParam = params.get('error_description') || params.get('error');
    if (errParam) {
      setError(errParam);
      return;
    }

    // The magic link puts tokens in the hash fragment.
    // Supabase client automatically picks them up via onAuthStateChange.
    // Once the session is established, redirect to the app root.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        // Clean up URL and redirect to app
        window.location.replace('/');
      }
    });

    // Also check if session is already available (e.g. page was slow to load)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        window.location.replace('/');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (error) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
        gap: '12px',
      }}>
        <div style={{ color: 'var(--red)', fontSize: '14px' }}>
          Authentication error: {error}
        </div>
        <a href="/" style={{ color: 'var(--blue)', fontSize: '13px' }}>
          Back to login
        </a>
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
