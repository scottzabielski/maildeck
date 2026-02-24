import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';
import { useEmailBody } from '../hooks/useEmailBody.ts';
import { formatCountdown, getCountdownClass } from '../lib/helpers.ts';

export function EmailViewer() {
  const { selectedEmail, emails, accounts, sweepEmails, deselectEmail, toggleStar, toggleRead, archiveEmail, deleteEmail, openSweepRuleEditor } = useStore();
  const [copied, setCopied] = useState(false);
  const [showSenderEmail, setShowSenderEmail] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(400);

  const emailId = selectedEmail?.emailId;
  const email = emails.find(e => e.id === emailId);
  const { data: body, isLoading: bodyLoading } = useEmailBody(emailId);

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

    const doc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: ${isDark ? '#d1d5db' : '#374151'};
    background: transparent;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  a { color: ${isDark ? '#60a5fa' : '#2563eb'}; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100% !important; }
  pre, code { white-space: pre-wrap; word-wrap: break-word; }
  blockquote {
    border-left: 3px solid ${isDark ? '#4b5563' : '#d1d5db'};
    margin: 8px 0;
    padding: 4px 12px;
    color: ${isDark ? '#9ca3af' : '#6b7280'};
  }
</style>
</head>
<body>${body.body_html}</body>
<script>document.querySelectorAll('a[href]').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });</script>
</html>`;

    iframe.srcdoc = doc;

    const onLoad = () => {
      resizeIframe();
      // Watch for dynamic content (images loading, etc.)
      const observer = new ResizeObserver(resizeIframe);
      if (iframe.contentDocument?.body) {
        observer.observe(iframe.contentDocument.body);
      }
    };

    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [body?.body_html, resizeIframe]);

  if (!selectedEmail || !email) return null;
  const account = accounts.find(a => a.id === email.accountId);

  const timestamp = new Date(email.time).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

  const handleCopySubject = () => {
    navigator.clipboard.writeText(email.subject).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const avatarLetter = email.sender.charAt(0).toUpperCase();
  const avatarBg = account ? account.color : 'var(--blue)';
  const sweepItem = sweepEmails.find(s => s.id === email.id);
  const hasSweep = sweepItem && sweepItem.sweepSeconds > 0;

  const hasHtml = body?.body_html;
  const hasText = body?.body_text;

  return (
    <motion.div
      className="email-viewer"
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      key={email.id}
    >
      {/* Header bar */}
      <div className="email-viewer-header">
        <button className="email-viewer-back" onClick={deselectEmail}>
          <Icons.ChevronLeft />
          Back
        </button>
        <div className="email-viewer-actions">
          <button
            className={`email-viewer-action${email.starred ? ' starred' : ''}`}
            onClick={() => toggleStar(email.id)}
            title={email.starred ? 'Unstar' : 'Star'}
          >
            <Icons.Star />
          </button>
          <button
            className="email-viewer-action"
            onClick={() => archiveEmail(email.id)}
            title="Archive"
          >
            <Icons.Archive />
          </button>
          <button
            className="email-viewer-action"
            onClick={() => openSweepRuleEditor(email.id)}
            title="Create Sweep Rule"
          >
            <Icons.Sweep />
          </button>
          <button
            className="email-viewer-action"
            onClick={() => toggleRead(email.id)}
            title={email.unread ? 'Mark as read' : 'Mark as unread'}
          >
            {email.unread ? <Icons.EnvelopeOpen /> : <Icons.Envelope />}
          </button>
          <button
            className="email-viewer-action danger"
            onClick={() => deleteEmail(email.id)}
            title="Delete"
          >
            <Icons.Trash />
          </button>
        </div>
      </div>
      {/* Meta section */}
      <div className="email-viewer-meta">
        <div className="email-viewer-subject">
          <span className="email-viewer-subject-text">{email.subject}</span>
          <button
            className={`email-viewer-copy-btn${copied ? ' copied' : ''}`}
            onClick={handleCopySubject}
            title={copied ? 'Copied!' : 'Copy subject to clipboard'}
          >
            {copied ? <Icons.Check /> : <Icons.Copy />}
          </button>
        </div>
        <div className="email-viewer-sender-row">
          <div className="email-viewer-avatar" style={{ background: avatarBg }}>
            {avatarLetter}
          </div>
          <div className="email-viewer-sender-info">
            <div className="email-viewer-sender-name">
              <span
                className="email-viewer-sender-name-text"
                onClick={() => setShowSenderEmail(!showSenderEmail)}
              >
                {email.sender}
              </span>
              {showSenderEmail && email.senderEmail && (
                <span className="email-viewer-sender-email">{email.senderEmail}</span>
              )}
              {account && (
                <span
                  className="email-viewer-account-badge"
                  style={{ background: account.color }}
                >
                  {account.name}
                </span>
              )}
            </div>
            <div className="email-viewer-timestamp">
              {timestamp}
              <span className="email-viewer-to"> to {email.toEmail || account?.email || 'me'}</span>
            </div>
          </div>
          {hasSweep && (
            <span className={`email-viewer-sweep-badge ${getCountdownClass(sweepItem.sweepSeconds)}`}>
              <Icons.Clock />
              {sweepItem.action === 'delete' ? 'Delete' : 'Archive'} in {formatCountdown(sweepItem.sweepSeconds)}
            </span>
          )}
        </div>
      </div>
      {/* Body */}
      <div className="email-viewer-body">
        {bodyLoading && (
          <div className="email-viewer-loading">Loading email...</div>
        )}
        {!bodyLoading && hasHtml && (
          <iframe
            ref={iframeRef}
            className="email-viewer-iframe"
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-scripts"
            style={{ height: iframeHeight }}
            title="Email content"
          />
        )}
        {!bodyLoading && !hasHtml && hasText && (
          <div className="email-viewer-body-text">
            {body.body_text!.split('\n\n').map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        )}
        {!bodyLoading && !hasHtml && !hasText && (
          <div className="email-viewer-body-text">
            <p>{email.snippet}</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
