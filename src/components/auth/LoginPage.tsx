import { useState } from 'react';
import { Icons } from '../ui/Icons.tsx';
import { useAuth } from '../../hooks/useAuth.ts';

export function LoginPage() {
  const { signInWithEmail, verifyEmailOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

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

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setVerifying(true);

    const { error: err } = await verifyEmailOtp(email, code.trim());
    setVerifying(false);

    if (err) {
      setError(err.message);
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
          <form onSubmit={handleVerify}>
            <div style={{
              fontSize: '15px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '8px',
              textAlign: 'center',
            }}>
              Check your email
            </div>
            <div style={{
              fontSize: '13px',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              marginBottom: '20px',
              textAlign: 'center',
            }}>
              We sent a magic link and an 8-digit code to{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>.
              Click the link or enter the code below.
            </div>

            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="00000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              maxLength={8}
              autoFocus
              style={{
                width: '100%',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '20px',
                letterSpacing: '0.4em',
                textAlign: 'center',
                padding: '12px 14px',
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
                textAlign: 'center',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={verifying || code.length !== 8}
              style={{
                width: '100%',
                fontSize: '13px',
                fontWeight: 600,
                padding: '10px',
                borderRadius: 'var(--radius-md)',
                color: 'white',
                background: verifying || code.length !== 8 ? 'var(--text-tertiary)' : 'var(--blue)',
                border: 'none',
                cursor: verifying || code.length !== 8 ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--font-body)',
                marginBottom: '12px',
              }}
            >
              {verifying ? 'Verifying...' : 'Sign in'}
            </button>

            <button
              type="button"
              onClick={() => {
                setSent(false);
                setCode('');
                setError(null);
              }}
              style={{
                width: '100%',
                fontSize: '12px',
                color: 'var(--text-tertiary)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
              }}
            >
              Use a different email
            </button>
          </form>
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
              Enter your email to receive a magic link and 8-digit code
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
