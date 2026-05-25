import { useState, useRef, useEffect, useCallback } from 'react';
import { Icons } from '../../components/ui/Icons.tsx';
import { useStore } from '../../store/index.ts';
import { useEmailBody } from '../../hooks/useEmailBody.ts';
import { formatCountdown, getCountdownClass } from '../../lib/helpers.ts';
import { buildEmailIframeDoc } from '../../lib/emailIframe.ts';
import { MobileTopBar } from '../components/MobileTopBar.tsx';
import type { MobileNav } from '../navTypes.ts';

interface EmailScreenProps {
  nav: MobileNav;
}

export function EmailScreen({ nav: _nav }: EmailScreenProps) {
  const selectedEmail = useStore(s => s.selectedEmail);
  const emails = useStore(s => s.emails);
  const accounts = useStore(s => s.accounts);
  const sweepEmails = useStore(s => s.sweepEmails);
  const deselectEmail = useStore(s => s.deselectEmail);
  const toggleStar = useStore(s => s.toggleStar);
  const toggleRead = useStore(s => s.toggleRead);
  const archiveEmail = useStore(s => s.archiveEmail);
  const deleteEmail = useStore(s => s.deleteEmail);
  const openSweepRuleEditor = useStore(s => s.openSweepRuleEditor);

  const [copied, setCopied] = useState(false);
  const [showSenderEmail, setShowSenderEmail] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(400);

  const emailId = selectedEmail?.emailId;
  const email = emails.find(e => e.id === emailId);
  const { data: body, isLoading: bodyLoading } = useEmailBody(emailId);

  // Clear the selection; MobileAppShell's effect watches selectedEmailId and
  // pops the email frame off the nav stack when it goes null. Calling
  // nav.pop() here too would double-pop and walk us out of the app's
  // synthetic history entry.
  const handleBack = useCallback(() => {
    deselectEmail();
  }, [deselectEmail]);

  const resizeIframe = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument?.body) return;
    const h = iframe.contentDocument.body.scrollHeight;
    if (h > 0) setIframeHeight(h + 32);
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !body?.body_html) return;

    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const isDark = theme === 'dark';

    iframe.srcdoc = buildEmailIframeDoc({ bodyHtml: body.body_html, isDark, mobile: true });

    const onLoad = () => {
      resizeIframe();
      const observer = new ResizeObserver(resizeIframe);
      if (iframe.contentDocument?.body) {
        observer.observe(iframe.contentDocument.body);
      }
    };

    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [body?.body_html, resizeIframe]);

  if (!selectedEmail || !email) {
    return (
      <div className="mobile-screen">
        <MobileTopBar onBack={handleBack} title="" />
      </div>
    );
  }

  const account = accounts.find(a => a.id === email.accountId);

  const timestamp = new Date(email.time).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

  const handleCopySubject = () => {
    navigator.clipboard.writeText(email.subject).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const avatarLetter = email.sender.charAt(0).toUpperCase();
  const avatarBg = account ? account.color : 'var(--blue)';
  const sweepItem = sweepEmails.find(s => s.id === email.id);
  const hasSweep = !!sweepItem && sweepItem.sweepSeconds > 0;
  const hasHtml = body?.body_html;
  const hasText = body?.body_text;

  return (
    <div className="mobile-screen mobile-email-screen">
      <MobileTopBar
        onBack={handleBack}
        title=""
        rightSlot={
          <div className="mobile-email-actions">
            <button
              type="button"
              className={`mobile-topbar-icon-btn${email.starred ? ' active' : ''}`}
              onClick={() => toggleStar(email.id)}
              aria-label={email.starred ? 'Unstar' : 'Star'}
            >
              <Icons.Star />
            </button>
            <button
              type="button"
              className="mobile-topbar-icon-btn"
              onClick={() => archiveEmail(email.id)}
              aria-label="Archive"
            >
              <Icons.Archive />
            </button>
            <button
              type="button"
              className="mobile-topbar-icon-btn"
              onClick={() => openSweepRuleEditor(email.id)}
              aria-label="Create sweep rule"
            >
              <Icons.Sweep />
            </button>
            <button
              type="button"
              className="mobile-topbar-icon-btn"
              onClick={() => toggleRead(email.id)}
              aria-label={email.unread ? 'Mark as read' : 'Mark as unread'}
            >
              {email.unread ? <Icons.EnvelopeOpen /> : <Icons.Envelope />}
            </button>
            <button
              type="button"
              className="mobile-topbar-icon-btn danger"
              onClick={() => deleteEmail(email.id)}
              aria-label="Delete"
            >
              <Icons.Trash />
            </button>
          </div>
        }
      />

      <div className="mobile-email-body-scroll">
        {/* Meta */}
        <div className="mobile-email-meta">
          <div className="mobile-email-meta-subject">
            <span className="mobile-email-meta-subject-text">{email.subject}</span>
            <button
              type="button"
              className={`mobile-email-meta-copy${copied ? ' copied' : ''}`}
              onClick={handleCopySubject}
              aria-label={copied ? 'Copied' : 'Copy subject'}
            >
              {copied ? <Icons.Check /> : <Icons.Copy />}
            </button>
          </div>
          <div className="mobile-email-meta-sender">
            <div className="mobile-email-meta-avatar" style={{ background: avatarBg }}>
              {avatarLetter}
            </div>
            <div className="mobile-email-meta-sender-info">
              <div
                className="mobile-email-meta-sender-name"
                onClick={() => setShowSenderEmail(v => !v)}
              >
                {email.sender}
              </div>
              {showSenderEmail && email.senderEmail && (
                <div className="mobile-email-meta-sender-email">{email.senderEmail}</div>
              )}
              <div className="mobile-email-meta-timestamp">
                {timestamp}
                <span className="mobile-email-meta-to"> to {email.toEmail || account?.email || 'me'}</span>
              </div>
              {account && (
                <span
                  className="mobile-email-meta-account-badge"
                  style={{ background: account.color }}
                >
                  {account.name}
                </span>
              )}
            </div>
          </div>
          {hasSweep && sweepItem && (
            <div className="mobile-email-meta-sweep">
              <span className={`mobile-email-sweep-badge ${getCountdownClass(sweepItem.sweepSeconds)}`}>
                <Icons.Clock />
                {sweepItem.action === 'delete' ? 'Delete' : 'Archive'} in {formatCountdown(sweepItem.sweepSeconds)}
              </span>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="mobile-email-body">
          {bodyLoading && <div className="mobile-email-body-loading">Loading email…</div>}
          {!bodyLoading && hasHtml && (
            <iframe
              ref={iframeRef}
              className="mobile-email-iframe"
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-scripts"
              style={{ height: iframeHeight }}
              title="Email content"
            />
          )}
          {!bodyLoading && !hasHtml && hasText && (
            <div className="mobile-email-body-text">
              {body!.body_text!.split('\n\n').map((p, i) => <p key={i}>{p}</p>)}
            </div>
          )}
          {!bodyLoading && !hasHtml && !hasText && (
            <div className="mobile-email-body-text">
              <p>{email.snippet}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
