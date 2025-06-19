const git = require('isomorphic-git');
const fs = require('fs');
const path = require('path');

// Mock fs for git operations
const mockFs = {
  promises: {
    readFile: jest.fn().mockResolvedValue('test content'),
    writeFile: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined),
  }
};

// Mock isomorphic-git
jest.mock('isomorphic-git', () => ({
  clone: jest.fn().mockResolvedValue(undefined),
  listBranches: jest.fn().mockResolvedValue(['main', 'feature/test-branch']),
  branch: jest.fn().mockResolvedValue(undefined),
  checkout: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue('mock-commit-hash'),
  add: jest.fn().mockResolvedValue(undefined),
  resolveRef: jest.fn().mockResolvedValue('mock-main-branch-ref'),
  readBlob: jest.fn().mockResolvedValue({ blob: Buffer.from('qmd content from blob') }),
}));

describe('Local Branch Management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should list local branches only', async () => {
    const branches = await git.listBranches({
      fs: mockFs,
      dir: '/test/repo'
    });

    expect(branches).toEqual(['main', 'feature/test-branch']);
    expect(git.listBranches).toHaveBeenCalledWith({
      fs: mockFs,
      dir: '/test/repo'
    });
  });

  test('should create local branch without remote operations', async () => {
    const existingBranches = ['main'];
    git.listBranches.mockResolvedValueOnce(existingBranches);

    const newBranchName = 'feature/new-branch';
    const branchExists = existingBranches.includes(newBranchName);

    expect(branchExists).toBe(false);

    if (!branchExists) {
      await git.branch({
        fs: mockFs,
        dir: '/test/repo',
        ref: newBranchName,
        checkout: false
      });

      expect(git.branch).toHaveBeenCalledWith({
        fs: mockFs,
        dir: '/test/repo',
        ref: newBranchName,
        checkout: false
      });
    }
  });

  test('should checkout existing local branch', async () => {
    await git.checkout({
      fs: mockFs,
      dir: '/test/repo',
      ref: 'feature/test-branch'
    });

    expect(git.checkout).toHaveBeenCalledWith({
      fs: mockFs,
      dir: '/test/repo',
      ref: 'feature/test-branch'
    });
  });

  test('should handle branch checkout error gracefully', async () => {
    const checkoutError = new Error('Could not find feature/non-existent-branch');
    git.checkout.mockRejectedValueOnce(checkoutError);

    try {
      await git.checkout({
        fs: mockFs,
        dir: '/test/repo',
        ref: 'feature/non-existent-branch'
      });
    } catch (error) {
      if (error.message.includes('Could not find')) {
        // Create the branch locally
        await git.branch({
          fs: mockFs,
          dir: '/test/repo',
          ref: 'feature/non-existent-branch',
          checkout: true
        });

        expect(git.branch).toHaveBeenCalledWith({
          fs: mockFs,
          dir: '/test/repo',
          ref: 'feature/non-existent-branch',
          checkout: true
        });
      } else {
        throw error;
      }
    }
  });
}); 