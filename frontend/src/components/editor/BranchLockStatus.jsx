import React, { useState, useEffect, useRef } from 'react';
import './BranchLockStatus.css';

function BranchLockStatus({ shareToken, collaboratorLabel, onLockChange, isEditing = false }) {
  const [lockStatus, setLockStatus] = useState(null);
  const [error, setError] = useState('');
  const autoReleaseTimeoutRef = useRef(null);

  const fetchLockStatus = async () => {
    try {
      const response = await fetch(`/api/collab/${shareToken}/lock-status?collaboratorLabel=${encodeURIComponent(collaboratorLabel)}`);
      if (response.ok) {
        const data = await response.json();
        console.log('BranchLockStatus received lock status:', data);
        setLockStatus(data);
        if (onLockChange) onLockChange(data);
      } else {
        setError('Failed to fetch lock status');
      }
    } catch (error) {
      setError('Error fetching lock status');
    }
  };

  // Auto-acquire lock when editing starts
  useEffect(() => {
    if (isEditing && lockStatus && !lockStatus.isLockedByMe && !lockStatus.isLocked) {
      console.log('Auto-acquiring lock for editing');
      acquireLock();
    }
  }, [isEditing, lockStatus, collaboratorLabel]);

  const acquireLock = async () => {
    try {
      const response = await fetch(`/api/collab/${shareToken}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collaboratorLabel,
          lockDuration: 5 // 5 minutes
        })
      });
      
      if (response.ok) {
        await fetchLockStatus();
      } else {
        const data = await response.json();
        if (response.status === 409) {
          setError(`${data.lockInfo.lockedBy} is currently editing`);
        } else {
          setError(data.error || 'Failed to acquire lock');
        }
      }
    } catch (error) {
      setError('Error acquiring lock');
    }
  };

  const releaseLock = async () => {
    try {
      const response = await fetch(`/api/collab/${shareToken}/lock`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collaboratorLabel })
      });
      
      if (response.ok) {
        await fetchLockStatus();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to release lock');
      }
    } catch (error) {
      setError('Error releasing lock');
    }
  };

  // Manage auto-release timeout
  useEffect(() => {
    // Clear any existing timeout
    if (autoReleaseTimeoutRef.current) {
      clearTimeout(autoReleaseTimeoutRef.current);
      autoReleaseTimeoutRef.current = null;
    }

    // Set new timeout if user has the lock and stops editing
    if (!isEditing && lockStatus?.isLocked && lockStatus.lockInfo?.lockedBy === collaboratorLabel) {
      autoReleaseTimeoutRef.current = setTimeout(() => {
        console.log('Auto-releasing lock due to inactivity');
        releaseLock();
      }, 30000); // 30 seconds of inactivity
    }

    // Cleanup on unmount
    return () => {
      if (autoReleaseTimeoutRef.current) {
        clearTimeout(autoReleaseTimeoutRef.current);
      }
    };
  }, [isEditing, lockStatus, collaboratorLabel]);

  // Check for expired locks on each status fetch
  useEffect(() => {
    if (lockStatus?.isLocked && lockStatus.lockInfo?.expiresAt) {
      const expiresAt = new Date(lockStatus.lockInfo.expiresAt);
      const now = new Date();
      
      if (now > expiresAt) {
        console.log('Lock has expired, releasing');
        releaseLock();
      }
    }
  }, [lockStatus, collaboratorLabel]);

  useEffect(() => {
    fetchLockStatus();
    // Poll for lock status changes every 5 seconds
    const interval = setInterval(fetchLockStatus, 5000);
    return () => clearInterval(interval);
  }, [shareToken, collaboratorLabel]);

  if (!lockStatus) {
    return <div className="lock-status">Loading...</div>;
  }

  const isLockedByMe = lockStatus.isLockedByMe;
  const isLockedByOther = lockStatus.isLocked && !isLockedByMe;

  return (
    <div className="branch-lock-status">
      {error && <div className="lock-error">{error}</div>}
      
      {!lockStatus.isLocked && (
        <div className="lock-status available">
          <span className="status-icon">🟢</span>
          <span>Available for editing</span>
        </div>
      )}
      
      {isLockedByMe && (
        <div className="lock-status you-editing">
          <span className="status-icon">🔵</span>
          <span>You are editing</span>
          {lockStatus.lockInfo?.expiresAt && (
            <span className="expires-at">
              Auto-release in {Math.max(0, Math.floor((new Date(lockStatus.lockInfo.expiresAt) - new Date()) / 1000 / 60))}m
            </span>
          )}
          <button 
            onClick={releaseLock}
            className="release-button"
            title="Manually release lock"
          >
            Release
          </button>
        </div>
      )}
      
      {isLockedByOther && (
        <div className="lock-status other-editing">
          <span className="status-icon">🔴</span>
          <span>{lockStatus.lockInfo?.lockedBy} is editing</span>
          {lockStatus.lockInfo?.expiresAt && (
            <span className="expires-at">
              Available in {Math.max(0, Math.floor((new Date(lockStatus.lockInfo.expiresAt) - new Date()) / 1000 / 60))}m
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default BranchLockStatus; 