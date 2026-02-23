import { useState } from 'react';
import { Icons } from '../ui/Icons.tsx';
import { useAuth } from '../../hooks/useAuth.ts';

export function LoginPage() {
  const { signInWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: err } = await signInWithEmail(email);
    setLoading(false);

    if (err) {
      setError(err.message);
    } else {
      setSent(true);
    }
  };

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-base)',
    }}>
      <div style={{
        width: '380px',
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: '40px 32px',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '32px',
          justifyContent: 'center',
        }}>
          <Icons.Mail />
          <span style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '20px',
            color: 'var(--text-primary)',
          }}>
            MailDeck
          </span>
        </div>

        {sent ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: '15px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '8px',
            }}>
              Check your email
            </div>
            <div style={{
              fontSize: '13px',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}>
              We sent a magic link to <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>.
              Click the link to sign in.
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{
              fontSize: '15px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '4px',
              textAlign: 'center',
            }}>
              Sign in to MailDeck
            </div>
            <div style={{
              fontSize: '13px',
              color: 'var(--text-tertiary)',
              marginBottom: '24px',
              textAlign: 'center',
            }}>
              Enter your email to receive a magic link
            </div>

            <input
              type="email"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                fontFamily: 'var(--font-body)',
                fontSize: '14px',
                padding: '10px 14px',
                background: 'var(--bg-base)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                outline: 'none',
                marginBottom: '12px',
              }}
            />

            {error && (
              <div style={{
                fontSize: '12px',
                color: 'var(--red)',
                marginBottom: '12px',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                fontSize: '13px',
                fontWeight: 600,
                padding: '10px',
                borderRadius: 'var(--radius-md)',
                color: 'white',
                background: loading ? 'var(--text-tertiary)' : 'var(--blue)',
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--font-body)',
              }}
            >
              {loading ? 'Sending...' : 'Send Magic Link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
