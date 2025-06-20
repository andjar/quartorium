const request = require('supertest');
const express = require('express');
const path = require('path');

// Mock the dependencies
jest.mock('../src/db/sqlite', () => ({
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn()
}));

jest.mock('isomorphic-git', () => ({
  checkout: jest.fn(),
  resolveRef: jest.fn()
}));

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  mkdir: jest.fn()
}));

jest.mock('fs', () => ({
  readFileSync: jest.fn()
}));

jest.mock('../src/core/commentUtils', () => ({
  extractCommentsAppendix: jest.fn()
}));

const db = require('../src/db/sqlite');
const git = require('isomorphic-git');
const fs = require('fs/promises');
const { extractCommentsAppendix } = require('../src/core/commentUtils');

describe('Suggestions API', () => {
  let app;
  let mockReq;
  let mockRes;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Setup mock responses
    db.all.mockImplementation((sql, params, callback) => {
      if (sql.includes('share_links')) {
        callback(null, [
          {
            share_token: 'test-token-1',
            collab_branch_name: 'collab-branch-1',
            collaborator_label: 'Test Collaborator 1',
            filepath: 'test.qmd',
            full_name: 'test/repo'
          },
          {
            share_token: 'test-token-2',
            collab_branch_name: 'collab-branch-2',
            collaborator_label: 'Test Collaborator 2',
            filepath: 'test.qmd',
            full_name: 'test/repo'
          }
        ]);
      }
    });

    db.get.mockImplementation((sql, params, callback) => {
      if (sql.includes('live_documents')) {
        callback(null, {
          comments_json: JSON.stringify([
            {
              id: 'live-comment-1',
              author: 'Live User',
              timestamp: '2023-01-01T00:00:00Z',
              status: 'open',
              thread: [{ text: 'Live comment', author: 'Live User', timestamp: '2023-01-01T00:00:00Z' }]
            }
          ])
        });
      }
    });

    git.checkout.mockResolvedValue();
    git.resolveRef.mockResolvedValue('abc123456789');
    fs.readFile.mockResolvedValue('# Test Document\n\nThis is a test document.');
    extractCommentsAppendix.mockReturnValue({
      comments: [
        {
          id: 'comment-1',
          author: 'Test User',
          timestamp: '2023-01-01T00:00:00Z',
          status: 'open',
          thread: [{ text: 'Test comment', author: 'Test User', timestamp: '2023-01-01T00:00:00Z' }]
        }
      ],
      remainingQmdString: '# Test Document\n\nThis is a test document.'
    });

    // Setup Express app with the suggestions route
    app = express();
    app.use(express.json());
    
    // Mock authentication middleware
    app.use((req, res, next) => {
      req.user = { id: 'test-user' };
      next();
    });

    // Import and use the docs routes
    const docsRoutes = require('../src/api/docs.routes');
    app.use('/api/docs', docsRoutes);
  });

  describe('GET /api/docs/:docId/suggestions', () => {
    it('should return suggestions from all collaboration branches', async () => {
      const response = await request(app)
        .get('/api/docs/123/suggestions')
        .expect(200);

      expect(response.body).toHaveProperty('documentId', '123');
      expect(response.body).toHaveProperty('totalSuggestions');
      expect(response.body).toHaveProperty('branches');
      expect(Array.isArray(response.body.branches)).toBe(true);
      
      // Should have suggestions from both branches
      expect(response.body.branches.length).toBeGreaterThan(0);
      
      // Check that each branch has the expected structure
      response.body.branches.forEach(branch => {
        expect(branch).toHaveProperty('branch');
        expect(branch).toHaveProperty('collaborator');
        expect(branch).toHaveProperty('shareToken');
        expect(branch).toHaveProperty('commitHash');
        expect(branch).toHaveProperty('suggestions');
        expect(Array.isArray(branch.suggestions)).toBe(true);
      });
    });

    it('should handle database errors gracefully', async () => {
      db.all.mockImplementation((sql, params, callback) => {
        callback(new Error('Database error'), null);
      });

      const response = await request(app)
        .get('/api/docs/123/suggestions')
        .expect(500);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Database error');
    });

    it('should handle missing document gracefully', async () => {
      db.all.mockImplementation((sql, params, callback) => {
        callback(null, []); // No share links found
      });

      const response = await request(app)
        .get('/api/docs/999/suggestions')
        .expect(200);

      expect(response.body).toHaveProperty('documentId', '999');
      expect(response.body.totalSuggestions).toBe(0);
      expect(response.body.branches).toEqual([]);
    });
  });

  describe('GET /api/docs/document-id', () => {
    it('should return document ID for valid repoId and filepath', async () => {
      db.get.mockImplementation((sql, params, callback) => {
        callback(null, { id: 123 });
      });

      const response = await request(app)
        .get('/api/docs/document-id?repoId=1&filepath=test.qmd')
        .expect(200);

      expect(response.body).toHaveProperty('docId', 123);
    });

    it('should return 400 for missing parameters', async () => {
      const response = await request(app)
        .get('/api/docs/document-id?repoId=1')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('repoId and filepath are required');
    });

    it('should return 404 for non-existent document', async () => {
      db.get.mockImplementation((sql, params, callback) => {
        callback(null, null); // Document not found
      });

      const response = await request(app)
        .get('/api/docs/document-id?repoId=1&filepath=nonexistent.qmd')
        .expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Document not found');
    });
  });
}); 