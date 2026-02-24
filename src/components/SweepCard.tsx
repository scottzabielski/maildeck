import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Icons } from './ui/Icons.tsx';
import { useStore } from '../store/index.ts';
import { formatCountdown, getCountdownClass } from '../lib/helpers.ts';
import type { SweepEmail } from '../types/index.ts';

// Pre-warm audio context on first user interaction so autoplay isn't blocked
let audioUnlocked = false;

function ensureAudioUnlocked() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  const audio = new Audio('/sounds/fire.mp3');
  audio.preload = 'auto';
  audio.volume = 0;
  audio.play().then(() => {
    audio.pause();
    audio.currentTime = 0;
  }).catch(() => {});
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    ensureAudioUnlocked();
    window.removeEventListener('click', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('click', unlock);
  window.addEventListener('keydown', unlock);
}

function playFireSound() {
  const audio = new Audio('/sounds/fire.mp3');
  audio.volume = 0.6;
  audio.play().catch(() => {});

  let fadeStep = 0;
  const fadeInterval = setInterval(() => {
    fadeStep++;
    if (fadeStep >= 50) {
      clearInterval(fadeInterval);
      audio.pause();
      return;
    }
    audio.volume = Math.max(0, 0.6 * (1 - fadeStep / 50));
  }, 100);
}

interface SweepCardProps {
  email: SweepEmail;
}

export function SweepCard({ email }: SweepCardProps) {
  const { accounts, exemptSweepEmail, removeSweepEmail, selectEmail } = useStore();
  const account = accounts.find(a => a.id === email.accountId);
  const cdClass = getCountdownClass(email.sweepSeconds);
  const isExpiring = email.expiring === true;
  const isDelete = email.action === 'delete';
  const cardRef = useRef<HTMLDivElement>(null);
  const [capturedHeight, setCapturedHeight] = useState<number | null>(null);

  // Capture height right when expiring starts, before CSS animation changes it
  useEffect(() => {
    if (isExpiring && cardRef.current && capturedHeight === null) {
      setCapturedHeight(cardRef.current.offsetHeight);
    }
  }, [isExpiring, capturedHeight]);

  const removeSweepEmailRef = useRef(removeSweepEmail);
  removeSweepEmailRef.current = removeSweepEmail;

  useEffect(() => {
    if (!isExpiring) return;

    const removeTimer = setTimeout(() => {
      removeSweepEmailRef.current(email.id);
    }, 1000);

    if (isDelete) {
      playFireSound();
    }

    return () => clearTimeout(removeTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpiring, isDelete, email.id]);

  const handleClick = () => {
    if (isExpiring) return;
    selectEmail(email.id, 'sweep', email.accountId);
  };

  const expiringClass = isExpiring
    ? isDelete
      ? 'sweep-card-expiring-delete'
      : 'sweep-card-expiring-archive'
    : '';

  return (
    <motion.div
      ref={cardRef}
      className={`sweep-card ${expiringClass}`}
      layout={!isExpiring}
      initial={{ opacity: 0, y: -8 }}
      animate={isExpiring && capturedHeight !== null
        ? { opacity: 1, y: 0, height: capturedHeight }
        : { opacity: 1, y: 0 }
      }
      exit={{ opacity: 0, height: 0, marginBottom: 0, padding: 0, transition: { duration: 0.01 } }}
      transition={{ duration: 0.25 }}
      onClick={handleClick}
      style={{
        cursor: isExpiring ? 'default' : 'pointer',
        overflow: isExpiring ? 'hidden' : undefined,
        position: 'relative',
      }}
    >
      <div className="sweep-card-top">
        <span className="email-sender">{email.sender}</span>
        {account && <span className="email-account-dot" style={{ background: account.color }} />}
      </div>
      <div className="sweep-subject">{email.subject}</div>
      <div className="sweep-bottom">
        <div className={`sweep-countdown ${cdClass}`}>
          <Icons.Clock />
          {isExpiring
            ? (isDelete ? 'Deleting...' : 'Archiving...')
            : <>{isDelete ? 'Delete' : 'Archive'} in {formatCountdown(email.sweepSeconds)}</>
          }
        </div>
        {!isExpiring && (
          <button
            className="exempt-btn"
            onClick={(e) => { e.stopPropagation(); exemptSweepEmail(email.id); }}
          >
            Exempt
          </button>
        )}
      </div>

      {isExpiring && isDelete && (
        <>
          <div className="sweep-burn-overlay" />
          <div className="sweep-burn-embers" />
        </>
      )}
      {isExpiring && !isDelete && (
        <div className="sweep-archive-overlay" />
      )}
    </motion.div>
  );
}
