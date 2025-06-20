const request = require('supertest');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

// Mock dependencies
jest.mock('isomorphic-git', () => ({
  listBranches: jest.fn().mockResolvedValue(['main', 'feature/test-branch']),
  branch: jest.fn().mockResolvedValue(undefined),
  checkout: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue('mock-commit-hash'),
  add: jest.fn().mockResolvedValue(undefined),
  resolveRef: jest.fn().mockResolvedValue('mock-main-branch-ref'),
  readBlob: jest.fn().mockResolvedValue({ blob: Buffer.from('qmd content from blob') }),
}));

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mock-uuid-token'),
}));

// Create test database
const testDb = new sqlite3.Database(':memory:');

// Mock the database module
jest.mock('../src/db/sqlite', () => testDb);

// Import the routes
const collabRoutes = require('../src/api/collab.routes');

describe('Branch Locking Tests', () => {
  let app;

  beforeEach(async () => {
    // Reset database
    await new Promise((resolve) => {
      testDb.run('DELETE FROM branch_locks', resolve);
      testDb.run('DELETE FROM share_links', resolve);
      testDb.run('DELETE FROM documents', resolve);
      testDb.run('DELETE FROM repositories', resolve);
      testDb.run('DELETE FROM users', resolve);
    });

    // Create test tables
    await new Promise((resolve) => {
      testDb.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          github_id TEXT UNIQUE NOT NULL,
          username TEXT NOT NULL
        )
      `, resolve);
    });

    await new Promise((resolve) => {
      testDb.run(`
        CREATE TABLE IF NOT EXISTS repositories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          full_name TEXT NOT NULL
        )
      `, resolve);
    });

    await new Promise((resolve) => {
      testDb.run(`
        CREATE TABLE IF NOT EXISTS documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          repo_id INTEGER NOT NULL,
          filepath TEXT NOT NULL
        )
      `, resolve);
    });

    await new Promise((resolve) => {
      testDb.run(`
        CREATE TABLE IF NOT EXISTS share_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          doc_id INTEGER NOT NULL,
          share_token TEXT UNIQUE NOT NULL,
          collab_branch_name TEXT NOT NULL,
          collaborator_label TEXT,
          user_id INTEGER
        )
      `, resolve);
    });

    await new Promise((resolve) => {
      testDb.run(`
        CREATE TABLE IF NOT EXISTS branch_locks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          repo_id INTEGER NOT NULL,
          branch_name TEXT NOT NULL,
          locked_by_user_id INTEGER,
          locked_by_collaborator_label TEXT,
          locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP,
          is_active BOOLEAN DEFAULT 1,
          UNIQUE(repo_id, branch_name)
        )
      `, resolve);
    });

    // Insert test data
    await new Promise((resolve) => {
      testDb.run('INSERT INTO users (github_id, username) VALUES (?, ?)', ['test-user', 'TestUser'], resolve);
    });

    await new Promise((resolve) => {
      testDb.run('INSERT INTO repositories (user_id, full_name) VALUES (?, ?)', [1, 'test/repo'], resolve);
    });

    await new Promise((resolve) => {
      testDb.run('INSERT INTO documents (repo_id, filepath) VALUES (?, ?)', [1, 'test.qmd'], resolve);
    });

    await new Promise((resolve) => {
      testDb.run('INSERT INTO share_links (doc_id, share_token, collab_branch_name, collaborator_label, user_id) VALUES (?, ?, ?, ?, ?)', 
        [1, 'test-token', 'feature/test-branch', 'Test Collaborator', 1], resolve);
    });

    // Create Express app for testing
    app = express();
    app.use(express.json());
    app.use('/api/collab', collabRoutes);
  });

  describe('POST /api/collab/:shareToken/lock', () => {
    it('should acquire a lock successfully', async () => {
      const response = await request(app)
        .post('/api/collab/test-token/lock')
        .send({
          collaboratorLabel: 'Test Collaborator',
          lockDuration: 30
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Branch locked successfully');
      expect(response.body.expiresAt).toBeDefined();
      expect(response.body.lockDuration).toBe(30);
    });

    it('should fail to acquire lock when branch is already locked', async () => {
      // First, acquire a lock
      await request(app)
        .post('/api/collab/test-token/lock')
        .send({
          collaboratorLabel: 'First Collaborator',
          lockDuration: 30
        });

      // Try to acquire lock again with different collaborator
      const response = await request(app)
        .post('/api/collab/test-token/lock')
        .send({
          collaboratorLabel: 'Second Collaborator',
          lockDuration: 30
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Branch is already locked');
      expect(response.body.lockInfo.lockedBy).toBe('First Collaborator');
    });
  });

  describe('DELETE /api/collab/:shareToken/lock', () => {
    it('should release a lock successfully', async () => {
      // First, acquire a lock
      await request(app)
        .post('/api/collab/test-token/lock')
        .send({
          collaboratorLabel: 'Test Collaborator',
          lockDuration: 30
        });

      // Release the lock
      const response = await request(app)
        .delete('/api/collab/test-token/lock')
        .send({
          collaboratorLabel: 'Test Collaborator'
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Branch lock released successfully');
    });

    it('should fail to release lock when not locked by the collaborator', async () => {
      // First, acquire a lock with one collaborator
      await request(app)
        .post('/api/collab/test-token/lock')
        .send({
          collaboratorLabel: 'First Collaborator',
          lockDuration: 30
        });

      // Try to release lock with different collaborator
      const response = await request(app)
        .delete('/api/collab/test-token/lock')
        .send({
          collaboratorLabel: 'Second Collaborator'
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('No active lock found for this collaborator.');
    });
  });

  describe('GET /api/collab/:shareToken/lock-status', () => {
    it('should return unlocked status when no lock exists', async () => {
      const response = await request(app)
        .get('/api/collab/test-token/lock-status');

      expect(response.status).toBe(200);
      expect(response.body.isLocked).toBe(false);
      expect(response.body.lockInfo).toBe(null);
    });

    it('should return locked status when lock exists', async () => {
      // First, acquire a lock
      await request(app)
        .post('/api/collab/test-token/lock')
        .send({
          collaboratorLabel: 'Test Collaborator',
          lockDuration: 30
        });

      // Check lock status
      const response = await request(app)
        .get('/api/collab/test-token/lock-status');

      expect(response.status).toBe(200);
      expect(response.body.isLocked).toBe(true);
      expect(response.body.lockInfo.lockedBy).toBe('Test Collaborator');
      expect(response.body.lockInfo.expiresAt).toBeDefined();
    });
  });
}); 