const db = require('./src/db/sqlite');

// Test the lock status logic
async function testLockStatus() {
  console.log('Testing lock status logic...');
  
  // First, let's see what's in the branch_locks table
  db.all('SELECT * FROM branch_locks WHERE is_active = 1', (err, rows) => {
    if (err) {
      console.error('Error querying branch_locks:', err);
      return;
    }
    console.log('Active locks in database:', rows);
  });
  
  // Test the lock status query logic
  const testRepoId = 1; // Assuming repo ID 1 exists
  const testBranchName = 'collab-john-doe'; // Example branch name
  const testCollaboratorLabel = 'John Doe';
  
  const sql = `
    SELECT * FROM branch_locks 
    WHERE repo_id = ? AND branch_name = ? AND is_active = 1 
    AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    ORDER BY locked_at DESC
  `;
  
  db.all(sql, [testRepoId, testBranchName], (err, rows) => {
    if (err) {
      console.error('Error testing lock status query:', err);
      return;
    }
    console.log('Locks found for test branch:', rows);
    
    // Find my lock if I have one
    const myLock = rows.find(lock => lock.locked_by_collaborator_label === testCollaboratorLabel);
    console.log('My lock:', myLock);
    
    // Find other people's locks
    const otherLocks = rows.filter(lock => lock.locked_by_collaborator_label !== testCollaboratorLabel);
    console.log('Other locks:', otherLocks);
    
    // Determine lock status
    let isLocked = false;
    let isLockedByMe = false;
    
    if (myLock) {
      isLocked = true;
      isLockedByMe = true;
      console.log('I have the lock');
    } else if (otherLocks.length > 0) {
      isLocked = true;
      isLockedByMe = false;
      console.log('Someone else has the lock');
    } else {
      console.log('No locks found');
    }
    
    console.log('Final status - isLocked:', isLocked, 'isLockedByMe:', isLockedByMe);
  });
}

testLockStatus(); 